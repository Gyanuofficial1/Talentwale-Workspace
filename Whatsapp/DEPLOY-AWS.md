# 🚀 TalentWale — AWS Amplify + Lambda Deployment Guide

Yeh guide aapko step-by-step AWS pe deploy karne mein help karegi.

---

## 📋 Prerequisites

- AWS Account (with admin access ya Lambda/API Gateway/Amplify permissions)
- GitHub pe yeh repository pushed honi chahiye
- Node.js 18+ installed locally (packaging ke liye)

---

## ⚡ Quick Overview

```
FRONTEND → AWS Amplify (GitHub se auto-deploy)
BACKEND  → AWS Lambda + API Gateway (zip upload)
DATABASE → Supabase (already connected — koi change nahi)
```

---

## PART 1: Backend — AWS Lambda

### Step 1.1: serverless-http Install Karo

```powershell
# Workspace root mein (jahan server.js hai)
cd C:\Users\Gyanu\Desktop\Talentwale-Workspace\Whatsapp

npm install serverless-http --save
```

### Step 1.2: Lambda Deployment Package Banao

```powershell
# Windows pe zip banane ke liye (PowerShell)
$files = @(
  "server.js",
  "send-whatsapp.js",
  "backend\lambda.js",
  "backend\package.json",
  "node_modules"
)
Compress-Archive -Path $files -DestinationPath "backend-lambda.zip" -Force

# Ya bash/WSL use karein:
# zip -r backend-lambda.zip server.js send-whatsapp.js backend/lambda.js backend/package.json node_modules
```

> **Note**: `backend-lambda.zip` size ~20-50MB hogi (node_modules ke saath). Lambda 250MB tak allow karta hai.

---

### Step 1.3: AWS Lambda Function Create Karo

1. **AWS Console** → Lambda → **Create function**
2. Settings:
   - **Function name**: `talentwale-backend`
   - **Runtime**: `Node.js 18.x`
   - **Architecture**: `x86_64`
3. **Create function** click karo

### Step 1.4: Code Upload Karo

1. Lambda function page pe → **Code** tab
2. **Upload from** → **.zip file**
3. `backend-lambda.zip` select karo → **Save**

### Step 1.5: Handler Set Karo

1. **Code** tab → **Runtime settings** → **Edit**
2. **Handler**: `backend/lambda.handler`
3. **Save**

### Step 1.6: Timeout & Memory Set Karo

1. **Configuration** tab → **General configuration** → **Edit**
2. **Memory**: `512 MB` (recommended)
3. **Timeout**: `15 min 0 sec` (campaigns ke liye)
4. **Save**

### Step 1.7: Environment Variables Set Karo

1. **Configuration** tab → **Environment variables** → **Edit**
2. Yeh variables add karo (`.env` file se values copy karo):

```
IS_LAMBDA                          = true
NODE_ENV                           = production
PORT                               = 3000
PUBLIC_BASE_URL                    = https://YOUR-API-GW-URL/prod  (Step 2 ke baad update karo)

COMMUNICATION_SERVICES_CONNECTION_STRING  = endpoint=https://talentwale.india.communication.azure.com/;accesskey=17SS9HjY2QJx...
WHATSAPP_CHANNEL_ID                = 8ab5407a-7170-4887-8f97-d8b77455c54c
TW_JOB_SUG_HEADER_IMAGE_URL        = https://talentwale.blob.core.windows.net/production/...
BULK_SEND_RATE_PER_SECOND          = 1

SMTP_TEST_RECIPIENT                = Gyanu.talentwale@gmail.com
SMTP_SEND_RATE_PER_MINUTE          = 5
SMTP_BULK_MAX_ROWS                 = 50000

EMAIL_VERIFY_MODE                  = mx
EMAIL_VERIFY_ENFORCE               = true
EMAIL_VERIFY_TIMEOUT_MS            = 3000
EMAIL_BLOCK_DISPOSABLE_DOMAINS     = true
EMAIL_SUPPRESSION_ENABLED          = true

AZURE_STORAGE_QUEUE_CONNECTION_STRING  = DefaultEndpointsProtocol=https;AccountName=talentwale;AccountKey=pVJKk...
AZURE_EMAIL_QUEUE_NAME             = email-q
AZURE_EMAIL_QUEUE_POLL_INTERVAL_MS = 5000
AZURE_EMAIL_QUEUE_BATCH_SIZE       = 5
AZURE_EMAIL_QUEUE_MAX_DEQUEUE      = 3

SUPABASE_DB_HOST                   = aws-1-ap-south-1.pooler.supabase.com
SUPABASE_DB_PORT                   = 6543
SUPABASE_DB_NAME                   = postgres
SUPABASE_DB_USER                   = postgres.hlsjbjxnhwjhlbcvxdbn
SUPABASE_DB_PASSWORD               = Gyanu@882533
SUPABASE_DB_SSLMODE                = require
DB_LOAD_MESSAGE_LIMIT              = 10
```

