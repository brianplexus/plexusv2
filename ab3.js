/**
 * PLEXUS ANCILLARY SERVICES BOT & PORTAL
 * Version: 14.5 - FIXED FILTERING FOR COMPLETED RECORDS
 * Database: 1xSbmZhjnYpscbdBg-cZM4vgiw3L2mjo5mQejpLt5Vyk
 */

const SPREADSHEET_ID = '1xSbmZhjnYpscbdBg-cZM4vgiw3L2mjo5mQejpLt5Vyk';
const SHEET_NAME = 'Prescreen';
const DATABASE_SHEET_NAME = 'Prescreen Database';
const USER_SHEET_NAME = 'Users'; 
const NOTIF_SHEET_NAME = 'Notifications';

// Standard Clinic Roots (Ultrasounds)
const DRIVE_FOLDER_MAP = {
  'NWPG': '1IntPI_C59o7Csy_gywlLhbBcZCa9T5GD',
  'TFP': '1liEqz4XhrpfoSwzrnk-JdYCOzthqoMIC'
};

// Specialized Ancillary Roots (Date-Folder Logic)
const SPECIAL_ANC_MAP = {
  'NWPG': {
    'BrainWave': '1UzH26tjw3UgC7M52pnc9ulUe3SPl-751',
    'VitalWave': '126BP9kpYDkTgszMMgVEaQcdhXf-xi6vd'
  },
  'TFP': {
    'BrainWave': '1hTMD3qAI947RbOCYzR4DXjclzs0t0GR_',
    'VitalWave': '18kELu2m9JHT-2RE5-8FnIZVC68-JIhq7'
  }
};

/**
 * ==========================================
 * PART 1: SYSTEM HELPERS & SECURITY
 * ==========================================
 */

function getAuthorizedUser(email) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let userSheet = ss.getSheetByName(USER_SHEET_NAME);
  if (!userSheet) {
    if (email === Session.getEffectiveUser().getEmail().toLowerCase()) return { name: "Admin", role: "PHYSICIAN" };
    return { name: email.split('@')[0], role: "STAFF" };
  }
  const data = userSheet.getDataRange().getValues();
  const searchEmail = email.toLowerCase().trim();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0].toString().toLowerCase().trim() === searchEmail) {
      return {
        name: data[i][1],
        role: data[i][2].toString().toUpperCase().trim(),
        threshold: data[i][6],  // G
        vPercent: data[i][7],   // H
        oPercent: data[i][8],   // I
        capacity: data[i][9]    // J
      };
    }
  }
  return { name: email.split('@')[0], role: 'STAFF' };
}

function getUserIdentity() {
  const email = Session.getActiveUser().getEmail().toLowerCase();
  const user = getAuthorizedUser(email);
  user.email = email; 
  return user;
}

function getLinksObj(agValue) {
  let links = { US: "", BrainWave: "", VitalWave: "" };
  if (!agValue) return links;
  let parts = agValue.toString().split(",");
  parts.forEach(p => {
    let pair = p.split(": ");
    if (pair.length >= 2) {
      let key = pair[0].trim();
      let val = pair.slice(1).join(": ").trim();
      if (key === "US") links.US = val;
      else if (key === "BrainWave") links.BrainWave = val;
      else if (key === "VitalWave") links.VitalWave = val;
    }
  });
  return links;
}

function formatLinksString(obj) {
  let parts = [];
  if (obj.US) parts.push("US: " + obj.US);
  if (obj.BrainWave) parts.push("BrainWave: " + obj.BrainWave);
  if (obj.VitalWave) parts.push("VitalWave: " + obj.VitalWave);
  return parts.join(", ");
}

function doGet(e) {
  const template = getHtmlUI();
  return HtmlService.createHtmlOutput(template)
    .setTitle('Plexus Ancillary Portal')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * ==========================================
 * PART 2: CLINICAL ACTIONS & NOTIFICATIONS
 * ==========================================
 */

function processWebAction(rowIndex, status, comment) {
  const email = Session.getActiveUser().getEmail().toLowerCase();
  const user = getAuthorizedUser(email);
  if (user.role !== 'PHYSICIAN') throw new Error("Access Denied.");
  
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEET_NAME);
  const row = Number(rowIndex);
  const patientName = sheet.getRange(row, 4).getValue();
  
  let statusText = status.toUpperCase();
  if (status === 'Needs Correction' && comment) {
    statusText += ": " + comment;
    const notifSheet = ss.getSheetByName(NOTIF_SHEET_NAME);
    if (notifSheet) {
      notifSheet.appendRow(['Correction', `${patientName} has corrections needed.`, rowIndex, new Date(), ""]);
    }
  }
  sheet.getRange(row, 27).setValue(statusText); 
  
  if (status === 'Approved') {
    const isReviewed = sheet.getRange(row, 28).getValue(); 
    const targetCol = isReviewed ? 29 : 28; 
    sheet.getRange(row, targetCol).setValue(user.name);
  }
  return { success: true };
}

function finalizeReport(rowIndex, mrn) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEET_NAME);
  const row = Number(rowIndex);
  
  const rowData = sheet.getRange(row, 1, 1, 17).getValues()[0];
  const requiredIndices = [0,1,2,3,4,6,9,11,14,15,16]; 
  
  for (let idx of requiredIndices) {
    if (!rowData[idx] || rowData[idx].toString().trim() === "") {
      const colLabel = String.fromCharCode(65 + idx);
      throw new Error(`Incomplete Data: Column ${colLabel} is empty.`);
    }
  }
  sheet.getRange(row, 23).setValue(true); 
  return { success: true };
}

function getUnreadNotifications() {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(NOTIF_SHEET_NAME);
    if (!sheet) return [];
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return [];
    const data = sheet.getRange(2, 1, lastRow - 1, 5).getValues();
    return data.map((row, index) => ({ id: index + 2, message: row[1], targetRow: row[2], readBy: row[4] })).filter(n => !n.readBy).reverse();
  } catch (e) { return []; }
}

function markNotificationAsRead(notifRowId) {
  const email = Session.getActiveUser().getEmail().toLowerCase();
  SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(NOTIF_SHEET_NAME).getRange(notifRowId, 5).setValue(email);
  return true;
}

/**
 * ==========================================
 * PART 3: CALL LIST ASSIGNMENT ENGINE
 * ==========================================
 */

function generateUserCallList() {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000); 
    const email = Session.getActiveUser().getEmail().toLowerCase();
    const user = getAuthorizedUser(email);
    
    if (!user || !user.capacity) throw new Error("User metrics not found. Ensure Threshold and Capacity are set.");
    
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const dbSheet = ss.getSheetByName(DATABASE_SHEET_NAME);
    if (!dbSheet) throw new Error("Database sheet not found.");
    
    const lastRow = dbSheet.getLastRow();
    if (lastRow < 2) throw new Error("No patients available in database.");
    
    // Fetch up to Column AV (index 47)
    const data = dbSheet.getRange(2, 1, lastRow - 1, 48).getValues(); 
    
    const vTarget = Math.floor(user.capacity * (user.vPercent || 0));
    const oTarget = Math.floor(user.capacity * (user.oPercent || 0));
    
    let vCount = 0;
    let oCount = 0;
    let assignedCount = 0;

    let pool = [];
    for (let i = 0; i < data.length; i++) {
      const assigned = data[i][43];
      const flagAV = data[i][47]; // Column AV
      
      // Filter out assigned patients AND patients already completed (Flag 0 or 1)
      const isCompleted = (flagAV === 0 || flagAV === 1 || flagAV === "0" || flagAV === "1");
      if (!assigned && !isCompleted) {
        pool.push({ index: i + 2, row: data[i] });
      }
    }
    
    // Fisher-Yates Shuffle
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }

    for (let item of pool) {
      const type = (item.row[2] || "").toString().trim(); 
      let assignThis = false;
      
      if (type === "Visit" && vCount < vTarget) {
        vCount++;
        assignThis = true;
      } else if (type === "Outreach" && oCount < oTarget) {
        oCount++;
        assignThis = true;
      }
      
      if (assignThis) {
        dbSheet.getRange(item.index, 44).setValue(email); 
        assignedCount++;
      }
      if (assignedCount >= user.capacity) break;
    }
    
    return { success: true, count: assignedCount };
  } catch (e) {
    throw new Error(e.message);
  } finally {
    lock.releaseLock();
  }
}

