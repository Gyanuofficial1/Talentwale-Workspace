# Mail Verification API + UI

This service verifies emails from a public Google Sheet and marks each row as `valid` or `invalid`.

## Checks implemented

- Email syntax validation
- Domain parsing
- MX record lookup
- Disposable domain detection
- Role-based local part detection
- Policy gate: only `gmail.com` proceeds to SMTP check
- Direct SMTP RCPT check against Gmail MX (`gmail-smtp-in.l.google.com:25`)

## Security controls

- API key protection (`x-api-key`)
- Helmet security headers
- CORS allow-list support
- Rate limiting
- Request body size limit
- Input validation with zod
- Request timeouts

## Setup

1. Install dependencies:

```powershell
npm install
```

2. Create env file:

```powershell
Copy-Item .env.example .env
```

3. Update `.env` with a strong `VERIFY_API_KEY`.

4. Run server:

```powershell
npm start
```

5. Open UI:

`http://localhost:8080`

## API endpoints

- `GET /api/health`
- `POST /api/verify-one`
- `POST /api/verify-sheet`

### `POST /api/verify-sheet` payload

```json
{
  "sheetUrl": "https://docs.google.com/spreadsheets/d/<ID>/edit#gid=0",
  "emailHeader": "email",
  "maxRows": 100
}
```

Header required:

- `x-api-key: <VERIFY_API_KEY>`

## Notes

- Sheet must be publicly accessible.
- SMTP acceptance is a strong signal, but inbox deliverability can still vary due to later anti-spam policies.