3. **Save**

---

## PART 2: API Gateway

### Step 2.1: API Gateway Create Karo

1. **AWS Console** → API Gateway → **Create API**
2. **HTTP API** select karo (REST API se faster and cheaper)
3. **Add integration** → Lambda → `talentwale-backend`
4. **API name**: `talentwale-api`
5. **Next** → **Next** → **Create**

### Step 2.2: Routes Configure Karo

API Gateway automatically `$default` route create karta hai — yeh `ANY /{proxy+}` pe Lambda invoke karega. Yeh kaafi hai!

### Step 2.3: CORS Enable Karo

1. API Gateway → `talentwale-api` → **CORS**
2. Settings:
   - **Access-Control-Allow-Origin**: `https://YOUR-AMPLIFY-URL.amplifyapp.com`  
     (ya `*` testing ke liye)
   - **Access-Control-Allow-Methods**: `GET, POST, PUT, DELETE, OPTIONS`
   - **Access-Control-Allow-Headers**: `Content-Type, Authorization, X-Api-Key`
3. **Save**

### Step 2.4: API URL Copy Karo

Deploy ke baad aapko milega:
```
https://XXXXXXXXXX.execute-api.ap-south-1.amazonaws.com/
```
**Yeh URL save karo** — Amplify setup mein use hoga.

### Step 2.5: Lambda mein PUBLIC_BASE_URL Update Karo

Lambda → Environment variables → `PUBLIC_BASE_URL` update karo API Gateway URL se.

---

## PART 3: Frontend — AWS Amplify

### Step 3.1: GitHub Pe Push Karo

```powershell
cd C:\Users\Gyanu\Desktop\Talentwale-Workspace\Whatsapp

git add .
git commit -m "feat: AWS Amplify + Lambda deployment ready"
git push origin main
```

### Step 3.2: Amplify App Create Karo

1. **AWS Console** → AWS Amplify → **Create new app**
2. **Host your web app** → **GitHub**
3. Apna repository aur branch select karo
4. **App settings**:
   - **App name**: `talentwale-frontend`
   - **Environment name**: `prod`
   - **Build spec**: Amplify auto-detect karega `frontend/amplify.yml`
   
   **Important**: Agar auto-detect nahi kare toh manually paste karo:
   ```yaml
   version: 1
   frontend:
     phases:
       preBuild:
         commands:
           - echo "Building TalentWale Frontend"
       build:
         commands:
           - mkdir -p build
           - cp -r frontend/src/* build/
           - cp -r frontend/public/* build/ 2>/dev/null || true
           - |
             if [ -n "$API_BASE_URL" ]; then
               sed -i "s|__AMPLIFY_API_URL__|$API_BASE_URL|g" build/index.html
             else
               sed -i "s|__AMPLIFY_API_URL__||g" build/index.html
             fi
     artifacts:
       baseDirectory: build
       files:
         - '**/*'
   ```