function logCallAction(logData) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const email = Session.getActiveUser().getEmail();
  const user = getAuthorizedUser(email);
  const contactedBy = user.name || email; 
  
  // 1. Update Flag in Database (Column AV)
  const dbSheet = ss.getSheetByName(DATABASE_SHEET_NAME);
  if (dbSheet && logData.rowIndex) {
    let flag = 2; // Default: Callback
    const doNotCallList = ["Patient declined", "Wrong number", "Disconnected number", "Not eligible"];
    if (doNotCallList.includes(logData.outcome)) {
      flag = 0;
    } else if (logData.outcome === "Scheduled") {
      flag = 1;
    }
    dbSheet.getRange(logData.rowIndex, 48).setValue(flag);
  }

  // 2. Add to Call Logs
  let logSheet = ss.getSheetByName('Call_Logs');
  if (!logSheet) {
    logSheet = ss.insertSheet('Call_Logs');
    logSheet.appendRow(['Clinic', 'Clinician', 'Patient Type', 'Patient Name', 'Patient ID', 'Date Called', 'Outcome', 'Contacted By', 'Duration']);
  }
  logSheet.appendRow([
    logData.clinic,
    logData.clinician,
    logData.type,
    logData.name,
    logData.mrn,
    new Date(),
    logData.outcome,
    contactedBy,
    logData.duration // Saved on column I
  ]);
  
  return { success: true };
}

function schedulePatientAction(data) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  
  // 1. Calendar Integration
  const cal = CalendarApp.getCalendarById('info@plexusclinical.com') || CalendarApp.getDefaultCalendar();
  
  data.schedules.forEach(item => {
    if (item.dateTime) {
      const start = new Date(item.dateTime);
      const end = new Date(start.getTime() + (30 * 60000)); 
      const title = `${data.name} - ${data.clinic} - ${item.procedure}`;
      cal.createEvent(title, start, end);
    }
  });

  // 2. Logging to Scheduled_List
  let schedSheet = ss.getSheetByName('Scheduled_List');
  if (!schedSheet) {
    schedSheet = ss.insertSheet('Scheduled_List');
    schedSheet.appendRow(['Date Scheduled', 'Patient Name', 'MRN', 'Clinic', 'Procedure', 'Appointment Time']);
  }
  
  data.schedules.forEach(item => {
    if (item.dateTime) {
      schedSheet.appendRow([new Date(), data.name, data.mrn, data.clinic, item.procedure, item.dateTime]);
    }
  });

  // 3. Update Database Flag to 1 (Scheduled)
  const dbSheet = ss.getSheetByName(DATABASE_SHEET_NAME);
  if (dbSheet && data.rowIndex) {
    dbSheet.getRange(data.rowIndex, 48).setValue(1);
  }

  return { success: true };
}

function createPatientFolderAction(rowIndex, type) {
  try {
    const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_NAME);
    const rowData = sheet.getRange(rowIndex, 1, 1, 33).getValues()[0];
    const clinic = (rowData[0] || "").toString().trim();
    const fullName = (rowData[3] || "").toString().trim();
    const currentAg = rowData[32]; 
    
    const upperClinic = clinic.toUpperCase();
    const clinicKey = Object.keys(DRIVE_FOLDER_MAP).find(k => upperClinic.includes(k));
    if (!clinicKey) throw new Error("Clinic matching failed.");

    let folderName = fullName;
    if (!fullName.includes(",")) {
      const parts = fullName.split(" ").filter(p => p.trim() !== "");
      if (parts.length > 1) { folderName = parts.pop() + ", " + parts.join(" "); }
    }
    folderName = folderName.toUpperCase();

    let targetParentId;
    let isSpecial = false;

    if (type === 'BrainWave') { targetParentId = SPECIAL_ANC_MAP[clinicKey]['BrainWave']; isSpecial = true; }
    else if (type === 'VitalWave') { targetParentId = SPECIAL_ANC_MAP[clinicKey]['VitalWave']; isSpecial = true; }
    else { targetParentId = DRIVE_FOLDER_MAP[clinicKey]; }

    let parentFolder = DriveApp.getFolderById(targetParentId);

    if (isSpecial) {
      const dateStr = Utilities.formatDate(new Date(), "GMT-7", "MM-dd-yyyy");
      const existingDateFolders = parentFolder.getFoldersByName(dateStr);
      parentFolder = existingDateFolders.hasNext() ? existingDateFolders.next() : parentFolder.createFolder(dateStr);
    }

    const existingFolders = parentFolder.getFoldersByName(folderName);
    let targetFolder = existingFolders.hasNext() ? existingFolders.next() : parentFolder.createFolder(folderName);
    try { targetFolder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.EDIT); } catch (e) {}
    
    const folderUrl = targetFolder.getUrl();
    let links = getLinksObj(currentAg);
    if (type === 'Ultrasound') links.US = folderUrl;
    else if (type === 'BrainWave') links.BrainWave = folderUrl;
    else if (type === 'VitalWave') links.VitalWave = folderUrl;

    sheet.getRange(Number(rowIndex), 33).setValue(formatLinksString(links)); 
    return { success: true, url: folderUrl, name: folderName, type: type };
  } catch (e) { throw new Error(e.message); }
}

function closeUserSession() {
  const email = Session.getActiveUser().getEmail().toLowerCase();
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const dbSheet = ss.getSheetByName(DATABASE_SHEET_NAME);
  if (!dbSheet) return { success: false };
  const lastRow = dbSheet.getLastRow();
  if (lastRow < 2) return { success: true };
  const data = dbSheet.getRange(2, 44, lastRow - 1, 1).getValues();
  for (let i = 0; i < data.length; i++) {
    if (data[i][0].toString().toLowerCase() === email) {
      dbSheet.getRange(i + 2, 44).clearContent();
    }
  }
  return { success: true };
}

/**
 * ==========================================
 * PART 4: WEB PORTAL API FUNCTIONS
 * ==========================================
 */

function getDashboardStats(sheetName = SHEET_NAME) {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(sheetName);
  const lastRow = sheet.getLastRow();
  const startRow = (sheetName === SHEET_NAME) ? 4 : 2;
  if (lastRow < startRow) return { reviews: 0, approvals: 0, uploads: 0, incomplete: 0, rows: [] };
  
  // Fetch up to Column AV (index 47) to get the Flag
  const data = sheet.getRange(startRow, 1, lastRow - startRow + 1, 48).getValues();
  let stats = { reviews: 0, approvals: 0, uploads: 0, incomplete: 0, rows: [] };
  
  data.forEach((row, i) => {
    const type = row[2] || "Visit", requiredIndices = [0,1,2,3,4,6,9,11,14,15,16]; 
    let isDataMissing = false;
    for (let cIdx of requiredIndices) { if (!row[cIdx] || row[cIdx].toString().trim() === "") { isDataMissing = true; break; } }
    
    const reviewDr = row[27], approveDr = row[28], agValue = row[32], statusW = row[22], assignedTo = row[43];
    const flagAV = row[47]; // Column AV (The Flag)

    // SERVER-SIDE FILTER: If this is the Database sheet and the flag is 0 or 1, SKIP adding to rows
    if (sheetName === DATABASE_SHEET_NAME && (flagAV === 0 || flagAV === 1 || flagAV === "0" || flagAV === "1")) {
      return; 
    }
    
    const isUploaded = (agValue && agValue.toString().includes("http"));
    const item = { 
      index: i + startRow, 
      name: row[3] || "Unnamed", 
      clinic: row[0], 
      type: type, 
      mrn: row[4], 
      uploaded: isUploaded, 
      isIncomplete: isDataMissing, 
      assignedEmail: (assignedTo || "").toString().toLowerCase(),
      flag: flagAV
    };
    
    if (isDataMissing) { stats.incomplete++; item.status = "Pending Data"; } else {
      const isReviewReady = (statusW === true || statusW === "TRUE") && !reviewDr;
      const isApproveReady = reviewDr && !approveDr;
      const isMissingUpload = !isUploaded;
      if (isReviewReady) stats.reviews++; if (isApproveReady) stats.approvals++; if (isMissingUpload) stats.uploads++;
      item.status = approveDr ? "Approved" : (reviewDr ? "Reviewed" : (statusW ? "Ready for Review" : "In Progress"));
    }
    stats.rows.push(item);
  });
  return stats;
}

