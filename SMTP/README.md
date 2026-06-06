# Dynamic Mail Dashboard

Excel upload ya Google Sheet se dynamic personalized emails bhejne ke liye dashboard.

## Setup
1. Dependencies install karo:
```bash
npm install
```
2. `.env` me SMTP values set karo:
```env
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_SECURE=false
MAIL_FROM=
PORT=3000
```
3. Run karo:
```bash
npm start
```
4. Browser me open karo: `http://localhost:3000`

## Kaise Use Karein
1. Excel file upload karo **ya** Google Sheet URL paste karo.
2. `Email Column Name` me wo column naam do jisme recipient email hai (default `email`).
3. Subject aur HTML template me placeholders use karo: `{{name}}`, `{{date}}` etc.
4. Send click karo.

## Google Sheet Notes
- Sheet public/shareable honi chahiye (anyone with link view).
- Standard Google Sheet URL chalega; app automatically CSV export link use karega.

## Example Sheet Columns
`name,email,date,time`
