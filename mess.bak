AGENT.md — Plexus v2 Engineering Directives & Migration Playbook

This document defines the operating rules, system architecture, coding standards, and step-by-step execution protocol for AI agents and engineers working on the Plexus v2 codebase.

1. System Mission & Migration Mandate

Plexus is transitioning from a monolithic, tightly-coupled vanilla JavaScript application (index.html with inline scripts and mutable global state) into an enterprise-ready, modular web application powered by Lit 3 Web Components, @vaadin/router, and a structured Node.js/Express/Mongoose backend.

Core Objectives:

Componentization: Deconstruct the single-file UI into decoupled, testable Lit elements.

Predictable State: Eliminate the global mutable state = {} object in favor of Lit reactive properties, unidirectional data flow, custom events, and dedicated singleton services.

Robust Routing: Replace ad-hoc DOM toggling (display: hidden) with deep-linkable URLs and route guards via @vaadin/router.

Data Scalability: Overhaul CSV parsing and database operations with chunked batching, streams, backpressure control, and indexed queries.

Quality Assurance: Guarantee test coverage across services, UI components, and API routes before merge.

Living Documentation: Maintain parity between code and PLEXUS.md.

2. Agent Operational Rules (Non-Negotiable)

Incremental Execution: Never attempt a "big bang" rewrite. Follow the 7-phase migration roadmap sequentially.

Preserve Business Logic: Every call outcome, pool allocation rule, smart-merge algorithm, and status transition present in the legacy index.html and server.js must be preserved precisely unless an explicit optimization is specified.

No Direct DOM Hacks: Forbid document.getElementById, document.querySelector, or inline style.display = 'none' inside Lit components. Use template conditionals (${this.isOpen ? html... : nothing}) and reactive lifecycle hooks.

Service Isolation: Components must never call fetch() directly. All HTTP traffic flows through src/services/api.service.js. All authentication/session checks flow through src/services/session.service.js.

Fail-Safe Data Ingestion: Never run unbounded await loops inside data processing endpoints. Use bulk operations (Model.bulkWrite) and chunked batches ($N = 100$).

Test Requirement: Any newly introduced component, service method, or route handler must include a corresponding test suite in /tests.

3. Repository Architecture & File Blueprint

plexus/
├── AGENT.md                         # This file: Agent directives and rules
├── PLEXUS.md                        # Living system architecture and domain reference
├── package.json                     # Root dependencies & build scripts
├── vite.config.js                   # Vite bundling configuration
├── web-test-runner.config.mjs       # Lit component testing runner
├── vitest.config.js                 # Unit test configuration for services & backend
├── server.js                        # Express API & static file server
├── src/
│   ├── index.html                   # Minimal single-page app shell
│   ├── components/
│   │   ├── plexus-app.js            # Root shell, router outlet, top nav layout
│   │   ├── nav/
│   │   │   └── plexus-sidebar.js    # Collapsible sidebar with active route tracking
│   │   ├── views/
│   │   │   ├── view-dashboard.js    # Operational KPIs and quick stats
│   │   │   ├── view-workspace.js    # Active agent call cockpit
│   │   │   ├── view-call-list.js    # Pool queue & lead records
│   │   │   ├── view-schedule.js     # Shift and callback calendar
│   │   │   ├── view-appointments.js # Booked appointments manager
│   │   │   ├── view-upload.js       # CSV ingestion & field mapping engine
│   │   │   └── view-admin.js        # User management & pool rules config
│   │   ├── modals/
│   │   │   ├── modal-call-dialog.js # Call outcome and disposition modal
│   │   │   ├── modal-view-patient.js# Patient detail inspector
│   │   │   ├── modal-generator.js   # Dynamic report / campaign generator
│   │   │   └── modal-sms-email.js   # Outbound messaging dialog
│   │   └── shared/
│   │       ├── plexus-badge.js      # Status indicators (color-coded)
│   │       ├── plexus-table.js      # Virtualized / paginated data table
│   │       ├── plexus-pagination.js # Standard pagination control
│   │       └── plexus-msg-dialog.js # Global feedback alert / modal
│   └── services/
│       ├── api.service.js           # Centralized API client (fetch wrapper)
│       └── session.service.js       # Auth token, user state, localStorage sync
└── tests/
    ├── services/
    │   ├── api.service.test.js
    │   └── session.service.test.js
    ├── components/
    │   ├── plexus-table.test.js
    │   └── modal-call-dialog.test.js
    └── backend/
        ├── call-log.test.js
        └── upload.test.js


4. Coding Standards & Component Conventions

4.1 Lit Web Components

Tag Naming: Every custom element tag must follow kebab-case with a consistent domain prefix:

App shell: plexus-app