function getPatientDetails(rowIndex, sheetName = SHEET_NAME) {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(sheetName);
  const rowData = sheet.getRange(rowIndex, 1, 1, 40).getValues()[0];
  const formatDate = (val) => val instanceof Date ? Utilities.formatDate(val, "GMT-7", "MM/dd/yyyy") : val;
  const links = getLinksObj(rowData[32]), requiredIndices = [0,1,2,3,4,6,9,11,14,15,16]; 
  let isDataMissing = false;
  for (let cIdx of requiredIndices) { if (!rowData[cIdx] || rowData[cIdx].toString().trim() === "") { isDataMissing = true; break; } }
  const statusW = rowData[22], reviewDr = rowData[27], approveDr = rowData[28];
  return {
    index: rowIndex, clinic: rowData[0], clinician: rowData[1], type: rowData[2], name: rowData[3],
    mrn: rowData[4], dateAdded: formatDate(rowData[5]), dob: formatDate(rowData[6]), age: rowData[7], sex: rowData[8], phone: rowData[9], email: rowData[10], insurance: rowData[11],
    hx: rowData[14], dx: rowData[15], rx: rowData[16], qual: rowData[17], prev: rowData[18],
    plexusPdf: rowData[20], clinicianPdf: rowData[21],
    clinicalDecision: rowData[26], status: approveDr ? "Approved" : (reviewDr ? "Reviewed" : (statusW ? "Ready for Review" : "In Progress")), isReadyW: statusW, isIncomplete: isDataMissing,
    usLink: links.US, bwLink: links.BrainWave, vwLink: links.VitalWave
  };
}

function savePatientRecord(formData, sheetName = SHEET_NAME) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(sheetName);
  let row = (formData.index && formData.index !== "") ? Number(formData.index) : (sheetName === SHEET_NAME ? 4 : 2);
  if (!formData.index) { const startAt = (sheetName === SHEET_NAME ? 3 : 1); sheet.insertRowAfter(startAt); }
  const values = [[
    formData.clinic, formData.clinician, formData.type, formData.name, formData.mrn,
    formData.dateAdded || new Date(), formData.dob, formData.age, formData.sex, formData.phone,
    formData.email, formData.insurance, "", "", formData.hx, formData.dx, formData.rx, formData.qual
  ]];
  sheet.getRange(row, 1, 1, 18).setValues(values);
  return { success: true };
}

function getParameterData() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const paramSheet = ss.getSheetByName('Parameters');
  if (!paramSheet) return { clinics: [], mapping: {} };
  const data = paramSheet.getRange(2, 1, Math.max(1, paramSheet.getLastRow() - 1), 2).getValues();
  let mapping = {};
  data.forEach(row => {
    const clinic = row[0].toString().trim(), doctor = row[1].toString().trim();
    if (clinic && doctor) {
      if (!mapping[clinic]) mapping[clinic] = [];
      if (!mapping[clinic].includes(doctor)) mapping[clinic].push(doctor);
    }
  });
  return { clinics: Object.keys(mapping).sort(), mapping: mapping };
}


/**
 * ==========================================
 * PART 5: GOOGLE CHAT BOT HANDLERS
 * ==========================================
 */

function onMessage(event) {
  const user = event.user || {}, displayName = user.displayName || "User";
  const text = (event.message && event.message.text) ? event.message.text.trim() : "";
  if (event.message?.slashCommand && event.message.slashCommand.commandId === "1") return { "text": "Hello " + displayName + "! I am the Plexus Bot." };
  if (text.length > 2) {
    const results = lookupPatientData(text);
    if (results && results !== "No records found.") return { "text": "🔎 *Results for: " + text + "*\n\n" + results };
  }
  return { "cardsV2": [createMainMenuCard(displayName)] };
}

function onCardClick(event) {
  const actionMethod = (event.common && event.common.invokedFunction) || (event.action && event.action.function) || "UNKNOWN";
  const getParam = (key) => {
    const params = (event.common && event.common.parameters) || (event.action && event.action.parameters) || {};
    return params[key] || (Array.isArray(params) ? (params.find(p => p.key === key)?.value || null) : null);
  };
  const rowIndex = getParam('rowIndex');
  switch (actionMethod) {
    case 'viewReviews': return { "actionResponse": { "type": "UPDATE_MESSAGE" }, "cardsV2": [createReviewQueueCard('Review')] };
    case 'viewApprovals': return { "actionResponse": { "type": "UPDATE_MESSAGE" }, "cardsV2": [createReviewQueueCard('Approve')] };
    case 'openDetails': return { "actionResponse": { "type": "UPDATE_MESSAGE" }, "cardsV2": [createPatientDetailCard(rowIndex, getParam('mode'))] };
    case 'processReview': return handleClinicalAction(event, rowIndex, 28, 'Approve');
    case 'processApproval': return handleClinicalAction(event, rowIndex, 29, 'Done');
    case 'startOver': return { "actionResponse": { "type": "UPDATE_MESSAGE" }, "cardsV2": [createMainMenuCard(event.user.displayName)] };
    default: return { "text": "Bot Action Recognized." };
  }
}

function lookupPatientData(query) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID), sheet = ss.getSheetByName(SHEET_NAME);
  const data = sheet.getRange(4, 1, Math.max(1, sheet.getLastRow() - 3), 30).getValues();
  const searchStr = query.toLowerCase();
  let results = [];
  for (let i = 0; i < data.length; i++) {
    const ptName = data[i][3], ptID = data[i][4], status = data[i][22], approval = data[i][28];
    if (ptName.toString().toLowerCase().includes(searchStr) || ptID.toString().toLowerCase().includes(searchStr)) {
      results.push(`*${ptName}* (${ptID})\nStatus: ${status ? '✅ Ready' : '⏳ Pending'} | Approved: ${approval || "❌"}`);
    }
  }
  return results.length > 0 ? results.join("\n\n") : "No records found.";
}

function createMainMenuCard(displayName) {
  return { "cardId": "menu", "card": { "header": { "title": "Plexus Bot", "subtitle": displayName, "imageUrl": "https://gstatic.com/images/icons/material/system/2x/smart_toy_gm_blue_48dp.png", "imageType": "CIRCLE" }, "sections": [{ "widgets": [
    { "decoratedText": { "startIcon": { "knownIcon": "DESCRIPTION" }, "text": "<b>Review Queue</b>", "button": { "text": "OPEN", "onClick": { "action": { "function": "viewReviews" } } } } },
    { "decoratedText": { "startIcon": { "knownIcon": "PERSON" }, "text": "<b>Approve Queue</b>", "button": { "text": "OPEN", "onClick": { "action": { "function": "viewApprovals" } } } } }
  ]}] } };
}

function createReviewQueueCard(mode) {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_NAME);
  const data = sheet.getRange(4, 1, Math.min(50, sheet.getLastRow() - 3), 30).getValues();
  const widgets = [];
  data.forEach((r, i) => { 
    if (r[3] && ((mode === 'Review' && r[22] && !r[27]) || (mode === 'Approve' && r[27] && !r[28]))) {
      widgets.push({ "decoratedText": { "topLabel": r[0], "text": "<b>" + r[3] + "</b>", "button": { "text": "DETAILS", "onClick": { "action": { "function": "openDetails", "parameters": [{ "key": "rowIndex", "value": (i + 4).toString() }, { "key": "mode", "value": mode }] } } } } });
    }
  });
  widgets.push({ "buttonList": { "buttons": [{ "text": "MAIN MENU", "onClick": { "action": { "function": "startOver" } } }] } });
  return { "cardId": "queue", "card": { "header": { "title": mode + " Queue" }, "sections": [{ "widgets": widgets }] } };
}

function createPatientDetailCard(i, s) {
  const r = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_NAME).getRange(i, 1, 1, 20).getValues()[0];
  return { "cardId": "det", "card": { "header": { "title": r[3], "subtitle": "MRN: " + (r[4] || "N/A") }, "sections": [
    { "header": "Clinical", "widgets": [{ "decoratedText": { "topLabel": "Dx", "text": r[15] || "N/A", "wrapText": true } }, { "decoratedText": { "topLabel": "History", "text": r[14] || "N/A", "wrapText": true } }] },
    { "widgets": [{ "buttonList": { "buttons": [{ "text": "BACK", "onClick": { "action": { "function": "startOver" } } }, { "text": s === 'Approve' ? "APPROVE" : "REVIEW", "onClick": { "action": { "function": s === 'Approve' ? "processApproval" : "processReview", "parameters": [{ "key": "rowIndex", "value": i.toString() }] } } }] } }] }
  ] } };
}

function handleClinicalAction(event, r, col, stage) {
  const email = (event.user?.email || "").toLowerCase(), user = getAuthorizedUser(email);
  if (user.role !== 'PHYSICIAN') return { "text": "❌ Unauthorized." };
  SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_NAME).getRange(Number(r), col).setValue(user.name);
  return { "actionResponse": { "type": "UPDATE_MESSAGE" }, "cardsV2": [createMainMenuCard(event.user.displayName)] };
}

