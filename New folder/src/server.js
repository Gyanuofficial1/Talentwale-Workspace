require("dotenv").config();

const path = require("node:path");
const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const pLimitModule = require("p-limit");
const pLimit = typeof pLimitModule === "function" ? pLimitModule : pLimitModule.default;
const { z } = require("zod");
const config = require("./config");
const { verifyEmail } = require("./services/emailVerifier");
const { fetchSheetRows, pickEmailColumn } = require("./utils/sheet");

const app = express();

const verifySheetSchema = z.object({
  sheetUrl: z.string().url(),
  emailHeader: z.string().min(1).max(100).default("email"),
  maxRows: z.number().int().min(1).max(config.MAX_SHEET_ROWS).default(100),
});

const verifySingleSchema = z.object({
  email: z.string().min(1).max(320),
});

app.use(
  helmet({
    crossOriginResourcePolicy: false,
  })
);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || config.allowedOrigins.length === 0 || config.allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error("CORS not allowed"));
    },
  })
);

app.use(express.json({ limit: "50kb" }));

app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 120,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  })
);

const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 25,
  standardHeaders: "draft-8",
  legacyHeaders: false,
});

function authMiddleware(req, res, next) {
  const key = req.get("x-api-key");
  if (!key || key !== config.VERIFY_API_KEY) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "mail-verification-api",
    timestamp: new Date().toISOString(),
  });
});

app.post("/api/verify-one", authMiddleware, strictLimiter, async (req, res) => {
  const parsed = verifySingleSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
    return;
  }

  try {
    const result = await verifyEmail(parsed.data.email, config.SMTP_TIMEOUT_MS);
    res.json({ result });
  } catch (error) {
    res.status(500).json({ error: "Verification failed", details: String(error.message || error) });
  }
});

app.post("/api/verify-sheet", authMiddleware, strictLimiter, async (req, res) => {
  const parsed = verifySheetSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
    return;
  }

  const { sheetUrl, emailHeader, maxRows } = parsed.data;

  try {
    const rows = await fetchSheetRows(sheetUrl, config.REQUEST_TIMEOUT_MS);
    const extracted = pickEmailColumn(rows, emailHeader).filter((entry) => entry.email).slice(0, maxRows);

    const uniqueEmails = [...new Set(extracted.map((entry) => entry.email.toLowerCase()))];
    const verifyLimiter = pLimit(config.CONCURRENCY);

    const verified = await Promise.all(
      uniqueEmails.map((email) => verifyLimiter(() => verifyEmail(email, config.SMTP_TIMEOUT_MS)))
    );

    const verificationMap = new Map(verified.map((item) => [item.email, item]));

    const resultRows = extracted.map((item) => {
      const match = verificationMap.get(item.email.toLowerCase());
      return {
        rowNumber: item.rowNumber,
        email: item.email,
        status: match ? match.status : "invalid",
        reason: match ? match.reason : "No result",
        checks: match ? match.checks : null,
      };
    });

    const summary = {
      totalRowsRead: rows.length,
      processedRows: resultRows.length,
      uniqueEmails: uniqueEmails.length,
      valid: resultRows.filter((r) => r.status === "valid").length,
      invalid: resultRows.filter((r) => r.status !== "valid").length,
      policy: "SMTP direct check runs only for gmail.com; all non-gmail domains are rejected",
    };

    res.json({ summary, results: resultRows });
  } catch (error) {
    res.status(400).json({
      error: "Unable to verify sheet",
      details: String(error.message || error),
    });
  }
});

app.use(express.static(path.join(__dirname, "..", "public")));

app.get(/.*/, (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});

app.listen(config.PORT, () => {
  console.log(`Mail verification API running on http://localhost:${config.PORT}`);
  if (config.VERIFY_API_KEY === "local-dev-only-key") {
    console.warn("Using default API key. Set VERIFY_API_KEY in .env for production security.");
  }
});
