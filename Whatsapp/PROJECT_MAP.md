# TalentWale Whatsapp Dashboard — PROJECT MAP

> **AI ke liye guide:** Koi bhi change karne se pehle sirf yahi file padho. Isse pura project samajh aa jayega bina har file scan kiye. Section dekho, seedha relevant file pe jao.

---

## 🏗️ Tech Stack

| Layer | Tech |
|---|---|
| Runtime | Node.js 18.x (no framework, raw `http` module) |
| Database | PostgreSQL (AWS RDS) via `pg` library |
| Email | Nodemailer (SMTP), AWS SQS queue |
| WhatsApp | Azure Communication Services (REST templates) |
| Frontend | Vanilla HTML + CSS + JS (no React/Vue/bundler) |
| Deployment | AWS Lambda (via GitHub Actions) + AWS Amplify (frontend) |
| Auth | JWT (`jsonwebtoken`) — 7-day token, stored in `localStorage` |

---

## 📁 Folder Structure

```
Whatsapp/
├── server.js              ← Main entry point (local dev)
├── send-whatsapp.js       ← Azure WhatsApp sender service
├── package.json           ← Dependencies
├── .env                   ← All secrets/config (never commit)
│
├── backend/
│   └── lambda.js          ← AWS Lambda wrapper (imports server.js)
│                            ⚠️ DO NOT DELETE — used by GitHub Actions deploy
│
├── src/                   ← Backend MVC layers
│   ├── config/
│   │   ├── constants.js   ← All env vars, rate limits, timeouts, paths
│   │   ├── database.js    ← PostgreSQL pool setup + initDatabase()
│   │   └── state.js       ← Global mutable state (Maps, Sets, flags)
│   │
│   ├── middleware/
│   │   ├── authMiddleware.js    ← JWT requireAuth() guard
│   │   └── requestHelpers.js   ← sendJson(), readRequestBody(), SSE broadcast
│   │
│   ├── models/
│   │   ├── campaignModel.js     ← Campaign CRUD + bulk run tracking
│   │   ├── conversationModel.js ← WhatsApp chat threads
│   │   ├── emailModel.js        ← Email recipient tracking + suppression
│   │   ├── messageModel.js      ← WhatsApp message log
│   │   └── smtpModel.js         ← SMTP credential profiles (DB stored)
│   │
│   ├── services/
│   │   ├── campaignService.js   ← Bulk WhatsApp send loop + progress tracking
│   │   ├── contactService.js    ← Google Sheet + Excel/CSV parser
│   │   ├── emailTrackingService.js ← Open/click pixel tracking + DB logging
│   │   ├── emailVerifyService.js   ← MX/DNS email validation before send
│   │   ├── smtpService.js       ← Nodemailer transporter factory + SMTP helpers
│   │   └── sqsQueueService.js   ← AWS SQS email queue consumer
│   │
│   ├── routes/
│   │   └── apiRouter.js         ← ALL API routes in one file (~1269 lines)
│   │
│   └── utils/
│       ├── constants.js    ← (same as src/config/constants.js, re-exported)
│       ├── crypto.js       ← JWT sign/verify, token hashing, email tracking tokens
│       ├── helpers.js      ← escapeHtml, interpolateTemplate, formatTime, isValidEmail, etc.
│       └── staticServer.js ← Serves frontend/src as static files
│
├── frontend/
│   └── src/
│       ├── index.html     ← Single page app — ALL UI here
│       ├── app.js         ← ALL frontend logic (~3826 lines, vanilla JS)
│       └── styles.css     ← ALL styles (~2641 lines)
│   └── public/
│       └── dual_layer.svg ← Logo used in sidebar + login
│
└── uploads/               ← Runtime uploaded files (Excel/CSV)
```

---

## 🌐 All API Endpoints (`src/routes/apiRouter.js`)

