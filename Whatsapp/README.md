# TalentWale - Monorepo

Complete TalentWale application with separated Frontend and Backend.

## 📁 Project Structure

```
Whatsapp/
├── frontend/                    # Static frontend - Deploy to Amplify/S3
│   ├── src/                    # HTML, CSS, JS files
│   ├── public/                 # Static assets (SVG, images)
│   ├── package.json           # Frontend dependencies
│   ├── README.md              # Frontend docs
│   └── .env.example           # Environment template
│
├── backend/                    # Node.js API - Deploy to Lambda/EC2
│   ├── server.js              # Main server
│   ├── send-whatsapp.js       # WhatsApp logic
│   ├── src/                   # Utility functions
│   ├── uploads/               # Uploaded files
│   ├── package.json           # Backend dependencies
│   ├── README.md              # Backend docs
│   └── .env.example           # Environment template
│
├── docker-compose.yml         # Local development setup
├── buildspec.yml              # AWS CodeBuild - Backend
├── buildspec-frontend.yml     # AWS CodeBuild - Frontend
├── AWS-DEPLOYMENT-GUIDE.md    # Complete AWS guide
└── README.md                  # This file
```

## 🚀 Quick Start (Local Development)

### Using Docker Compose (Easiest)

```bash
# Start all services
docker-compose up -d

# Backend:  http://localhost:3000
# Frontend: http://localhost:3001
# Database: localhost:5432
```

### Manual Setup

**Backend:**
```bash
cd backend
cp .env.example .env
npm install
npm run dev
```

**Frontend:**
```bash
cd frontend
python -m http.server 3001
# Or: npm start
```

---

## 🌐 Deployment

### AWS (Recommended)

See [AWS-DEPLOYMENT-GUIDE.md](AWS-DEPLOYMENT-GUIDE.md) for complete steps.

**Quick Summary:**

| Component | Service | Cost | Free Tier |
|-----------|---------|------|-----------|
| Backend | Lambda | $0.50-2/mo | 1M requests |
| Frontend | Amplify/S3 | $0 | Always free |
| Database | RDS | $0-15/mo | 12 months |

---

## 📦 Dependencies

### Backend
- Node.js 18+
- PostgreSQL 15+
- Azure Communication Services

### Frontend
- No build tools required (static HTML/CSS/JS)

---

## 🔧 Configuration

### Backend (.env)

Update [.env](C:/Users/Gyanu/Desktop/Talentwale-Workspace/Whatsapp/.env) with your Azure Communication Services values.

```env
COMMUNICATION_SERVICES_CONNECTION_STRING=endpoint=https://your-resource.communication.azure.com/;accesskey=your-access-key
WHATSAPP_CHANNEL_ID=your-channel-registration-guid
RECIPIENT_PHONE_NUMBER=919999999999
PUBLIC_BASE_URL=https://your-ngrok-domain.ngrok-free.app
TW_JOB_SUG_HEADER_IMAGE_URL=https://your-public-domain/path/job-template-header.jpg
SUPABASE_DB_HOST=aws-1-ap-south-1.pooler.supabase.com
SUPABASE_DB_PORT=6543
SUPABASE_DB_NAME=postgres
SUPABASE_DB_USER=postgres.your-project-ref
SUPABASE_DB_PASSWORD=your-db-password
SUPABASE_DB_SSLMODE=require
DB_LOAD_MESSAGE_LIMIT=5000
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-smtp-user
SMTP_PASS=your-smtp-password
SMTP_FROM=Talentwale <noreply@your-domain.com>
SMTP_TEST_RECIPIENT=qa@your-domain.com
SMTP_SEND_RATE_PER_MINUTE=120
SMTP_BULK_MAX_ROWS=50000
SMTP_TEST_INCLUDE_LIST_UNSUBSCRIBE=false
EMAIL_VERIFY_MODE=mx
EMAIL_VERIFY_ENFORCE=true
EMAIL_VERIFY_TIMEOUT_MS=3000
EMAIL_VERIFY_CACHE_TTL_MS=21600000
EMAIL_VERIFY_ALLOW_A_FALLBACK=true
EMAIL_VERIFY_REJECT_RISKY=true
EMAIL_VERIFY_SMTP_CONNECT_TIMEOUT_MS=6000
EMAIL_VERIFY_SMTP_COMMAND_TIMEOUT_MS=6000
EMAIL_VERIFY_SMTP_MAX_MX_TO_TRY=2
EMAIL_VERIFY_SMTP_CHECK_CATCH_ALL=false
EMAIL_VERIFY_SMTP_PROBE_CACHE_TTL_MS=1800000
EMAIL_VERIFY_SMTP_HELO_HOST=localhost.localdomain
EMAIL_VERIFY_SMTP_PROBE_FROM=postmaster@localhost.localdomain
EMAIL_BLOCK_DISPOSABLE_DOMAINS=true
EMAIL_BLOCKED_DOMAINS=mailinator.com,guerrillamail.com,10minutemail.com,tempmail.com
EMAIL_SUPPRESSION_ENABLED=true
UNSUBSCRIBE_TOKEN_SECRET=replace-with-a-long-random-secret
AZURE_STORAGE_QUEUE_CONNECTION_STRING=DefaultEndpointsProtocol=https;AccountName=your-storage-account;AccountKey=your-account-key;EndpointSuffix=core.windows.net
AZURE_EMAIL_QUEUE_NAME=bulk-email-queue
AZURE_EMAIL_QUEUE_POLL_INTERVAL_MS=5000
AZURE_EMAIL_QUEUE_VISIBILITY_TIMEOUT_SECONDS=60
AZURE_EMAIL_QUEUE_BATCH_SIZE=5
AZURE_EMAIL_QUEUE_MAX_DEQUEUE=8
```