// --- WEB INTERFACE (HTML/SPA) ---
function getHtmlUI() {
  return `
  <!DOCTYPE html>
  <html>
    <head>
      <script src="https://cdn.tailwindcss.com"></script>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
      <style>
        body { font-family: 'Inter', sans-serif; } 
        .sidebar-active { background: rgba(255,255,255,0.2); border-right: 4px solid #60a5fa; } 
        #loadingOverlay { backdrop-filter: blur(4px); z-index: 9999; }
        .tab-active { border-bottom: 3px solid #1e40af; color: #1e40af; font-weight: 800; }
        .ancillary-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 8px; }
        .custom-scrollbar::-webkit-scrollbar { width: 6px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 10px; }
        
        /* Modifying ONLY the Call List workspace CSS */
        .workspace-container { display: flex; height: calc(100vh - 120px); gap: 1.5rem; overflow: hidden; }
        .canvas-area { flex-grow: 1; background: white; border-radius: 3rem; border: 1px solid #e2e8f0; overflow-y: auto; padding: 2rem; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.05); }
        .card-sidebar { width: 340px; flex-shrink: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 1rem; }
        .patient-card { background: white; border: 2px solid #e2e8f0; border-radius: 1.5rem; padding: 1.25rem; cursor: pointer; transition: all 0.2s; }
        .card-active { border-color: #1e40af; background: #eff6ff; box-shadow: 0 4px 12px rgba(30,64,175,0.1); }
        .call-timer { background: #1e293b; color: #fbbf24; padding: 0.5rem 1.5rem; border-radius: 1rem; font-weight: 900; font-family: monospace; }
        
        .procedure-picker { border-left: 4px solid #3b82f6; padding-left: 1rem; margin-top: 1rem; background: #f8fafc; border-radius: 0.5rem; padding: 1rem; }
      </style>
    </head>
    <body class="bg-slate-50 flex h-screen overflow-hidden text-slate-800 font-medium">
      <div id="loadingOverlay" class="fixed inset-0 bg-white/50 flex items-center justify-center hidden"><div class="flex flex-col items-center"><div class="animate-spin rounded-full h-12 w-12 border-b-4 border-blue-900 mb-4"></div><p id="loadingMsg" class="text-blue-900 font-bold text-xs uppercase tracking-widest">Processing Request...</p></div></div>
      
      <aside class="w-64 bg-blue-900 text-white flex-shrink-0 flex flex-col shadow-xl">
        <div class="p-6 border-b border-blue-800"><h1 class="text-xl font-black tracking-tighter text-blue-100 italic uppercase">PLEXUS</h1><p class="text-blue-400 text-[10px] uppercase font-bold mt-1 tracking-widest">Portal v14.4</p></div>
        <nav class="flex-grow p-4 space-y-2">
          <div onclick="switchView('prescreen', this)" class="nav-btn sidebar-item p-3 rounded-xl cursor-pointer sidebar-active transition hover:bg-white/10"><span class="text-sm font-semibold">Prescreens</span></div>
          <div onclick="switchView('database', this)" class="nav-btn sidebar-item p-3 rounded-xl cursor-pointer transition hover:bg-white/10"><span class="text-sm font-semibold text-blue-300">All Patients</span></div>
          <div onclick="switchView('callList', this)" class="nav-btn sidebar-item p-3 rounded-xl cursor-pointer transition hover:bg-white/10"><span class="text-sm font-semibold text-green-300">Call List</span></div>
          <div class="pt-4 border-t border-blue-800"><div onclick="openAddForm()" class="sidebar-item p-3 rounded-xl cursor-pointer bg-blue-700 hover:bg-green-700 transition shadow-lg"><span class="text-sm font-bold text-white">+ Add Patient</span></div></div>
        </nav>
        <div class="p-6 border-t border-blue-800 text-[10px] text-blue-400 font-mono uppercase tracking-tighter leading-relaxed">User: <span id="userName" class="text-white">...</span></div>
      </aside>

      <div class="flex-grow flex flex-col overflow-hidden relative">
        <header class="bg-white border-b border-slate-200 p-6 flex justify-between shadow-sm items-center flex-shrink-0">
           <h2 id="viewTitle" class="text-lg font-black text-slate-700 uppercase italic tracking-tight">Live Pipeline</h2>
           <div class="flex gap-3">
              <div id="callListControls" class="hidden flex gap-3">
                 <button id="genCallBtn" onclick="generateCallList()" class="bg-blue-600 text-white px-6 py-2.5 rounded-xl text-[10px] font-black uppercase shadow-lg hover:bg-black transition">Generate Call List</button>
                 <button id="closeSessionBtn" onclick="closeSession()" class="hidden bg-red-600 text-white px-6 py-2.5 rounded-xl text-[10px] font-black uppercase shadow-lg hover:bg-black transition">Close Session</button>
              </div>
              <button onclick="refreshDashboardData()" class="text-xs bg-blue-900 text-white hover:bg-black px-6 py-2.5 rounded-xl font-bold shadow-md transition uppercase tracking-widest">Sync Registry</button>
           </div>
        </header>
        
        <main id="mainView" class="p-8 overflow-y-auto flex-grow bg-slate-50/50">
          <div id="summaryCards" class="grid grid-cols-1 md:grid-cols-4 gap-6 mb-10">
            <div onclick="filterTableBy('Ready for Review')" class="bg-white p-6 rounded-3xl border border-slate-100 cursor-pointer hover:shadow-xl transition shadow-sm"><p class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Needs Review</p><p id="statReviews" class="text-4xl font-black text-blue-600 tracking-tighter">0</p></div>
            <div onclick="filterTableBy('Reviewed')" class="bg-white p-6 rounded-3xl border border-slate-100 cursor-pointer hover:shadow-xl transition shadow-sm"><p class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Needs Approval</p><p id="statApprovals" class="text-4xl font-black text-orange-500 tracking-tighter">0</p></div>
            <div onclick="filterTableByUploads()" class="bg-white p-6 rounded-3xl border border-slate-100 cursor-pointer hover:shadow-xl transition shadow-sm"><p class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Missing Uploads</p><p id="statUploads" class="text-4xl font-black text-red-500 tracking-tighter">0</p></div>
            <div onclick="filterTableByIncomplete()" class="bg-white p-6 rounded-3xl border border-l-8 border-l-red-500 cursor-pointer hover:shadow-xl transition shadow-sm"><p class="text-[10px] font-black text-red-400 uppercase tracking-widest mb-2">Incomplete Data</p><p id="statIncomplete" class="text-4xl font-black text-red-600 tracking-tighter">0</p></div>
          </div>
          <div id="filterTabs" class="mb-6 flex space-x-10 border-b border-slate-200"></div>
          <div id="tableContainer" class="bg-white rounded-[2.5rem] shadow-2xl border border-slate-100 overflow-hidden">
            <div class="p-6 bg-slate-50 border-b flex justify-between items-center"><input type="text" id="tableSearch" onkeyup="searchTable()" placeholder="Global Search..." class="text-sm border rounded-2xl px-6 py-4 w-full max-w-lg outline-none focus:ring-4 focus:ring-blue-100 transition shadow-inner font-bold"></div>
            <table class="w-full text-left text-sm" id="mainTable">
              <thead class="bg-slate-50 text-slate-500 text-[10px] font-black uppercase border-b tracking-[0.2em]"><tr><th class="px-10 py-6 text-blue-900 font-black">Patient Identity</th><th class="px-10 py-6">Clinic Root</th><th class="px-10 py-6 text-center">MRN</th><th class="px-10 py-6 text-right">Status</th></tr></thead>
              <tbody id="tableBody" class="divide-y divide-slate-100"></tbody>
            </table>
          </div>
          
          <div id="callListContainer" class="hidden workspace-container">
             <div id="detailCanvas" class="canvas-area custom-scrollbar">
                <div class="h-full flex flex-col items-center justify-center text-slate-300 animate-pulse">
                  <p class="font-black uppercase tracking-widest text-sm">Select patient card from sidebar to view full details</p>
                </div>
             </div>
             <div id="cardSidebar" class="card-sidebar custom-scrollbar"></div>
          </div>
        </main>

        <main id="formView" class="p-8 hidden overflow-y-auto flex-grow bg-slate-100">
           <div class="max-w-5xl mx-auto bg-white p-12 rounded-[3rem] shadow-2xl border">
              <h3 id="formHeadline" class="text-2xl font-black text-slate-800 border-b pb-6 mb-8 uppercase tracking-tight text-center italic">Patient Registration</h3>
              <form id="patientForm" class="space-y-6">
                 <input type="hidden" id="formIndex">
                 <input type="hidden" id="formDateAdded">
                 <div class="grid grid-cols-1 md:grid-cols-3 gap-6 text-[10px] font-black">
                    <div><label class="text-slate-400 block mb-1 uppercase tracking-widest">Clinic</label><select id="formClinic" onchange="onClinicChange()" class="w-full border-2 rounded-2xl p-4 text-sm font-bold bg-white outline-none"></select></div>
                    <div><label class="text-slate-400 block mb-1 uppercase tracking-widest">Clinician</label><select id="formPhysician" class="w-full border-2 rounded-2xl p-4 text-sm font-bold bg-white"></select></div>
                    <div><label class="text-slate-400 block mb-1 uppercase tracking-widest">Type</label><select id="formType" class="w-full border-2 rounded-2xl p-4 text-sm font-bold bg-white"><option value="Visit">Visit</option><option value="Outreach">Outreach</option></select></div>
                 </div>
                 <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div><label class="text-[10px] font-black text-slate-400 block mb-1 uppercase tracking-widest">Full Name</label><input type="text" id="formName" required class="w-full border-2 rounded-2xl p-4 text-sm font-bold outline-none focus:border-blue-500" placeholder="LASTNAME, FIRSTNAME"></div>
                    <div><label class="text-[10px] font-black text-slate-400 block mb-1 uppercase tracking-widest">MRN</label><input type="text" id="formMrn" class="w-full border-2 rounded-2xl p-4 text-sm font-bold outline-none"></div>
                 </div>
                 <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div><label class="text-[10px] font-black text-slate-400 block mb-1 uppercase tracking-widest">DOB</label><input type="text" id="formDob" placeholder="MM/DD/YYYY" class="w-full border-2 rounded-2xl p-4 text-sm font-bold"></div>
                    <div><label class="text-[10px] font-black text-slate-400 block mb-1 uppercase tracking-widest">Age</label><input type="text" id="formAge" class="w-full border-2 rounded-2xl p-4 text-sm font-bold"></div>
                    <div><label class="text-[10px] font-black text-slate-400 block mb-1 uppercase tracking-widest">Sex</label><select id="formSex" class="w-full border-2 rounded-2xl p-4 text-sm font-bold bg-white"><option value="">-- Select --</option><option value="Male">Male</option><option value="Female">Female</option></select></div>
                 </div>
                 <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div><label class="text-[10px] font-black text-slate-400 block mb-1 uppercase tracking-widest">Phone</label><input type="text" id="formPhone" class="w-full border-2 rounded-2xl p-4 text-sm font-bold"></div>
                    <div><label class="text-[10px] font-black text-slate-400 block mb-1 uppercase tracking-widest">Email</label><input type="email" id="formEmail" class="w-full border-2 rounded-2xl p-4 text-sm font-bold"></div>
                    <div><label class="text-[10px] font-black text-slate-400 block mb-1 uppercase tracking-widest">Insurance</label><input type="text" id="formInsurance" class="w-full border-2 rounded-2xl p-4 text-sm font-bold"></div>
                 </div>
                 <div class="border-t pt-8 space-y-6">
                    <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
                       <div><label class="text-[10px] font-black text-slate-400 block mb-1 uppercase tracking-widest">Hx</label><textarea id="formHx" class="w-full border-2 rounded-2xl p-4 text-xs font-medium h-32"></textarea></div>
                       <div><label class="text-[10px] font-black text-slate-400 block mb-1 uppercase tracking-widest">Dx</label><textarea id="formDx" class="w-full border-2 rounded-2xl p-4 text-xs font-medium h-32"></textarea></div>
                       <div><label class="text-[10px] font-black text-slate-400 block mb-1 uppercase tracking-widest">Rx</label><textarea id="formRx" class="w-full border-2 rounded-2xl p-4 text-xs font-medium h-32"></textarea></div>
                    </div>
                 </div>
                 <div class="pt-8 flex justify-between border-t border-slate-100">
                    <button type="button" onclick="closeForm()" class="text-slate-500 font-black px-12 py-4 border-2 border-slate-200 rounded-[1.5rem] hover:bg-slate-50 transition uppercase tracking-widest text-xs">Discard Changes</button>
                    <button type="submit" class="bg-blue-600 text-white font-black px-20 py-4 rounded-[1.5rem] shadow-2xl hover:bg-black transition transform active:scale-95 uppercase tracking-widest text-xs">Finalize Record</button>
                 </div>
              </form>
           </div>
        </main>
      </div>

      <div id="modal" class="hidden fixed inset-0 bg-slate-900/80 backdrop-blur-md z-[500] flex items-center justify-center p-6">
        <div class="bg-white w-full max-w-4xl rounded-[3rem] shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-300">
          <div class="p-10 bg-slate-50 border-b flex justify-between items-center">
             <div><h3 id="modalName" class="text-3xl font-black text-slate-800 tracking-tight leading-none uppercase"></h3><p id="modalMrn" class="text-sm font-mono text-slate-400 uppercase tracking-widest mt-3 flex items-center gap-2"><span id="modalMrnVal" class="text-slate-900 font-bold"></span></p></div>
             <button onclick="closeModal()" class="text-slate-300 hover:text-red-500 text-4xl transition">✕</button>
          </div>
          <div id="modalMainContent" class="p-12 space-y-8 max-h-[75vh] overflow-y-auto custom-scrollbar"></div>
          <div class="p-10 bg-slate-50 border-t flex justify-between items-center rounded-b-[3rem]">
            <div class="flex gap-4">
               <button onclick="openEditForm()" class="text-blue-600 font-black px-10 py-3 border-2 border-blue-100 rounded-2xl bg-white text-xs uppercase hover:bg-blue-50 transition shadow-sm tracking-widest">Edit Patient Detail</button>
               <button id="reportCompleteBtn" onclick="markReportComplete()" class="hidden bg-green-600 text-white px-10 py-3 rounded-2xl text-xs font-black shadow-md hover:bg-black transition transform active:scale-95 uppercase tracking-widest italic">Report Complete</button>
            </div>
            <p id="decisionStatusLabel" class="text-[10px] font-black text-slate-400 uppercase tracking-widest italic"></p>
          </div>
        </div>
      </div>

      <script>
        const S_NAME = 'Prescreen';
        const DB_NAME = 'Prescreen Database';
        
        let curIdx = null, actPt = null, pData = { clinics: [], mapping: {} }, currentUser = { name: '', role: 'STAFF', email: '' };
        let currentSource = 'prescreen'; 
        let callTimerInterval = null, callStartTime = null;

        const OUTCOMES = ["Scheduled", "Rescheduled", "Patient declined", "Patient wants provider callback", "Patient wants biller/insurance callback", "Patient requested call later", "No answer", "Left voicemail", "Voicemail full", "Wrong number", "Disconnected number", "Text message sent", "Email sent", "Needs family/caregiver decision", "Needs transportation help", "Needs facility coordination", "Needs authorization/insurance review", "Needs records reviewed", "Patient already completed test", "Patient already scheduled elsewhere", "Appointment canceled", "No-show", "Not eligible", "Language barrier/interpreter needed", "Escalate to manager"];

        window.onload = () => { 
          refreshDashboardData(); 
          google.script.run.withSuccessHandler(user => {
            currentUser = user;
            document.getElementById('userName').innerText = user.name;
          }).getUserIdentity();
          google.script.run.withSuccessHandler(d => { 
            pData = d; 
            const s = document.getElementById('formClinic'); 
            d.clinics.forEach(c => { const o = document.createElement('option'); o.value = c; o.innerText = c; s.appendChild(o); }); 
          }).getParameterData(); 
          setupTabs('prescreen');
        };

        function showLoading(s, m) { document.getElementById('loadingOverlay').classList.toggle('hidden', !s); if(m) document.getElementById('loadingMsg').innerText = m; }
        function showMainView() { document.getElementById('formView').classList.add('hidden'); document.getElementById('mainView').classList.remove('hidden'); }

        function switchView(source, btn) {
           currentSource = source;
           document.querySelectorAll('.sidebar-item').forEach(x => x.classList.remove('sidebar-active'));
           if(btn) btn.classList.add('sidebar-active');
           
           document.getElementById('callListControls').classList.toggle('hidden', source !== 'callList');
           document.getElementById('tableContainer').classList.toggle('hidden', source === 'callList');
           document.getElementById('callListContainer').classList.toggle('hidden', source !== 'callList');
           
           if(source === 'prescreen') { 
               document.getElementById('viewTitle').innerText = "Live Pipeline"; 
               document.getElementById('summaryCards').classList.remove('hidden'); 
           } 
           else if (source === 'database') { 
               document.getElementById('viewTitle').innerText = "All Patients Database"; 
               document.getElementById('summaryCards').classList.add('hidden'); 
           } 
           else { 
               document.getElementById('viewTitle').innerText = "Call List Session"; 
               document.getElementById('summaryCards').classList.add('hidden'); 
               document.getElementById('detailCanvas').innerHTML = '<div class="h-full flex flex-col items-center justify-center text-slate-300 animate-pulse"><p class="font-black uppercase tracking-widest text-sm">Select patient card from sidebar to view full details</p></div>';
           }

           setupTabs(source);
           refreshDashboardData();
           showMainView();
        }

        function setupTabs(view) {
           const container = document.getElementById('filterTabs');
           if (view === 'prescreen') { 
               container.classList.remove('hidden');
               container.innerHTML = \`<button onclick="applyQueueFilter('All', this)" class="queue-tab py-4 text-xs font-black uppercase tracking-widest tab-active">All</button><button onclick="filterTableByIncomplete(this)" class="queue-tab py-4 text-xs font-black uppercase tracking-widest">Missing Data</button><button onclick="applyQueueFilter('Ready for Review', this)" class="queue-tab py-4 text-xs font-black uppercase tracking-widest">For Review</button><button onclick="applyQueueFilter('Reviewed', this)" class="queue-tab py-4 text-xs font-black uppercase tracking-widest">For Approval</button><button onclick="filterTableByUploads(this)" class="queue-tab py-4 text-xs font-black uppercase tracking-widest">Missing Uploads</button>\`; 
           } 
           else if (view === 'database') { 
               container.classList.remove('hidden');
               container.innerHTML = \`<button onclick="applyQueueFilter('All', this)" class="queue-tab py-4 text-xs font-black uppercase tracking-widest tab-active">All</button><button onclick="applyQueueFilter('Visit', this, true)" class="queue-tab py-4 text-xs font-black uppercase tracking-widest">Visit</button><button onclick="applyQueueFilter('Outreach', this, true)" class="queue-tab py-4 text-xs font-black uppercase tracking-widest">Outreach</button>\`; 
           } 
           else { 
               container.classList.add('hidden');
               container.innerHTML = ''; 
           }
        }

        function refreshDashboardData() { 
          showLoading(true, "Synchronizing Registry..."); 
          const sn = (currentSource === 'prescreen') ? S_NAME : DB_NAME;
          google.script.run.withSuccessHandler(s => { 
            if(currentSource === 'prescreen') renderStats(s);
            let rows = s.rows;
            if (currentSource === 'callList') { 
                rows = rows.filter(r => r.assignedEmail === currentUser.email.toLowerCase()); 
                const clsBtn = document.getElementById('closeSessionBtn');
                if(clsBtn) clsBtn.classList.toggle('hidden', rows.length === 0); 
                renderCards(rows);
                
                // FIXED: Clear detail workspace if active patient was logged/scheduled
                if (curIdx && !rows.find(r => r.index == curIdx)) {
                  document.getElementById('detailCanvas').innerHTML = '<div class="h-full flex flex-col items-center justify-center text-slate-300 animate-pulse"><p class="font-black uppercase tracking-widest text-sm">Action Recorded. Select next patient from sidebar.</p></div>';
                  curIdx = null;
                }
            } 
            else { renderTable(rows); }
            showLoading(false); 
          }).withFailureHandler(e => { showLoading(false); }).getDashboardStats(sn); 
        }

        function renderStats(s) { 
           const sr = document.getElementById('statReviews'); if(sr) sr.innerText = s.reviews; 
           const sa = document.getElementById('statApprovals'); if(sa) sa.innerText = s.approvals; 
           const su = document.getElementById('statUploads'); if(su) su.innerText = s.uploads; 
           const si = document.getElementById('statIncomplete'); if(si) si.innerText = s.incomplete; 
        }

        function renderTable(rs) { 
          const b = document.getElementById('tableBody'); b.innerHTML = ''; 
          rs.forEach(r => { 
            const sc = r.status === 'Approved' ? 'bg-green-100 text-green-700' : (r.status === 'Reviewed' ? 'bg-blue-100 text-blue-700' : (r.status === 'Ready for Review' ? 'bg-orange-100 text-orange-700' : 'bg-slate-100 text-slate-500')); 
            const tr = document.createElement('tr'); tr.className = "hover:bg-blue-50 transition cursor-pointer patient-row border-b border-slate-50"; 
            tr.setAttribute('data-status', r.status); tr.setAttribute('data-type', r.type); tr.setAttribute('data-uploaded', r.uploaded); tr.setAttribute('data-incomplete', r.isIncomplete);
            tr.onclick = () => openDetails(r.index); 
            tr.innerHTML = \`<td class="px-10 py-6 font-bold text-slate-800">\${r.name}\${r.isIncomplete ? ' <span class="text-red-500">⚠️</span>' : ''}</td><td class="px-10 py-6 text-slate-500 font-bold">\${r.clinic}</td><td class="px-10 py-6 font-mono text-xs text-center text-slate-400">\${r.mrn}</td><td class="px-10 py-6 text-right"><span class="px-5 py-2 rounded-full text-[10px] font-black uppercase \${sc}">\${r.status}</span></td>\`; 
            b.appendChild(tr); 
          }); 
        }

        function applyQueueFilter(filter, btn, isByType = false) {
           showMainView();
           if(btn) { document.querySelectorAll('.queue-tab').forEach(t => t.classList.remove('tab-active')); btn.classList.add('tab-active'); }
           document.querySelectorAll(".patient-row").forEach(tr => {
              const status = tr.getAttribute('data-status'), type = tr.getAttribute('data-type'), inc = tr.getAttribute('data-incomplete') === "true";
              if (filter === 'All') tr.style.display = "";
              else if (inc) tr.style.display = "none";
              else if (isByType) tr.style.display = (type === filter) ? "" : "none";
              else tr.style.display = (status === filter) ? "" : "none";
           });
        }

        function filterTableBy(status, btn) { showMainView(); document.querySelectorAll(".patient-row").forEach(tr => { const rowStatus = tr.getAttribute('data-status'); const inc = tr.getAttribute('data-incomplete') === "true"; tr.style.display = (!inc && rowStatus === status) ? "" : "none"; }); }
        function filterTableByUploads(btn) { showMainView(); if(btn) { document.querySelectorAll('.queue-tab').forEach(t => t.classList.remove('tab-active')); btn.classList.add('tab-active'); } document.querySelectorAll(".patient-row").forEach(tr => { const uploaded = tr.getAttribute('data-uploaded') === "true"; const inc = tr.getAttribute('data-incomplete') === "true"; tr.style.display = (!inc && !uploaded) ? "" : "none"; }); }
        function filterTableByIncomplete(btn) { showMainView(); if(btn) { document.querySelectorAll('.queue-tab').forEach(t => t.classList.remove('tab-active')); btn.classList.add('tab-active'); } document.querySelectorAll(".patient-row").forEach(tr => tr.style.display = (tr.getAttribute('data-incomplete') === "true") ? "" : "none"); }

        function renderCards(rs) {
           const s = document.getElementById('cardSidebar'); 
           if(rs.length === 0) {
             s.innerHTML = '<div class="p-6 text-center text-xs font-bold text-slate-400 uppercase tracking-widest">No assignments.</div>';
             return;
           }
           s.innerHTML = rs.map(r => \`
             <div onclick="loadCanvas(\${r.index}, this)" class="patient-card shadow-sm flex justify-between items-center gap-4">
               <div class="flex-grow min-w-0">
                 <h4 class="font-bold uppercase mb-1 text-slate-800 text-sm truncate">\${r.name}</h4>
                 <p class="text-[9px] text-slate-400 font-bold uppercase tracking-widest">\${r.mrn}</p>
               </div>
               <div class="text-right shrink-0">
                 <p class="text-[9px] font-black text-blue-600 uppercase mb-1">\${r.type}</p>
                 <p class="text-[9px] text-slate-400 font-bold uppercase tracking-widest">\${r.clinic}</p>
               </div>
             </div>\`).join('');
        }

        function openDetails(idx) { 
          curIdx = idx; showLoading(true, "Accessing Clinical Profile..."); 
          const sn = (currentSource === 'prescreen') ? S_NAME : DB_NAME;
          
          google.script.run
          .withFailureHandler(e => { showLoading(false); }) // Stop spin on error
          .withSuccessHandler(d => { 
            actPt = d; 
            const isPhysician = currentUser.role === 'PHYSICIAN';
            const isApproved = d.status === 'Approved';

            document.getElementById('modalName').innerText = d.name; 
            document.getElementById('modalMrnVal').innerText = (d.mrn || "N/A"); 
            document.getElementById('modalMainContent').innerHTML = \`
               <div class="grid grid-cols-2 gap-12"><div><p class="text-[11px] font-black text-slate-400 uppercase mb-3 italic">Insurance Provider</p><p class="text-lg font-bold text-slate-800">\${d.insurance || 'N/A'}</p></div><div><p class="text-[11px] font-black text-slate-400 uppercase mb-3 italic">Primary Contact</p><p class="text-slate-700 font-bold leading-relaxed">\${d.phone || "N/A"} • \${d.email || "N/A"}</p></div></div>
               <div class="border-t border-slate-100 pt-10"><div class="grid grid-cols-1 md:grid-cols-2 gap-8 bg-slate-50 p-8 rounded-[2.5rem] border border-slate-200 shadow-inner"><div class="space-y-6"><div><p class="text-[10px] font-black text-blue-600 uppercase mb-2">Dx</p><p class="text-sm font-bold text-slate-700 leading-relaxed">\${d.dx || 'Pending'}</p></div><div><p class="text-[10px] font-black text-blue-600 uppercase mb-2">Hx</p><p class="text-sm italic text-slate-600 leading-relaxed">\${d.hx || 'None'}</p></div></div><div class="space-y-6 border-l border-slate-200 pl-8"><div><p class="text-[10px] font-black text-blue-600 uppercase mb-2">Ancillaries Qualified</p><p class="text-sm text-slate-700 font-black leading-relaxed">\${d.qual || 'None'}</p></div></div></div></div>
               <div id="bridgeContainer" class="space-y-8 border-t pt-10 text-center"><p class="text-[11px] font-black text-slate-400 uppercase tracking-widest italic underline">Secure Bridge Repository</p><div class="grid grid-cols-3 gap-6">
                  <div class="bg-blue-50 p-6 rounded-[2rem] border border-blue-100 shadow-sm"><p class="text-[10px] font-black text-blue-400 uppercase tracking-widest">Ultrasound</p>\${d.usLink ? \`<a href="\${d.usLink}" target="_blank" class="text-[10px] font-black text-blue-600 uppercase hover:underline">📄 VIEW</a>\` : \`<button onclick="provision('Ultrasound')" class="bg-blue-600 text-white px-4 py-2 rounded-xl text-[10px] font-black">PROVISION</button>\`}</div>
                  <div class="bg-purple-50 p-6 rounded-[2rem] border border-purple-100 shadow-sm"><p class="text-[10px] font-black text-purple-400 uppercase tracking-widest">BrainWave</p>\${d.bwLink ? \`<a href="\${d.bwLink}" target="_blank" class="text-[10px] font-black text-purple-600 uppercase hover:underline">📄 VIEW</a>\` : \`<button onclick="provision('BrainWave')" class="bg-blue-600 text-white px-4 py-2 rounded-xl text-[10px] font-black">PROVISION</button>\`}</div>
                  <div class="bg-emerald-50 p-6 rounded-[2rem] border border-emerald-100 shadow-sm"><p class="text-[10px] font-black text-emerald-400 uppercase tracking-widest">VitalWave</p>\${d.vwLink ? \`<a href="\${d.vwLink}" target="_blank" class="text-[10px] font-black text-emerald-600 uppercase hover:underline">📄 VIEW</a>\` : \`<button onclick="provision('VitalWave')" class="bg-blue-600 text-white px-4 py-2 rounded-xl text-[10px] font-black">PROVISION</button>\`}</div>
               </div></div>\`;
            
            // Safety check for ID and definition of local logic
            const reportBtn = document.getElementById('reportCompleteBtn');
            if (reportBtn) reportBtn.classList.toggle('hidden', currentSource !== 'prescreen' || d.isReadyW || isApproved);
            
            showLoading(false); 
            document.getElementById('modal').classList.remove('hidden'); 
          })
          .getPatientDetails(idx, sn); 
        }

        function loadCanvas(idx, card) {
           document.querySelectorAll('.patient-card').forEach(c => c.classList.remove('card-active'));
           card.classList.add('card-active'); curIdx = idx;
           
           document.getElementById('detailCanvas').innerHTML = '<div class="h-full flex flex-col items-center justify-center text-blue-400"><div class="animate-spin rounded-full h-8 w-8 border-b-4 border-blue-600 mb-4"></div><p class="font-bold text-xs uppercase tracking-widest">Loading Record...</p></div>';
           
           google.script.run.withSuccessHandler(d => {
              actPt = d;
              document.getElementById('detailCanvas').innerHTML = \`
                 <div class="animate-in fade-in duration-300 h-full flex flex-col">
                    <div class="flex justify-between items-start border-b border-slate-200 pb-6 mb-6 shrink-0">
                       <div>
                          <h3 class="text-4xl font-black uppercase text-slate-800 tracking-tighter">\${d.name}</h3>
                          <div class="flex gap-2 mt-3">
                             <span class="text-xs font-mono bg-slate-100 px-3 py-1 rounded border font-bold text-slate-600">MRN: \${d.mrn || "N/A"}</span>
                             <span class="text-xs font-mono bg-blue-50 text-blue-700 px-3 py-1 rounded border border-blue-100 font-bold">DOB: \${d.dob || "N/A"} (\${d.age || "?"}y) \${d.sex || ""}</span>
                          </div>
                       </div>
                       <div class="flex flex-col items-end gap-3">
                          <div id="tDisp" class="call-timer hidden">00:00</div>
                          <button id="callToggleBtn" onclick="startCall('\${d.phone}')" class="bg-blue-600 text-white px-8 py-3 rounded-2xl font-black uppercase shadow-lg hover:bg-black transition">Start Call</button>
                       </div>
                    </div>
                    
                    <div class="flex-grow overflow-y-auto custom-scrollbar pr-4 pb-4">
                        <div class="grid grid-cols-2 gap-6 mb-8 text-sm">
                           <div class="bg-slate-50 p-5 rounded-2xl border shadow-inner"><p class="text-[10px] font-black uppercase text-slate-400 mb-1">Insurance Provider</p><p class="font-bold text-slate-800 uppercase truncate">\${d.insurance || 'N/A'}</p></div>
                           <div class="bg-slate-50 p-5 rounded-2xl border shadow-inner"><p class="text-[10px] font-black uppercase text-slate-400 mb-1">Contact Details</p><p class="font-bold text-slate-800">\${d.phone || 'N/A'}</p><p class="text-[10px] font-bold text-slate-500 truncate">\${d.email || 'N/A'}</p></div>
                        </div>
                        
                        <div class="bg-white p-6 rounded-[2rem] border shadow-sm space-y-5 mb-8">
                           <p class="text-[11px] font-black uppercase text-blue-600 tracking-widest border-b pb-3 italic underline">Clinical Overview</p>
                           <div><p class="text-[9px] font-bold text-slate-400 uppercase mb-1">Qualified For</p><p class="text-sm font-black text-slate-800">\${d.qual || 'None'}</p></div>
                           <div class="grid grid-cols-2 gap-6">
                              <div><p class="text-[9px] font-bold text-slate-400 uppercase mb-1">Diagnosis (Dx)</p><p class="text-xs font-semibold text-slate-700">\${d.dx || 'Pending'}</p></div>
                              <div><p class="text-[9px] font-bold text-slate-400 uppercase mb-1">History (Hx)</p><p class="text-xs italic text-slate-600">\${d.hx || 'None Provided'}</p></div>
                           </div>
                        </div>

                        <div class="bg-blue-50/50 p-6 rounded-[2rem] border border-blue-100 shadow-sm space-y-4 mb-8">
                           <p class="text-[11px] font-black uppercase text-blue-900 tracking-widest border-b border-blue-200 pb-3 italic underline">Report Repositories</p>
                           <div class="flex gap-10">
                              \${d.clinicianPdf ? \`<a href="\${d.clinicianPdf}" target="_blank" class="text-xs font-bold text-blue-600 hover:text-black transition">📄 Clinician PDF</a>\` : '<span class="text-xs font-bold text-slate-300">📄 Clinician PDF Missing</span>'}
                              \${d.plexusPdf ? \`<a href="\${d.plexusPdf}" target="_blank" class="text-xs font-bold text-blue-600 hover:text-black transition">📄 Plexus PDF</a>\` : '<span class="text-xs font-bold text-slate-300">📄 Plexus PDF Missing</span>'}
                           </div>
                        </div>

                        <div class="mt-4 space-y-6">
                           <div class="grid grid-cols-1 gap-4">
                              <label class="text-[10px] font-black uppercase text-slate-400 tracking-widest">Call Outcome / Disposition</label>
                              <select id="callOutcome" onchange="handleOutcomeChange()" class="w-full border-2 rounded-xl p-3 text-sm font-bold bg-white outline-none focus:border-blue-500 transition">
                                 <option value="">-- Select Outcome --</option>
                                 \${OUTCOMES.map(o => \`<option value="\${o}">\${o}</option>\`).join('')}
                              </select>
                           </div>
                           
                           <div id="schedulingPanel" class="hidden animate-in slide-in-from-top duration-300">
                              <p class="text-[10px] font-black uppercase text-blue-600 tracking-widest mb-4">Set Procedure Schedule</p>
                              \${(d.qual || "").split(",").map(p => p.trim()).filter(p => p && p !== "NONE").map(proc => \`
                                 <div class="procedure-picker flex justify-between items-center mb-3">
                                    <span class="text-xs font-black text-slate-700 uppercase">\${proc}</span>
                                    <input type="datetime-local" class="text-xs border rounded p-1 proc-time" data-proc="\${proc}">
                                 </div>
                              \`).join('')}
                           </div>

                           <div class="flex justify-end pt-6">
                              <button onclick="submitCallLog()" class="bg-blue-900 text-white py-4 px-12 rounded-2xl font-black uppercase text-xs hover:bg-black shadow-lg transition">Schedule / Log Session</button>
                           </div>
                        </div>
                    </div>
                 </div>
              \`;
           }).getPatientDetails(idx, DB_NAME);
        }

        function startCall(p) {
           const btn = document.getElementById('callToggleBtn');
           const timer = document.getElementById('tDisp');
           if (btn.innerText === 'START CALL') {
              const cp = p.replace(/[^0-9]/g, ''); 
              window.open(\`tel:\${cp}\`, '_self'); 
              callStartTime = Date.now(); 
              timer.classList.remove('hidden'); 
              btn.innerText = 'END CALL'; 
              btn.classList.replace('bg-blue-600', 'bg-red-600');
              callTimerInterval = setInterval(() => {
                 const el = Date.now() - callStartTime;
                 const m = Math.floor(el / 60000).toString().padStart(2, '0');
                 const s = Math.floor((el % 60000) / 1000).toString().padStart(2, '0');
                 timer.innerText = m + ':' + s;
              }, 1000);
           } else {
              clearInterval(callTimerInterval); 
              btn.innerText = 'START CALL'; 
              btn.classList.replace('bg-red-600', 'bg-blue-600');
           }
        }

        function handleOutcomeChange() {
           const outcome = document.getElementById('callOutcome').value;
           const panel = document.getElementById('schedulingPanel');
           panel.classList.toggle('hidden', outcome !== 'Scheduled');
        }

        function submitCallLog() {
           const outcome = document.getElementById('callOutcome').value;
           if(!outcome) return alert("Select outcome.");
           
           showLoading(true, "Logging session...");
           const durationText = document.getElementById('tDisp') ? document.getElementById('tDisp').innerText : "00:00";
           
           const logData = {
              rowIndex: actPt.index,
              clinic: actPt.clinic,
              clinician: actPt.clinician,
              type: actPt.type,
              name: actPt.name,
              mrn: actPt.mrn,
              outcome: outcome,
              duration: durationText
           };

           google.script.run.withSuccessHandler(() => {
              if (outcome === 'Scheduled') {
                 const scheds = [];
                 document.querySelectorAll('.proc-time').forEach(input => {
                    if (input.value) scheds.push({ procedure: input.getAttribute('data-proc'), dateTime: input.value });
                 });
                 
                 if (scheds.length > 0) {
                    google.script.run.withSuccessHandler(() => {
                       showLoading(false);
                       refreshDashboardData();
                    }).schedulePatientAction({ rowIndex: actPt.index, name: actPt.name, mrn: actPt.mrn, clinic: actPt.clinic, schedules: scheds });
                 } else {
                    showLoading(false);
                    refreshDashboardData();
                 }
              } else {
                 showLoading(false);
                 refreshDashboardData();
              }
           }).logCallAction(logData);
        }

        function generateCallList() { showLoading(true, "Allocating Priorities..."); google.script.run.withSuccessHandler(r => { refreshDashboardData(); }).withFailureHandler(e => { alert(e.message); showLoading(false); }).generateUserCallList(); }
        function closeSession() { if(!confirm("Release assignments?")) return; showLoading(true, "Closing..."); google.script.run.withSuccessHandler(() => { refreshDashboardData(); }).closeUserSession(); }

        function onClinicChange() { const c = document.getElementById('formClinic').value, s = document.getElementById('formPhysician'); s.innerHTML = '<option value="">-- Physician --</option>'; if(pData.mapping[c]) pData.mapping[c].forEach(d => { const o = document.createElement('option'); o.value = d; o.innerText = d; s.appendChild(o); }); }
        function openAddForm() { document.getElementById('mainView').classList.add('hidden'); document.getElementById('formView').classList.remove('hidden'); document.getElementById('patientForm').reset(); document.getElementById('formIndex').value = ""; }
        function closeForm() { showMainView(); refreshDashboardData(); }

        function openEditForm() { 
          closeModal(); document.getElementById('mainView').classList.add('hidden'); document.getElementById('formView').classList.remove('hidden'); 
          document.getElementById('formIndex').value = actPt.index; document.getElementById('formClinic').value = actPt.clinic; onClinicChange(); 
          document.getElementById('formPhysician').value = actPt.clinician; document.getElementById('formType').value = actPt.type || "Visit"; 
          document.getElementById('formName').value = actPt.name; document.getElementById('formMrn').value = actPt.mrn; 
          document.getElementById('formDob').value = actPt.dob; document.getElementById('formAge').value = actPt.age; 
          document.getElementById('formSex').value = actPt.sex; document.getElementById('formPhone').value = actPt.phone; 
          document.getElementById('formEmail').value = actPt.email; document.getElementById('formInsurance').value = actPt.insurance;
          document.getElementById('formHx').value = actPt.hx || ""; document.getElementById('formDx').value = actPt.dx || ""; 
          document.getElementById('formRx').value = actPt.rx || ""; const sel = (actPt.qual || "").split(",").map(s => s.trim());
          document.querySelectorAll('#ancillaryCheckboxes input').forEach(i => i.checked = sel.includes(i.value));
        }

        document.getElementById('patientForm').onsubmit = (e) => { 
          e.preventDefault(); showLoading(true, "Finalizing Database Entry..."); 
          const indexValue = document.getElementById('formIndex').value;
          const sn = (indexValue === "") ? S_NAME : (currentSource === 'database' ? DB_NAME : S_NAME);
          const d = { index: indexValue, clinic: document.getElementById('formClinic').value, clinician: document.getElementById('formPhysician').value, type: document.getElementById('formType').value, name: document.getElementById('formName').value, mrn: document.getElementById('formMrn').value, dob: document.getElementById('formDob').value, age: document.getElementById('formAge').value, sex: document.getElementById('formSex').value, phone: document.getElementById('formPhone').value, email: document.getElementById('formEmail').value, insurance: document.getElementById('formInsurance').value, hx: document.getElementById('formHx').value, dx: document.getElementById('formDx').value, rx: document.getElementById('formRx').value };
          google.script.run.withSuccessHandler(() => { closeForm(); }).withFailureHandler(e => { alert(e.message); showLoading(false); }).savePatientRecord(d, sn); 
        };

        function markReportComplete() { showLoading(true, "Finalizing Report..."); google.script.run.withSuccessHandler(() => { closeModal(); refreshDashboardData(); }).withFailureHandler(e => { alert(e.message); showLoading(false); }).finalizeReport(curIdx, actPt.mrn); }
        function provision(type) { showLoading(true, "Provisioning..."); google.script.run.withSuccessHandler(() => { openDetails(curIdx); }).createPatientFolderAction(curIdx, type); }
        function submitClinicalDecision() { const sel = document.querySelector('input[name="decision"]:checked'); if (!sel) return alert("Select decision."); const com = document.getElementById('decisionComment').value; if (sel.value === 'Needs Correction' && !com.trim()) return alert("Comment required."); showLoading(true, "Submitting..."); google.script.run.withSuccessHandler(() => { closeModal(); refreshDashboardData(); }).processWebAction(curIdx, sel.value, com); }
        function toggleCommentBox(show) { document.getElementById('commentBox').classList.toggle('hidden', !show); }
        function setActiveNav(b) { document.querySelectorAll('.nav-btn').forEach(x => x.classList.remove('sidebar-active')); b.classList.add('sidebar-active'); }
        function closeModal() { document.getElementById('modal').classList.add('hidden'); }
        function searchTable() { const v = document.getElementById("tableSearch").value.toUpperCase(); document.querySelectorAll("#mainTable tbody tr").forEach(tr => tr.style.display = tr.innerText.toUpperCase().includes(v) ? "" : "none"); }
        setupTabs('prescreen');
      </script>
    </body>
  </html>
  `;
}