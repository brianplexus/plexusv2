/**
 * PLEXUS BACKEND v48.7 - ULTIMATE ENTERPRISE PRM
 * ADDED: SMART IDENTITY SYNC ENGINE
 */

require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const csv = require('csv-parser');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
const upload = multer({ dest: 'uploads/' });

app.use(cors());
app.use(express.json({ limit: '50mb' }));

let uploadProgress = { active: false, current: 0, total: 0, status: "" };

// --- 1. SCHEMAS ---

const patientSchema = new mongoose.Schema({
    patientName: { type: String, required: true, index: true },
    chartNumber: { type: String, index: true, unique: true },
    dob: String, gender: String, phone: String, 
    email: String, insurance: String, age: String,
    isOptedOut: { type: Boolean, default: false },
    invalidPhone: { type: Boolean, default: false },
    lastUpdated: { type: Date, default: Date.now }
});

const callTaskSchema = new mongoose.Schema({
    patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient' },
    patientName: String,
    chartNumber: String,
    qualifyingTests: String, 
    recommendedScreenings: String, 
    dx: String, hx: String, rx: String,
    location: String, physician: String, time: String,
    addressed: { type: Boolean, default: false },
    assignedTo: { type: String, default: null }, 
    attemptCount: { type: Number, default: 0 },
    lastAttemptDate: Date,
    skipUntil: { type: Date, default: null }, 
    lastOutcome: { type: String, default: null }, 
    createdAt: { type: Date, default: Date.now }
});

const proceduresHistorySchema = new mongoose.Schema({
    dateOfService: Date,
    patientName: String,
    procedure: String,
    chartNumber: { type: String, index: true },
    createdAt: { type: Date, default: Date.now }
});

const staffSchema = new mongoose.Schema({
    name: { type: String, unique: true },
    extension: String,
    rcExtensionId: String, 
    directLine: String,    
    isRcVerified: { type: Boolean, default: false }
});

const logSchema = new mongoose.Schema({
    patientName: String, 
    staff: String, 
    outcome: String, 
    duration: Number,
    channel: { type: String, default: 'Call' }, 
    messageContent: String,
    timestamp: { type: Date, default: Date.now }
});

