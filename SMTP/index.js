require('dotenv').config();
const path = require('path');
const express = require('express');
const multer = require('multer');
const nodemailer = require('nodemailer');
const XLSX = require('xlsx');
const axios = require('axios');

const app = express();
const upload = multer({ storage: multer.memoryStorage() });
const PORT = Number(process.env.PORT || 3000);

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

function buildTransporter() {
  const required = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'MAIL_FROM'];
  const missing = required.filter((key) => !process.env[key]);

  if (missing.length) {
    throw new Error(`Missing environment variables: ${missing.join(', ')}`);
  }

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

function parseGoogleSheetUrl(input) {
  const trimmed = (input || '').trim();
  if (!trimmed) return null;

  if (/output=csv/i.test(trimmed)) {
    return trimmed;
  }

  const match = trimmed.match(/\/d\/([a-zA-Z0-9-_]+)/);
  if (!match) return null;

  const sheetId = match[1];
  const gidMatch = trimmed.match(/[?&]gid=(\d+)/);
  const gid = gidMatch ? gidMatch[1] : '0';

  return `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;
}

function workbookToRows(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];

  if (!sheetName) {
    throw new Error('Sheet not found in uploaded file');
  }

  return XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });
}

async function rowsFromGoogleSheet(sheetUrl) {
  const csvUrl = parseGoogleSheetUrl(sheetUrl);
  if (!csvUrl) {
    throw new Error('Invalid Google Sheet URL. Share public sheet URL ya direct CSV export URL dein.');
  }

  const response = await axios.get(csvUrl, { responseType: 'arraybuffer' });
  return workbookToRows(Buffer.from(response.data));
}

function applyTemplate(template, row) {
  return String(template || '').replace(/{{\s*([^{}\s]+)\s*}}/g, (_, key) => {
    const value = row[key];
    return value === undefined || value === null ? '' : String(value);
  });
}

async function getRowsFromRequest(req) {
  const { googleSheetUrl } = req.body;

  if (req.file?.buffer) {
    return workbookToRows(req.file.buffer);
  }

  if (googleSheetUrl) {
    return rowsFromGoogleSheet(googleSheetUrl);
  }

  throw new Error('Excel file upload karein ya Google Sheet URL dein.');
}

app.post('/api/preview', upload.single('excelFile'), async (req, res) => {
  try {
    const rows = await getRowsFromRequest(req);

    if (!rows.length) {
      return res.status(400).json({ ok: false, error: 'Sheet me koi row data nahi mila.' });
    }

    const headers = Array.from(
      rows.reduce((set, row) => {
        Object.keys(row).forEach((key) => set.add(key));
        return set;
      }, new Set())
    );

    return res.json({
      ok: true,
      totalRows: rows.length,
      headers,
      keys: headers.map((header) => `{{${header}}}`),
      sampleRows: rows.slice(0, 5),
    });
  } catch (error) {
    return res.status(400).json({ ok: false, error: error.message });
  }
});

app.post('/api/send', upload.single('excelFile'), async (req, res) => {
  try {
    const { subjectTemplate, htmlTemplate, textTemplate, toField, mailFormat } = req.body;
    const selectedFormat = (mailFormat || 'html').toLowerCase();
    const contentTemplate = selectedFormat === 'text' ? textTemplate : htmlTemplate;

    if (!subjectTemplate || !contentTemplate || !toField) {
      return res.status(400).json({
        ok: false,
        error: 'subjectTemplate, template content aur toField required hain.',
      });
    }

    const rows = await getRowsFromRequest(req);

    if (!rows.length) {
      return res.status(400).json({ ok: false, error: 'Sheet me koi row data nahi mila.' });
    }

    const transporter = buildTransporter();
    await transporter.verify();

    const results = [];

    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      const recipient = String(row[toField] || '').trim();

      if (!recipient) {
        results.push({ row: i + 2, status: 'skipped', reason: `Missing ${toField}` });
        continue;
      }

      const subject = applyTemplate(subjectTemplate, row);
      const content = applyTemplate(contentTemplate, row);

      try {
        const payload = {
          from: process.env.MAIL_FROM,
          to: recipient,
          subject,
        };

        if (selectedFormat === 'text') {
          payload.text = content;
        } else {
          payload.html = content;
        }

        const info = await transporter.sendMail({
          ...payload,
        });

        results.push({ row: i + 2, status: 'sent', to: recipient, messageId: info.messageId });
      } catch (error) {
        results.push({ row: i + 2, status: 'failed', to: recipient, reason: error.message });
      }
    }

    const summary = {
      totalRows: rows.length,
      sent: results.filter((r) => r.status === 'sent').length,
      failed: results.filter((r) => r.status === 'failed').length,
      skipped: results.filter((r) => r.status === 'skipped').length,
    };

    return res.json({ ok: true, summary, results });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Dashboard running: http://localhost:${PORT}`);
});