### Step 3.3: Environment Variable Set Karo

**Advanced settings** mein ya deploy ke baad:
- **Key**: `API_BASE_URL`
- **Value**: `https://XXXXXXXXXX.execute-api.ap-south-1.amazonaws.com` (Step 2.4 se)

### Step 3.4: Deploy!

1. **Save and deploy** click karo
2. Build logs dekho — 2-3 minutes mein complete ho jayega
3. Amplify URL milega: `https://main.XXXXXXXXXX.amplifyapp.com`

---

## PART 4: Verification (Test Karo)

### Step 4.1: Backend Test

```bash
# Templates API test karo
curl https://YOUR-API-GW-URL.execute-api.ap-south-1.amazonaws.com/api/templates

# Expected response:
# {"templates": ["verify", "tw_test", "tw_job_sug"]}
```

### Step 4.2: Frontend Test

1. Amplify URL kholo: `https://main.XXXXXXXXXX.amplifyapp.com`
2. Dashboard load hona chahiye
3. Quick Send mein template select karo — list aani chahiye
4. Test WhatsApp message bhejo

### Step 4.3: Logs Check Karo

- Lambda logs: **AWS CloudWatch** → Log groups → `/aws/lambda/talentwale-backend`
- Amplify build logs: **AWS Amplify** → App → Build history

---

## 🔧 Troubleshooting

### Problem: "Module not found: serverless-http"
```powershell
# Root mein install karo
npm install serverless-http
# Phir naya zip banao
```

### Problem: CORS Error (Frontend Lambda se connect nahi kar pa raha)
- API Gateway → CORS → Allow-Origin mein Amplify URL add karo
- Ya `*` se test karo pehle

### Problem: Lambda Timeout
- Campaign ke dauraan Lambda timeout ho sakta hai
- Timeout 15 minutes set karo (maximum)
- Supabase DB mein campaign state save hota hai — resume ho sakta hai

### Problem: "Database connection failed"
- Lambda Environment Variables mein `SUPABASE_DB_*` values check karo
- Supabase project active hai? `aws-1-ap-south-1.pooler.supabase.com`

### Problem: WhatsApp messages nahi ja rahe
- `COMMUNICATION_SERVICES_CONNECTION_STRING` check karo
- `WHATSAPP_CHANNEL_ID` verify karo
- Azure Communication Services account active hai?

---

## 💰 Cost Summary

| Service | Free Tier | Estimated Cost |
|---------|-----------|----------------|
| AWS Amplify | 5GB storage, 15GB/month | **$0** |
| AWS Lambda | 1M requests/month | **$0** |
| API Gateway (HTTP API) | 300M calls/year (12 months) | **~$1-3/month** |
| Supabase DB | Already active | **$0** |
| Azure WhatsApp | Your existing plan | Existing |
| **Total AWS** | | **~$0-3/month** |

---

## 🎯 Custom Domain (Optional)

### Amplify pe Custom Domain:
1. Amplify → App → **Domain management** → **Add domain**
2. `whatsapp.talentwale.co.in` enter karo
3. DNS records add karo (Route 53 ya GoDaddy/Namecheap)

### API Gateway pe Custom Domain:
1. API Gateway → **Custom domain names** → Create
2. Certificate: ACM se free SSL certificate lo
3. DNS pe CNAME add karo

---

## 📝 Files Changed Summary

| File | Change |
|------|--------|
| `server.js` | Lambda handler export added; IS_LAMBDA check for auto-start |
| `backend/lambda.js` | **NEW** — Lambda entry point |
| `backend/package.json` | serverless-http dependency added |
| `backend/.env.lambda.example` | **NEW** — Lambda env vars template |
| `frontend/src/index.html` | API config script tag added |
| `frontend/src/app.js` | API URL interceptor added (fetch + EventSource patch) |
| `frontend/amplify.yml` | **NEW** — Amplify build config |
| `buildspec.yml` | Updated for Lambda zip artifact |
