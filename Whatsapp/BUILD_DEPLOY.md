# Build-Based Server Deployment

Docker removed as requested. This project now uses a build folder (`dist`) for server deployment.

## 1) Create build

```powershell
npm run build
```

This generates `dist/` with:
- server runtime files
- static public files
- production `package.json`
- optional `package-lock.json`

## 2) Upload to server

Upload only `dist/` folder contents to your server.

## 3) Run on server

```powershell
npm install --omit=dev
npm start
```

## 4) Required env

Keep your `.env` on server (same keys your app uses).

## Notes

- This is a Node.js runtime build (not React/Vite bundling).
- For process management, use PM2 or systemd on production server.