Supabase DB variables optional hain. Agar set honge to incoming/outgoing inbox messages DB me persist honge aur restart ke baad bhi dikhenge.

SMTP bulk queue mode optional hai. Agar `AZURE_STORAGE_QUEUE_CONNECTION_STRING` aur `AZURE_EMAIL_QUEUE_NAME` set honge to `/api/send-smtp-bulk` campaigns pehle Azure Queue me jayenge, phir worker queue read karke process karega.

Bounce reduction mode ke liye app pre-send email checks karta hai: syntax, disposable-domain block, suppression/unsubscribe checks, DNS MX validation, aur optional SMTP RCPT probe (ZeroBounce/NeverBounce style). `EMAIL_VERIFY_ENFORCE=true` hone par precheck fail recipients reject ho jate hain aur rejection list me save hote hain.

Recommended: `EMAIL_VERIFY_MODE=smtp_probe` for strongest pre-send filtering (slower but better hard-bounce control).

## How template values work

Template names, languages, fields, and bindings are defined in [send-whatsapp.js](C:/Users/Gyanu/Desktop/Talentwale-Workspace/Whatsapp/send-whatsapp.js). You do not need to keep template JSON in `.env`.

Notes:

- `name` must match the template parameter name if your Meta/Azure template uses named bindings.
- The UI exposes text parameters. Media header values can be defined in code for templates that require them.
- `tw_job_sug` needs `TW_JOB_SUG_HEADER_IMAGE_URL`, and that image must be publicly downloadable by Azure/WhatsApp without login, cookies, or hotlink blocking.
- For single send, type field values in the UI.
- For bulk send, map each template field to a Sheet/Excel column.
- Recipient number must include country code, without `+`.

## Send messages

Generic command:

```powershell
npm run send -- verify 919999999999
```

Template shortcuts:

```powershell
npm run send:verify -- 919999999999
npm run send:tw-test -- 919999999999
npm run send:job-sug -- 919999999999
```

If you skip the phone number, the script uses `RECIPIENT_PHONE_NUMBER` from `.env`.

## Local UI

Start the browser UI:

```powershell
npm run ui
```

Then open:

```text
http://localhost:3000
```

The UI reads approved templates from the app code and the default recipient from `.env`, then sends through the same Azure WhatsApp template sender used by the CLI.

It now also includes:

- `Inbox > Replies` panel for incoming WhatsApp replies.
- Direct `Reply` box for sending text replies from the dashboard.
- WhatsApp-style chat attachment button (`+`) to send image/document files directly.
- Incoming media rendering (image preview and document download link).
- Local webhook endpoint for Azure Event Grid: `POST /api/webhooks/acs-events`.

Bulk contacts are also supported:

- Paste a public Google Sheet URL and click `Parse sheet`.
- Or upload `.xlsx`, `.xls`, or `.csv`.
- Select the phone number column, name column, and the template value key that should receive the dynamic name.
- If a phone number has only 10 digits, the UI automatically sends it with India country code `91`.
- If a template has multiple values, map each template key to the matching Sheet/Excel column. For example, `customerName` can map to `NAME`, `verificationTarget` can map to `VERIFY`, and `verificationPath` can map to `LINK`.
- Click `Send bulk`.

SMTP bulk campaign module is also available in the new `SMTP Bulk` menu:

- Paste public Google Sheet URL and click `Parse Sheet`, or upload one Excel/CSV.
- Use the same sheet columns as dynamic variables.
- Use dynamic placeholders in subject/body like `{{name}}`, `{{jobTitle}}`, `{{interviewDate}}`.
- Click `Send Test` to send one sample email to `SMTP_TEST_RECIPIENT` from `.env` (sheet optional).
- Click `Send SMTP Campaign`.
- Campaign start hone ke baad rejected recipients list API se mil sakti hai:
   - `GET /api/email-rejections?campaignId=<campaignId>`
   - Optional filters: `recipient`, `limit`, `offset`

For Google Sheets, the sheet must be publicly readable or published so the app can export it as CSV.

## Important

- Azure/WhatsApp only allows business-initiated messages through approved templates until the user replies.
- If Azure returns an error, first verify template language, placeholders, and channel ID from the Azure portal.

## Configure incoming replies in Azure

To receive user replies in this dashboard, configure Event Grid on your Azure Communication Services resource.

1. Run the app and expose it publicly (for local machine use ngrok or Cloudflare tunnel):
   - Local app URL: `http://localhost:3000`
   - Public webhook URL (example): `https://your-public-domain/api/webhooks/acs-events`
2. In Azure portal, open your **Communication Services** resource.
3. Go to **Events** > **+ Event Subscription**.
4. Enter a name (example: `whatsapp-incoming-events`).
5. Select these event types:
   - `Microsoft.Communication.AdvancedMessageReceived`
   - `Microsoft.Communication.AdvancedMessageDeliveryStatusUpdated`
6. Endpoint type: `Webhook`.
7. Webhook endpoint: paste `https://your-public-domain/api/webhooks/acs-events`.
8. Create subscription and wait for validation success.

Notes:

- Event Grid sends a validation event first. This app already handles it.
- For outbound file attachments, the app first uses `PUBLIC_BASE_URL`. If missing, it auto-detects an active ngrok HTTPS tunnel from `http://127.0.0.1:4040/api/tunnels`.
- Free text reply works when WhatsApp customer care window is open; outside that window use template messages.