const scheduleDraftSchema = new mongoose.Schema({
    name: String, 
    location: String,
    physician: String,
    date: String,
    entries: Array, 
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

const appointmentSchema = new mongoose.Schema({
    patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient' },
    patientName: String,
    chartNumber: String,
    procedure: String,
    date: String,
    time: String,
    location: String,
    physician: String,
    createdAt: { type: Date, default: Date.now }
});

const Patient = mongoose.model('Patient', patientSchema);
const CallTask = mongoose.model('CallTask', callTaskSchema);
const ProceduresHistory = mongoose.model('ProceduresHistory', proceduresHistorySchema);
const Staff = mongoose.model('Staff', staffSchema);
const SystemConfig = mongoose.model('SystemConfig', new mongoose.Schema({ key: { type: String, unique: true }, values: [String] }));
const InteractionLog = mongoose.model('InteractionLog', logSchema);
const ScheduleDraft = mongoose.model('ScheduleDraft', scheduleDraftSchema);
const Appointment = mongoose.model('Appointment', appointmentSchema);

// --- 2. CORE PRM ENGINES ---

app.post('/api/calls/log', async (req, res) => {
    try {
        const { taskId, outcome, patientName, staff, channel, messageContent, scheduledTests = [], declinedTests = [], duration = 0 } = req.body;
        
        let richMessage = messageContent || '';
        if (outcome === 'Scheduled') {
            scheduledTests.forEach(st => richMessage += `\n[Scheduled: ${st.procedure} on ${st.date} at ${st.time}]`);
        } else if (outcome === 'Declined') {
            declinedTests.forEach(dt => richMessage += `\n[Declined: ${dt.procedure}]`);
        } else if (outcome === 'Skip') {
            richMessage += `\n[Agent skipped patient. Lead hidden in pool for 7 days]`;
        } else if (outcome === 'Callback') {
            richMessage += `\n[Agent requested a callback. Lead retained in workspace]`;
        }

        await InteractionLog.create({ patientName, staff, outcome, channel, messageContent: richMessage.trim(), duration });
        
        const task = await CallTask.findById(taskId);
        if (!task) return res.status(404).send("Task not found");

        task.lastOutcome = outcome; 

        if (outcome === 'DNC') {
            await Patient.findOneAndUpdate({ chartNumber: task.chartNumber }, { isOptedOut: true });
            task.addressed = true;
        } else if (outcome === 'Wrong Number') {
            await Patient.findOneAndUpdate({ chartNumber: task.chartNumber }, { invalidPhone: true });
            task.addressed = true;
        } else if (outcome === 'Skip') {
            task.assignedTo = null; 
            task.skipUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); 
            task.addressed = true; 
        } else if (outcome === 'Spanish Handoff') {
            task.addressed = true; 
        } else if (outcome === 'Callback') {
            
        } else if (outcome === 'Scheduled' || outcome === 'Declined') {
            task.addressed = true; 

            if (outcome === 'Scheduled') {
                for (const st of scheduledTests) {
                    await Appointment.create({
                        patientId: task.patientId,
                        patientName: task.patientName,
                        chartNumber: task.chartNumber,
                        procedure: st.procedure,
                        date: st.date,
                        time: st.time,
                        location: task.location,
                        physician: task.physician
                    });
                }
            }

            const allQual = (task.qualifyingTests || "").split(',').map(t => t.trim()).filter(t => t);
            const allReco = (task.recommendedScreenings || "").split(',').map(t => t.trim()).filter(t => t);
            
            const resolvedProcs = [...scheduledTests.map(s => s.procedure), ...declinedTests.map(d => d.procedure)];
            
            const remainingQual = allQual.filter(t => !resolvedProcs.includes(t));
            const remainingReco = allReco.filter(t => !resolvedProcs.includes(t));
            
            if (remainingQual.length > 0 || remainingReco.length > 0) {
                await CallTask.create({ 
                    ...task.toObject(), 
                    _id: new mongoose.Types.ObjectId(), 
                    qualifyingTests: remainingQual.join(','), 
                    recommendedScreenings: remainingReco.join(','),
                    addressed: false, 
                    assignedTo: null, 
                    attemptCount: 0,
                    lastOutcome: null
                });
            }
        } else if (outcome === 'Left VM' || outcome === 'No Answer') {
            // Infinite Daily Loop: Just increment and track date. No terminal limit.
            task.attemptCount += 1;
            task.lastAttemptDate = new Date();
        }

        await task.save();
        res.sendStatus(200);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/calls/undo', async (req, res) => {
    try {
        const { taskId, staff } = req.body;
        const task = await CallTask.findById(taskId);
        if (!task) return res.status(404).send("Task not found");

        await Patient.findOneAndUpdate(
            { chartNumber: task.chartNumber }, 
            { isOptedOut: false, invalidPhone: false }
        );
        
        task.addressed = false;
        task.assignedTo = staff; 
        task.skipUntil = null;
        task.lastOutcome = 'Re-Opened';

        await task.save();

        await InteractionLog.create({ 
            patientName: task.patientName, 
            staff, 
            outcome: 'Re-Opened', 
            channel: 'System', 
            messageContent: '[Agent used Smart Reverse to undo previous outcome. File re-opened.]', 
            duration: 0 
        });
        
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- NEW SMART IDENTITY SYNC ENGINE ---
app.post('/api/calls/sync-identities', async (req, res) => {
    try {
        const tasks = await CallTask.find({ patientName: 'New Identity Case' });
        let updatedCount = 0;
        
        for (const task of tasks) {
            const patient = await Patient.findOne({ chartNumber: task.chartNumber });
            if (patient && patient.patientName && patient.patientName !== 'New Identity Case') {
                task.patientName = patient.patientName;
                task.patientId = patient._id;
                await task.save();
                updatedCount++;
            }
        }
        res.json({ success: true, updatedCount });
    } catch (e) { 
        res.status(500).json({ error: e.message }); 
    }
});

// --- TELEMETRY UPLOAD ENGINE ---
app.post('/api/upload/:type', upload.single('file'), (req, res) => {
    console.log(`\n=== [UPLOAD STARTED] Type: ${req.params.type.toUpperCase()} ===`);
    console.log(`File received: ${req.file.originalname} (${req.file.size} bytes)`);

    const results = [];
    let imported = 0;
    let skipped = 0;
    uploadProgress = { active: true, current: 0, total: 0, status: "Cleaning Headers..." };

    fs.createReadStream(req.file.path)
        .pipe(csv({ mapHeaders: ({ header }) => header.trim().toLowerCase() }))
        .on('headers', (headers) => {
            console.log(`[DETECTED HEADERS]:`, headers);
        })
        .on('data', (data) => results.push(data))
        .on('end', async () => {
            console.log(`[PARSING COMPLETE] Total Rows Found: ${results.length}`);
            uploadProgress.total = results.length;

            if (results.length > 0) {
                const keys = Object.keys(results[0]);
                const chartKey = keys.find(k => /chart|id|mrn/i.test(k));
                const nameKey = keys.find(k => /patient|name/i.test(k));
                console.log(`[MAPPING] Chart Key matches -> "${chartKey || 'NOT FOUND'}"`);
                console.log(`[MAPPING] Name Key matches -> "${nameKey || 'NOT FOUND'}"`);
                
                if (req.params.type === 'master') {
                    const procKey = keys.find(k => /procedure|test|svc|description/i.test(k));
                    const dateKey = keys.find(k => /date|service/i.test(k));
                    console.log(`[MAPPING] Procedure Key matches -> "${procKey || 'NOT FOUND'}"`);
                    console.log(`[MAPPING] Date Key matches -> "${dateKey || 'NOT FOUND'}"`);
                }
            }

            for (let i = 0; i < results.length; i++) {
                const row = results[i];
                const keys = Object.keys(row);
                const chartKey = keys.find(k => /chart|id|mrn/i.test(k));
                const nameKey = keys.find(k => /patient|name/i.test(k));
                
                if (!chartKey || !row[chartKey]) {
                    console.log(`[SKIP ROW ${i + 1}] Missing Chart ID. Row data:`, JSON.stringify(row));
                    skipped++;
                    continue;
                }
                const chart = (row[chartKey] || "").toString().trim().replace(/[^a-zA-Z0-9]/g, '');

                if (req.params.type === 'emr') {
                    await Patient.findOneAndUpdate(
                        { chartNumber: chart },
                        { 
                            patientName: row[nameKey],
                            dob: row['dob'] || row['date of birth'] || row['birth date'],
                            gender: row['gender'] || row['sex'],
                            phone: row['phone'] || row['cell'] || row['tel'],
                            email: row['email'],
                            insurance: row['insurance'] || row['primary payer'] || row['payer'],
                            age: row['age'],
                            lastUpdated: new Date()
                        },
                        { upsert: true }
                    );
                    imported++;
                } else {
                    const procKey = keys.find(k => /procedure|test|svc|description/i.test(k));
                    const dateKey = keys.find(k => /date|service/i.test(k));
                    
                    if (!procKey || !row[procKey]) {
                        console.log(`[SKIP ROW ${i + 1}] History upload missing Procedure mapping for Chart #${chart}. Row data:`, JSON.stringify(row));
                        skipped++;
                        continue;
                    }
                    if (!dateKey || !row[dateKey]) {
                        console.log(`[SKIP ROW ${i + 1}] History upload missing Date mapping for Chart #${chart}. Row data:`, JSON.stringify(row));
                        skipped++;
                        continue;
                    }

                    await ProceduresHistory.create({
                        chartNumber: chart,
                        patientName: row[nameKey] || 'Unknown Patient',
                        procedure: row[procKey],
                        dateOfService: new Date(row[dateKey])
                    });
                    imported++;
                }
                uploadProgress.current = imported;
            }
            console.log(`=== [UPLOAD FINISHED] Imported: ${imported} | Skipped: ${skipped} ===\n`);
            uploadProgress.active = false;
            fs.unlinkSync(req.file.path);
            res.json({ success: true, imported, skipped });
        });
});

app.get('/api/upload/status', (req, res) => res.json(uploadProgress));

app.post('/api/schedules/batch', async (req, res) => {
    const { location, physician, entries } = req.body;
    for (const e of entries) {
        const cleanChart = e.chartNumber.toString().trim().replace(/[^a-zA-Z0-9]/g, '');
        const p = await Patient.findOne({ chartNumber: cleanChart });
        
        if (p && p.isOptedOut) continue; 

        // SMART MERGE LOGIC: Check for existing active task in pool
        const existingTask = await CallTask.findOne({ chartNumber: cleanChart, addressed: false });

        if (existingTask) {
            // Merge qualifying tests (deduplicate)
            const newQual = (e.qualifyingTests || '').split(',').map(s => s.trim()).filter(Boolean);
            const oldQual = (existingTask.qualifyingTests || '').split(',').map(s => s.trim()).filter(Boolean);
            existingTask.qualifyingTests = [...new Set([...oldQual, ...newQual])].join(',');

            // Merge recommended screenings (deduplicate)
            const newReco = (e.recommendedScreenings || '').split(',').map(s => s.trim()).filter(Boolean);
            const oldReco = (existingTask.recommendedScreenings || '').split(',').map(s => s.trim()).filter(Boolean);
            existingTask.recommendedScreenings = [...new Set([...oldReco, ...newReco])].join(',');

            // Update clinical notes if new ones are provided, else keep old
            if(e.dx) existingTask.dx = e.dx;
            if(e.hx) existingTask.hx = e.hx;
            if(e.rx) existingTask.rx = e.rx;

            // Update context to latest appointment
            existingTask.location = location;
            existingTask.physician = physician;
            existingTask.time = e.time;
            
            await existingTask.save();
        } else {
            // Create New Task if none exists in pool
            await CallTask.create({ ...e, chartNumber: cleanChart, patientId: p?._id, location, physician });
        }
    }
    res.json({ success: true });
});

// --- APPOINTMENTS ENGINE (CLOSED LOOP) ---
app.get('/api/appointments', async (req, res) => {
    const appointments = await Appointment.find().sort({ date: 1, time: 1 });
    res.json(appointments);
});

app.post('/api/appointments/:id/noshow', async (req, res) => {
    const appt = await Appointment.findById(req.params.id);
    if (!appt) return res.status(404).send("Not found");
    
    await InteractionLog.create({ 
        patientName: appt.patientName, 
        staff: "System", 
        outcome: "No-Show", 
        channel: "Auto", 
        messageContent: `Patient No-Showed for ${appt.procedure} on ${appt.date}. Returned to pool.` 
    });

    const existingTask = await CallTask.findOne({ chartNumber: appt.chartNumber, addressed: false });
    if (existingTask) {
        const oldQual = (existingTask.qualifyingTests || '').split(',').map(s => s.trim()).filter(Boolean);
        existingTask.qualifyingTests = [...new Set([...oldQual, appt.procedure])].join(',');
        await existingTask.save();
    } else {
        await CallTask.create({ 
            patientId: appt.patientId, 
            patientName: appt.patientName, 
            chartNumber: appt.chartNumber, 
            qualifyingTests: appt.procedure, 
            location: appt.location, 
            physician: appt.physician 
        });
    }

    await Appointment.findByIdAndDelete(req.params.id);
    res.json({ success: true });
});

app.post('/api/appointments/:id/complete', async (req, res) => {
    const appt = await Appointment.findById(req.params.id);
    if (!appt) return res.status(404).send("Not found");

    await ProceduresHistory.create({
        chartNumber: appt.chartNumber,
        patientName: appt.patientName,
        procedure: appt.procedure,
        dateOfService: new Date()
    });

    await Appointment.findByIdAndDelete(req.params.id);
    res.json({ success: true });
});

// --- DRAFTS ---
app.get('/api/drafts', async (req, res) => {
    const drafts = await ScheduleDraft.find({}, 'name date location physician createdAt entries').sort({ updatedAt: -1 });
    const result = drafts.map(d => ({ _id: d._id, name: d.name, date: d.date, location: d.location, physician: d.physician, count: d.entries.length, updatedAt: d.updatedAt }));
    res.json(result);
});

app.get('/api/drafts/:id', async (req, res) => { res.json(await ScheduleDraft.findById(req.params.id)); });
app.post('/api/drafts', async (req, res) => { const { name, location, physician, date, entries } = req.body; const draft = await ScheduleDraft.create({ name, location, physician, date, entries }); res.json({ success: true, id: draft._id }); });
app.put('/api/drafts/:id', async (req, res) => { const { name, location, physician, date, entries } = req.body; await ScheduleDraft.findByIdAndUpdate(req.params.id, { name, location, physician, date, entries, updatedAt: new Date() }); res.json({ success: true }); });
app.delete('/api/drafts/:id', async (req, res) => { await ScheduleDraft.findByIdAndDelete(req.params.id); res.json({ success: true }); });

// --- CORE ROUTES ---

app.get('/api/calls', async (req, res) => {
    const { page = 1, limit = 10, search = "", type = "all" } = req.query; 
    
    const startOfToday = new Date(); startOfToday.setHours(0,0,0,0);

    // Only reset attemptCount if they haven't been called today
    await CallTask.updateMany(
        { lastAttemptDate: { $lt: startOfToday }, attemptCount: { $gt: 0 } }, 
        { $set: { attemptCount: 0 } }
    );

    let query = {};
    
    if (type === 'workspace') {
        query.assignedTo = req.query.staff;
    } else {
        query.addressed = false;
        query.assignedTo = null;
        
        // GLOBAL BAN MAINTAINED: Infinite loop active, no 3-strike limit
        query.$and = [
            { $or: [ { lastAttemptDate: null }, { lastAttemptDate: { $lt: startOfToday } }, { lastAttemptDate: { $exists: false } } ] },
            { $or: [ { skipUntil: null }, { skipUntil: { $lte: new Date() } }, { skipUntil: { $exists: false } } ] }
        ];
    }
    
    if (search) {
        const searchRegex = new RegExp(search, 'i');
        const searchConditions = {
            $or: [
                { patientName: searchRegex }, 
                { chartNumber: searchRegex },
                { location: searchRegex },
                { physician: searchRegex },
                { qualifyingTests: searchRegex },
                { recommendedScreenings: searchRegex }
            ]
        };

        if (query.$and) {
            query.$and.push(searchConditions);
        } else {
            query.$and = [searchConditions];
        }
    }
    
    const tasks = await CallTask.find(query).populate('patientId').sort({ createdAt: -1 }).skip((page-1)*limit).limit(parseInt(limit));
    const total = await CallTask.countDocuments(query);
    res.json({ tasks, totalPages: Math.ceil(total / limit) });
});

app.post('/api/calls/allocate', async (req, res) => {
    const { limit, staff, type } = req.body;
    
    const startOfDay = new Date(); startOfDay.setHours(0,0,0,0);
    
    // GLOBAL BAN MAINTAINED: Allocation completely skips patients attempted today
    let query = { 
        addressed: false, 
        assignedTo: null,
        $and: [
            { $or: [ { lastAttemptDate: null }, { lastAttemptDate: { $lt: startOfDay } }, { lastAttemptDate: { $exists: false } } ] },
            { $or: [ { skipUntil: null }, { skipUntil: { $lte: new Date() } }, { skipUntil: { $exists: false } } ] }
        ]
    };
    
    let tasks;
    if (type === 'dos_10') {
        const tenDaysAgo = new Date(); tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);
        tasks = await CallTask.find({ ...query, createdAt: { $gte: tenDaysAgo } }).limit(parseInt(limit));
        if (tasks.length < limit) {
            const more = await CallTask.find({ ...query, _id: { $nin: tasks.map(t=>t._id) } }).limit(limit - tasks.length);
            tasks = tasks.concat(more);
        }
    } else {
        tasks = await CallTask.find(query).limit(parseInt(limit));
    }
    
    await CallTask.updateMany({ _id: { $in: tasks.map(t => t._id) } }, { assignedTo: staff });
    res.json({ success: true, tasks });
});

app.post('/api/calls/claim', async (req, res) => { await CallTask.findByIdAndUpdate(req.body.taskId, { assignedTo: req.body.staff }); res.json({ success: true }); });
app.post('/api/calls/release', async (req, res) => { await CallTask.updateMany({ assignedTo: req.body.staff, addressed: false }, { assignedTo: null }); res.json({ success: true }); });

// --- ADMIN LIVE MONITOR ROUTES ---
app.get('/api/admin/workspaces', async (req, res) => {
    try {
        const tasks = await CallTask.find({ addressed: false, assignedTo: { $ne: null } }).sort({ patientName: 1 });
        const workspaces = {};
        tasks.forEach(t => {
            if (!workspaces[t.assignedTo]) workspaces[t.assignedTo] = [];
            workspaces[t.assignedTo].push(t);
        });
        res.json(workspaces);
    } catch(e) { res.status(500).json({error: e.message}); }
});

app.post('/api/admin/workspaces/release', async (req, res) => {
    try {
        await CallTask.updateMany({ assignedTo: req.body.staff, addressed: false }, { assignedTo: null });
        res.json({ success: true });
    } catch(e) { res.status(500).json({error: e.message}); }
});

app.get('/api/patients/view', async (req, res) => {
    const patient = await Patient.findOne({ chartNumber: req.query.chartNumber });
    const history = await ProceduresHistory.find({ chartNumber: req.query.chartNumber }).sort({ dateOfService: -1 });
    const logs = await InteractionLog.find({ patientName: patient?.patientName }).sort({ timestamp: -1 });
    res.json({ patient, history, logs });
});

app.get('/api/config', async (req, res) => {
    const cfg = await SystemConfig.find();
    const result = { locations: [], physicians: [], procedures: [], sms_templates: [], email_templates: [], central_email: [] };
    cfg.forEach(c => result[c.key] = c.values);
    res.json(result);
});

app.post('/api/config/:key', async (req, res) => { await SystemConfig.findOneAndUpdate({ key: req.params.key }, { $addToSet: { values: req.body.value } }, { upsert: true }); res.sendStatus(200); });
app.delete('/api/config/:key/:value', async (req, res) => { await SystemConfig.findOneAndUpdate({ key: req.params.key }, { $pull: { values: req.params.value } }); res.sendStatus(200); });

app.get('/api/stats', async (req, res) => {
    const total = await InteractionLog.countDocuments();
    const success = await InteractionLog.countDocuments({ outcome: 'Scheduled' });
    
    const startOfToday = new Date(); startOfToday.setHours(0,0,0,0);
    
    // GLOBAL BAN MAINTAINED: Ensures the dashboard stats accurately reflect the hidden/banned tasks
    const pendingQuery = { 
        addressed: false, 
        assignedTo: null,
        $and: [
            { $or: [ { lastAttemptDate: null }, { lastAttemptDate: { $lt: startOfToday } }, { lastAttemptDate: { $exists: false } } ] },
            { $or: [ { skipUntil: null }, { skipUntil: { $lte: new Date() } }, { skipUntil: { $exists: false } } ] }
        ]
    };
    
    res.json({ 
        totalPatients: await Patient.countDocuments(), 
        pendingTasks: await CallTask.countDocuments(pendingQuery), 
        successRate: total ? Math.round((success / total) * 100) : 0, 
        totalOutreaches: total 
    });
});

app.get('/api/logs', async (req, res) => {
    const { page = 1, limit = 10, staff = "", search = "", startDate, endDate } = req.query;
    let query = {};
    if (staff) query.staff = staff;
    
    if (search) {
        query.$or = [
            { patientName: new RegExp(search, 'i') },
            { outcome: new RegExp(search, 'i') },
            { staff: new RegExp(search, 'i') },
            { messageContent: new RegExp(search, 'i') }
        ];
    }

    if (startDate && endDate) {
        const start = new Date(startDate);
        start.setHours(0,0,0,0);
        const end = new Date(endDate);
        end.setHours(23,59,59,999);
        query.timestamp = { $gte: start, $lte: end };
    }

    if (limit === 'all') {
        const logs = await InteractionLog.find(query).sort({ timestamp: -1 });
        return res.json({ logs });
    }

    const logs = await InteractionLog.find(query).sort({ timestamp: -1 }).skip((page-1)*limit).limit(parseInt(limit));
    const total = await InteractionLog.countDocuments(query);
    res.json({ logs, totalPages: Math.ceil(total / limit) });
});

app.get('/api/patients/find', async (req, res) => { const p = await Patient.findOne({ chartNumber: req.query.chartNumber.toString().trim().replace(/[^a-zA-Z0-9]/g, '') }); res.json(p || {}); });
app.get('/api/staff', async (req, res) => res.json(await Staff.find()));
app.post('/api/staff', async (req, res) => res.json(await Staff.create(req.body)));
app.delete('/api/staff/:id', async (req, res) => { await Staff.findByIdAndDelete(req.params.id); res.sendStatus(200); });
app.post('/api/staff/:id/verify-rc', async (req, res) => {
    const staff = await Staff.findById(req.params.id); if (!staff) return res.sendStatus(404);
    staff.rcExtensionId = "rc-ext-" + Math.floor(Math.random() * 9999); staff.directLine = "+1888" + Math.floor(1000000 + Math.random() * 9000000); staff.isRcVerified = true; await staff.save(); res.json(staff);
});
app.post('/api/admin/login', (req, res) => { if (req.body.password === (process.env.ADMIN_PASSWORD || 'admin')) return res.json({ success: true }); res.status(401).json({ success: false }); });

app.use(express.static(__dirname));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

const PORT = process.env.PORT || 3000;
mongoose.connect(process.env.MONGO_URI).then(() => app.listen(PORT, () => console.log(`PLEXUS ENTERPRISE v48.7 ACTIVE ON PORT ${PORT}`)));