| Method | Path | What it does |
|---|---|---|
| POST | `/api/login` | Password login → returns JWT |
| GET | `/api/config` | App config (SMTP providers, templates) |
| POST | `/api/smtp-default-provider` | Set default SMTP provider |
| GET | `/api/smtp-credentials` | List saved SMTP credential profiles |
| POST | `/api/smtp-credentials` | Save/update SMTP credential profile |
| POST | `/api/send` | Send single WhatsApp message |
| POST | `/api/contacts/sheet` | Parse Google Sheet URL → contacts |
| POST | `/api/contacts/upload` | Parse uploaded Excel/CSV → contacts |
| GET | `/api/smtp/live-summary` | Poll SMTP bulk run status |
| GET | `/api/whatsapp/live-summary` | Poll WhatsApp bulk run status |
| POST | `/api/campaigns/stop` | Stop active bulk run |
| POST | `/api/send-smtp-test` | Send test email (1 recipient) |
| POST | `/api/send-smtp-bulk` | Launch bulk email campaign |
| POST | `/api/send-bulk` | Launch bulk WhatsApp campaign |
| POST | `/api/uploads` | Generic file upload |
| GET | `/api/inbox` | WhatsApp inbox conversations |
| GET | `/api/inbox?...` | Inbox with search/pagination |
| GET | `/api/inbox/count` | Unread inbox count |
| GET | `/api/inbox/stream` | SSE stream for live inbox updates |
| GET | `/api/inbox/:id` | Single conversation thread |
| POST | `/api/reply` | Reply to WhatsApp conversation |
| GET | `/api/dashboard/summary` | Dashboard stats (sent/delivered/failed) |
| GET | `/api/email-analytics` | SMTP campaign analytics (open/click) |
| GET | `/api/email-analytics/export` | Export analytics as CSV |
| GET | `/api/reports` | WhatsApp message report |
| GET | `/api/reports/export` | Export report as CSV |
| GET | `/api/email-rejections` | Email suppression list |
| GET | `/api/media/:id` | Fetch WhatsApp media by ID |
| POST | `/api/webhooks/acs-events` | Azure webhook for WhatsApp delivery status |
| GET | `/api/webhooks/acs-events/logs` | Webhook event logs |
| GET | `/<tracking_pixel_path>` | Email open tracking pixel (1x1 GIF) |
| GET | `/unsubscribe` | Email unsubscribe link handler |

---

## 🖥️ Frontend Views (`frontend/src/index.html` + `app.js`)

The app is a **single page** with 5 views toggled via `switchView(viewName)` in `app.js`:

| View Name | Sidebar Tab | Main Container ID | Description |
|---|---|---|---|
| `quick` | Quick Send | `#quickSendCard` | Send single WhatsApp template |
| `bulk` | Bulk Send | `#bulkSendCard` | Bulk WhatsApp to Excel/Sheet audience |
| `smtp` | Email Campaign | `#smtpBulkCard` | Bulk email campaign dashboard |
| `analytics` | Email Analytics | `#smtpAnalyticsCard` | Email open/click analytics + chart |
| `config` | Config Center | `#configView` | SMTP credentials management |
| `chat` | Chat Inbox | `#chatView` | WhatsApp inbox + reply |

### Key Frontend IDs (for UI changes)

| Element | ID | View |
|---|---|---|
| Campaign dashboard wrapper | `#smtpBulkCard` | smtp |
| SMTP live stats | `#smtpLiveSent`, `#smtpLiveFailed`, `#smtpLiveState`, `#smtpLiveLoaded` | smtp |
| Sheet URL input | `#smtpSheetUrl` | smtp |
| Parse button | `#loadSmtpSheetButton` | smtp |
| File upload | `#smtpAudienceUpload` | smtp |
| Subject line | `#smtpSubjectTemplate` | smtp |
| Email body textarea | `#smtpBodyTemplate` | smtp |
| Format selector (HTML/plain) | `#smtpBodyFormat` | smtp |
| Launch Campaign button | `#sendSmtpBulkButton` | smtp |
| Send Test button | `#sendSmtpTestButton` | smtp |
| Stop Campaign button | `#stopSmtpBulkButton` | smtp |
| WhatsApp bulk sheet | `#sheetUrl` | bulk |
| WhatsApp send button | `#sendBulkButton` | bulk |
| Login overlay | `#loginOverlay` | login |
| Dashboard stats row | `#dashboardStatsRow` | all |
| Page title | `#pageTitle` | all |

---

## 🎨 CSS Architecture (`frontend/src/styles.css`)

Styles are in ONE file (~2641 lines). Key sections:

| Class Prefix | Purpose | Lines (approx) |
|---|---|---|
| `.sleek-*` | Email Campaign dashboard (new premium UI) | 2300–2635 |
| `.smtp-*` | Old SMTP UI classes (some still used) | 1800–2300 |
| `.sidebar`, `.app-layout` | Sidebar + layout | 1–200 |
| `.btn-*`, `.badge`, `.card` | Shared components | 200–600 |
| `.login-*` | Login page | 600–700 |
| `.inbox-*`, `.chat-*` | Chat inbox view | 700–1200 |
| `.report-*` | WhatsApp report table | 1200–1500 |
| `.analytics-*` | Analytics view | 1500–1800 |

**Hidden elements:** `is-hidden` = `display: none !important`

---

## 🚀 Deployment Pipeline

### Local Dev
```
node server.js      # runs on port 3000
```
- Serves `frontend/src/` as static files
- Connects to AWS RDS PostgreSQL via `.env`

### AWS Lambda (auto deploy on push to `main`)
**GitHub Actions:** `.github/workflows/deploy-lambda.yml`
- **Triggers when:** Any file in `Whatsapp/backend/**`, `Whatsapp/server.js`, `Whatsapp/send-whatsapp.js`, `Whatsapp/package.json`, or `Whatsapp/src/**` changes
- **What it does:** Zips `server.js + send-whatsapp.js + backend/lambda.js + src/ + node_modules` → deploys to Lambda function `tw-backend` in `ap-south-1`
- **Entry point:** `backend/lambda.js` → `../server.js`

### AWS Amplify (Frontend)
- Config: `frontend/amplify.yml`
- Serves `frontend/src/` statically
- Injects API Gateway URL via `window.__API_CONFIG__.apiUrl` (replaced at build time via `sed`)

---

## 🔑 Key `.env` Variables

| Variable | Used In | Purpose |
|---|---|---|
| `DASHBOARD_PASSWORD` | `apiRouter.js` | Login password |
| `JWT_SECRET` | `crypto.js` | Token signing |
| `DATABASE_URL` | `database.js` | PostgreSQL connection |
| `AZURE_COMM_CONNECTION_STRING` | `send-whatsapp.js` | WhatsApp API |
| `AZURE_STORAGE_CONNECTION_STRING` | `sqsQueueService.js` | Azure Queue |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | GitHub Secrets | Lambda deploy |
| `SMTP_SEND_RATE_PER_MINUTE` | `constants.js` | Bulk email speed (default: 120/min) |
| `PORT` | `constants.js` | Server port (default: 3000) |

---

## 🧠 Global State Pattern

All modules use `global.*` for shared state (pattern: `loadToGlobal()` in `server.js`).

Key globals:
- `smtpRuntimeProfiles` — Map of active SMTP credentials (loaded from DB on startup)
- `activeBulkRun` — Current WhatsApp bulk run state object
- `activeSmtpRun` — Current SMTP bulk run state object
- `smtpTestState` — Last test email result
- `emailUnsubscribes` — Set of unsubscribed emails
- `emailSuppressions` — Set of suppressed emails

---

## 📋 Quick Change Guide

| Change Type | Where to go |
|---|---|
| Add/modify API endpoint | `src/routes/apiRouter.js` |
| Change email sending logic | `src/services/smtpService.js` + `src/services/campaignService.js` |
| Change WhatsApp sending | `send-whatsapp.js` + `src/services/campaignService.js` |
| Add new DB table/query | `src/models/` relevant model file |
| Change Email Campaign UI | `frontend/src/index.html` (find `#smtpBulkCard`) + `frontend/src/styles.css` (.sleek-* classes) |
| Change Quick Send UI | `frontend/src/index.html` (find `#quickSendCard`) |
| Change Bulk WhatsApp UI | `frontend/src/index.html` (find `#bulkSendCard`) |
| Change Chat Inbox UI | `frontend/src/index.html` (find `#chatView`) + `.inbox-*` CSS |
| Change sidebar/navigation | `frontend/src/index.html` (`<aside class="sidebar">`) + `switchView()` in `app.js` |
| Change analytics charts | `app.js` → `renderSmtpAnalyticsChart()` function |
| Change rate limits/timeouts | `src/config/constants.js` |
| Change auth logic | `src/middleware/authMiddleware.js` |
| Change Lambda deploy trigger | `.github/workflows/deploy-lambda.yml` |