Views: view-[name] (e.g., view-workspace)

Modals: modal-[name] (e.g., modal-call-dialog)

Atoms / Shared: plexus-[name] (e.g., plexus-badge)

Reactive State: Use static properties or @property() / @state() decorators consistently.

Styling: Encapsulate styles using css\...`. Shared utility tokens (colors, spacing, typography) must use CSS Custom Properties defined at the root (:root/plexus-app`).

Events: Communicate upward via standard custom events with bubbles and composed enabled where appropriate:

this.dispatchEvent(new CustomEvent('call-completed', {
  detail: { taskId, outcome, notes },
  bubbles: true,
  composed: true
}));


4.2 Routing Contract (@vaadin/router)

The root outlet resides in src/components/plexus-app.js.

import { Router } from '@vaadin/router';

export function initRouter(outlet) {
  const router = new Router(outlet);
  router.setRoutes([
    { path: '/', component: 'view-dashboard' },
    { path: '/workspace', component: 'view-workspace' },
    { path: '/schedule', component: 'view-schedule' },
    { path: '/appointments', component: 'view-appointments' },
    { path: '/pool', component: 'view-call-list' },
    { path: '/upload', component: 'view-upload' },
    {
      path: '/admin',
      component: 'view-admin',
      action: async (context, commands) => {
        const isAdmin = sessionService.hasRole('admin');
        if (!isAdmin) {
          return commands.redirect('/');
        }
      }
    },
    { path: '(.*)', redirect: '/' }
  ]);
  return router;
}


4.3 Service Layer Pattern

Zero Inline Fetching: No raw fetch calls in views or components.

Unified Error Handling: Normalize network failure, non-200 responses, and validation payloads into standard JavaScript Error objects with a clean .message and .status.

JWT / Auth Interceptor: Automatically attach authorization headers from sessionService to every outgoing request.

5. Backend & Data Ingestion Optimization Guidelines

5.1 CSV Batch Processing

Legacy issue: for (const row of rows) { await Model.create(row); } causes connection pool exhaustion and unacceptable latency.

Required Pattern:

const BATCH_SIZE = 100;
for (let i = 0; i < records.length; i += BATCH_SIZE) {
  const chunk = records.slice(i, i + BATCH_SIZE);
  const operations = chunk.map(record => ({
    updateOne: {
      filter: { patientId: record.patientId, campaignId: record.campaignId },
      update: { $set: record },
      upsert: true
    }
  }));
  await CallTask.bulkWrite(operations, { ordered: false });
}


5.2 Mongoose Schema Indexing

Ensure compound and single indexes exist for hot query paths:

CallTask: { addressed: 1, assignedTo: 1, skipUntil: 1 }

CallTask: { campaignId: 1, createdAt: -1 }

Patient: { phone: 1, lastName: 1 }

5.3 Query Projections

Avoid unbounded queries. Always apply .select('field1 field2') and enforce pagination via .skip() and .limit().

6. Seven-Phase Migration Execution Plan

Phase

Scope

Deliverables

Verification Gate

Phase 1

Build Setup & Shell

Vite config, Lit, Vaadin Router, plexus-app.js, empty route shells

npm run build succeeds; routing transitions cleanly.

Phase 2

Service Layer Extraction

api.service.js, session.service.js, unit tests

100% test pass with mocked network responses.

Phase 3

Shared Component Library

plexus-badge, plexus-table, plexus-pagination, plexus-msg-dialog

Render tests pass in Web Test Runner; visual consistency checked.

Phase 4

View Conversion

Convert views sequentially: Dashboard $\rightarrow$ Workspace $\rightarrow$ Pool $\rightarrow$ Schedule $\rightarrow$ Appointments $\rightarrow$ Upload $\rightarrow$ Admin

All views render dynamic mock/live data; no legacy DOM scripts left.

Phase 5

Modal Decomposition

Move modals to standalone Lit components (modal-call-dialog, modal-view-patient, etc.)

Custom events fire; form submissions link cleanly to services.

Phase 6

Backend Ingestion & Query Tuning

Bulk write for CSV, compound indexes, Mongoose projection, streaming pipeline

Benchmark: 10,000-row CSV processes under 3 seconds without event loop lag.

Phase 7

System Documentation & Cleanup

Update PLEXUS.md with full component registry, remove obsolete legacy code

Dead legacy code removed; app runs fully headless & clean.

7. Agent Context Checkpoint & Workflow Commands

Before running any file edits or refactoring tasks, the AI agent must:

Identify the active Phase from the table above.

Confirm which component, service, or endpoint is under development.

Verify that changes do not break existing downstream consumers.

Verify that corresponding test files in tests/ are updated simultaneously.