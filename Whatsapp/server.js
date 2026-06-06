require("dotenv").config();

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const net = require("net");
const dns = require("dns").promises;
const xlsx = require("xlsx");
const nodemailer = require("nodemailer");
const { QueueServiceClient } = require("@azure/storage-queue");
const { Pool } = require("pg");
const {
  TEMPLATE_KEYS,
  buildTemplateDefinition,
  buildTemplateMessagePreview,
  getTemplateMediaPreview,
  sendTemplate,
  sendText,
  sendMedia,
  downloadMediaStream,
} = require("./send-whatsapp");

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, "public");
const UPLOAD_DIR = path.join(__dirname, "uploads");
const MAX_UPLOAD_SIZE_BYTES = 20 * 1024 * 1024;
const BULK_SEND_RATE_PER_SECOND = Math.max(1, Number(process.env.BULK_SEND_RATE_PER_SECOND || 3));
const BULK_SEND_DELAY_MS = Math.ceil(1000 / BULK_SEND_RATE_PER_SECOND);
const DEFAULT_CONTACT_ROWS_LIMIT = 1000;
const parsedSmtpBulkMaxRows = Number(process.env.SMTP_BULK_MAX_ROWS);
const SMTP_BULK_MAX_ROWS =
  Number.isFinite(parsedSmtpBulkMaxRows) && parsedSmtpBulkMaxRows > 0
    ? Math.max(DEFAULT_CONTACT_ROWS_LIMIT, Math.floor(parsedSmtpBulkMaxRows))
    : 50000;
const DEFAULT_SMTP_SEND_RATE_PER_MINUTE = Math.max(
  1,
  Number(process.env.SMTP_SEND_RATE_PER_MINUTE || process.env.SMTP_SEND_RATE_PER_SECOND || 120),
);
const DEFAULT_SMTP_SEND_DELAY_MS = Math.ceil(60000 / DEFAULT_SMTP_SEND_RATE_PER_MINUTE);
const SMTP_SEND_TIMEOUT_MS = Math.max(5000, Number(process.env.SMTP_SEND_TIMEOUT_MS || 45000));
const SMTP_VERIFY_TIMEOUT_MS = Math.max(5000, Number(process.env.SMTP_VERIFY_TIMEOUT_MS || 10000));
const SMTP_CONNECTION_TIMEOUT_MS = Math.max(1000, Number(process.env.SMTP_CONNECTION_TIMEOUT_MS || 10000));
const SMTP_GREETING_TIMEOUT_MS = Math.max(1000, Number(process.env.SMTP_GREETING_TIMEOUT_MS || 10000));
const SMTP_SOCKET_TIMEOUT_MS = Math.max(1000, Number(process.env.SMTP_SOCKET_TIMEOUT_MS || 60000));
const EMAIL_VERIFY_MODE = String(process.env.EMAIL_VERIFY_MODE || "mx").trim().toLowerCase();
const EMAIL_VERIFY_ENFORCE = ["1", "true", "yes"].includes(
  String(process.env.EMAIL_VERIFY_ENFORCE || "true").trim().toLowerCase(),
);
const EMAIL_VERIFY_TIMEOUT_MS = Math.max(1000, Number(process.env.EMAIL_VERIFY_TIMEOUT_MS || 3000));
const EMAIL_VERIFY_CACHE_TTL_MS = Math.max(60000, Number(process.env.EMAIL_VERIFY_CACHE_TTL_MS || 6 * 60 * 60 * 1000));
const EMAIL_VERIFY_ALLOW_A_FALLBACK = ["1", "true", "yes"].includes(
  String(process.env.EMAIL_VERIFY_ALLOW_A_FALLBACK || "true").trim().toLowerCase(),
);
const EMAIL_VERIFY_REJECT_RISKY = ["1", "true", "yes"].includes(
  String(process.env.EMAIL_VERIFY_REJECT_RISKY || "true").trim().toLowerCase(),
);
const EMAIL_VERIFY_SMTP_CONNECT_TIMEOUT_MS = Math.max(
  1000,
  Number(process.env.EMAIL_VERIFY_SMTP_CONNECT_TIMEOUT_MS || 6000),
);
const EMAIL_VERIFY_SMTP_COMMAND_TIMEOUT_MS = Math.max(
  1000,
  Number(process.env.EMAIL_VERIFY_SMTP_COMMAND_TIMEOUT_MS || 6000),
);
const EMAIL_VERIFY_SMTP_MAX_MX_TO_TRY = Math.min(
  5,
  Math.max(1, Number(process.env.EMAIL_VERIFY_SMTP_MAX_MX_TO_TRY || 2)),
);
const EMAIL_VERIFY_SMTP_CHECK_CATCH_ALL = ["1", "true", "yes"].includes(
  String(process.env.EMAIL_VERIFY_SMTP_CHECK_CATCH_ALL || "false").trim().toLowerCase(),
);
const EMAIL_VERIFY_SMTP_PROBE_CACHE_TTL_MS = Math.max(
  60000,
  Number(process.env.EMAIL_VERIFY_SMTP_PROBE_CACHE_TTL_MS || 30 * 60 * 1000),
);
const EMAIL_VERIFY_SMTP_HELO_HOST =
  String(process.env.EMAIL_VERIFY_SMTP_HELO_HOST || process.env.PUBLIC_BASE_URL || "localhost.localdomain")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/[:/].*$/, "") || "localhost.localdomain";
const EMAIL_VERIFY_SMTP_PROBE_FROM = String(
  process.env.EMAIL_VERIFY_SMTP_PROBE_FROM || `postmaster@${EMAIL_VERIFY_SMTP_HELO_HOST}`,
)
  .trim()
  .toLowerCase();
const EMAIL_BLOCK_DISPOSABLE_DOMAINS = ["1", "true", "yes"].includes(
  String(process.env.EMAIL_BLOCK_DISPOSABLE_DOMAINS || "true").trim().toLowerCase(),
);
const EMAIL_SUPPRESSION_ENABLED = ["1", "true", "yes"].includes(
  String(process.env.EMAIL_SUPPRESSION_ENABLED || "true").trim().toLowerCase(),
);
const SMTP_TEST_INCLUDE_LIST_UNSUBSCRIBE = ["1", "true", "yes"].includes(
  String(process.env.SMTP_TEST_INCLUDE_LIST_UNSUBSCRIBE || "false").trim().toLowerCase(),
);
const CAMPAIGN_STATUS_TERMINAL = new Set(["completed", "failed", "stopped"]);
const CAMPAIGN_CHANNEL_WHATSAPP = "whatsapp";
const CAMPAIGN_CHANNEL_EMAIL = "email";
const AZURE_EMAIL_QUEUE_POLL_INTERVAL_MS = Math.max(1000, Number(process.env.AZURE_EMAIL_QUEUE_POLL_INTERVAL_MS || 5000));
const AZURE_EMAIL_QUEUE_BATCH_SIZE = Math.min(32, Math.max(1, Number(process.env.AZURE_EMAIL_QUEUE_BATCH_SIZE || 5)));
const AZURE_EMAIL_QUEUE_VISIBILITY_TIMEOUT_SECONDS_RAW = Math.max(
  10,
  Number(process.env.AZURE_EMAIL_QUEUE_VISIBILITY_TIMEOUT_SECONDS || 60),
);
const AZURE_EMAIL_QUEUE_VISIBILITY_TIMEOUT_SECONDS = Math.max(
  AZURE_EMAIL_QUEUE_VISIBILITY_TIMEOUT_SECONDS_RAW,
  Math.ceil(((DEFAULT_SMTP_SEND_DELAY_MS + SMTP_SEND_TIMEOUT_MS) * AZURE_EMAIL_QUEUE_BATCH_SIZE) / 1000) + 15,
);
const AZURE_EMAIL_QUEUE_MAX_DEQUEUE = Math.max(1, Number(process.env.AZURE_EMAIL_QUEUE_MAX_DEQUEUE || 8));
const AZURE_EMAIL_QUEUE_SOFT_FAIL_MAX_RETRY = Math.max(
  0,
  Number(process.env.AZURE_EMAIL_QUEUE_SOFT_FAIL_MAX_RETRY || 1),
);
const SMTP_PROVIDER_CATALOG = ["ses", "gmail"];
const UNSUBSCRIBE_ROUTE_PATH = "/unsubscribe";
const EMAIL_TRACKING_OPEN_ROUTE_PATH = "/api/email/track/open";
const EMAIL_TRACKING_CLICK_ROUTE_PATH = "/api/email/track/click";
const EMAIL_TRACKING_PIXEL_BUFFER = Buffer.from("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", "base64");
const UNSUBSCRIBE_TOKEN_SECRET = String(
  process.env.UNSUBSCRIBE_TOKEN_SECRET ||
    process.env.UNSUBSCRIBE_SECRET ||
    process.env.SUPABASE_DB_PASSWORD ||
    process.env.SMTP_PASS ||
    "",
).trim();
const EMAIL_TRACKING_TOKEN_SECRET = String(
  process.env.EMAIL_TRACKING_TOKEN_SECRET ||
    process.env.EMAIL_TRACKING_SECRET ||
    process.env.UNSUBSCRIBE_TOKEN_SECRET ||
    process.env.UNSUBSCRIBE_SECRET ||
    UNSUBSCRIBE_TOKEN_SECRET ||
    process.env.SUPABASE_DB_PASSWORD ||
    process.env.SMTP_PASS ||
    "",
).trim();
const DEFAULT_UNSUBSCRIBE_TOKEN_SECRET = "local-unsubscribe-secret-change-me";
const DEFAULT_EMAIL_TRACKING_TOKEN_SECRET = "local-email-tracking-secret-change-me";

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

const MAX_CONVERSATIONS = 200;
const MAX_MESSAGES_PER_CONVERSATION = 200;
const MAX_EVENT_LOGS = 100;
const parsedDbLoadLimit = Number(process.env.DB_LOAD_MESSAGE_LIMIT);
const DB_LOAD_MESSAGE_LIMIT = Number.isFinite(parsedDbLoadLimit) && parsedDbLoadLimit > 0 ? parsedDbLoadLimit : 5000;
const conversations = new Map();
const outboundIndex = new Map();
const webhookEventLog = [];
const inboxStreamClients = new Set();
let dbPool = null;
let reportSummaryCache = {
  value: { sent: 0, delivered: 0, failed: 0 },
  expiresAt: 0,
};
const campaignWorkers = new Map();
const emailDomainCheckCache = new Map();
const emailSmtpProbeCache = new Map();
const suppressedEmailRecipients = new Set();
const unsubscribedEmailRecipients = new Set();
const smtpRuntimeProfiles = new Map();
let runtimeSmtpDefaultProvider = "";
let smtpTestState = {
  inProgress: false,
  lastMessage: "Idle",
  lastUpdatedAt: "",
  lastTestRecipient: "",
  lastTestAt: "",
};
const emailQueueSmtpContexts = new Map();
let emailQueueLastSentAt = 0;
const emailQueueRuntime = {
  enabled: false,
  queueClient: null,
  queueName: "",
  pollTimer: null,
  pollInProgress: false,
};
let unsubscribeSecretWarningLogged = false;
let emailTrackingSecretWarningLogged = false;
const REPORT_SUMMARY_CACHE_TTL_MS = 1200;
const DEFAULT_BLOCKED_DISPOSABLE_DOMAINS = [
  "mailinator.com",
  "guerrillamail.com",
  "10minutemail.com",
  "tempmail.com",
  "yopmail.com",
  "trashmail.com",
  "sharklasers.com",
];
const BLOCKED_DISPOSABLE_DOMAINS = new Set(
  String(process.env.EMAIL_BLOCKED_DOMAINS || DEFAULT_BLOCKED_DISPOSABLE_DOMAINS.join(","))
    .split(",")
    .map((item) => String(item || "").trim().toLowerCase())
    .filter(Boolean),
);

const EMAIL_VERIFY_MODES_WITH_MX = new Set(["mx", "smtp", "smtp_probe", "full"]);
const EMAIL_VERIFY_MODES_WITH_SMTP_PROBE = new Set(["smtp", "smtp_probe", "full"]);

function isEmailMxValidationEnabled() {
  return EMAIL_VERIFY_MODES_WITH_MX.has(EMAIL_VERIFY_MODE);
}

function isEmailSmtpProbeEnabled() {
  return EMAIL_VERIFY_MODES_WITH_SMTP_PROBE.has(EMAIL_VERIFY_MODE);
}

function updateSmtpTestState(patch = {}) {
  smtpTestState = {
    ...smtpTestState,
    ...patch,
    lastUpdatedAt: new Date().toISOString(),
  };
}

function normalizeSmtpSendRatePerMinute(value, fallback = DEFAULT_SMTP_SEND_RATE_PER_MINUTE) {
  const fallbackValue = Math.max(1, Math.floor(Number(fallback) || DEFAULT_SMTP_SEND_RATE_PER_MINUTE));
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallbackValue;
  }
  return Math.min(60000, parsed);
}

function getSmtpSendDelayMs(sendRatePerMinute = DEFAULT_SMTP_SEND_RATE_PER_MINUTE) {
  return Math.ceil(60000 / normalizeSmtpSendRatePerMinute(sendRatePerMinute));
}

function normalizeDeliveryStatus(status) {
  const value = String(status || "").trim().toLowerCase();
  if (!value) {
    return "pending";
  }
  if (["delivered", "deliverysuccess", "success", "read", "seen"].includes(value)) {
    return "delivered";
  }
  if (["failed", "deliveryfailed", "error", "undelivered"].includes(value)) {
    return "failed";
  }
  if (["sent", "accepted", "queued", "submitted"].includes(value)) {
    return "sent";
  }
  return value;
}

function formatDeliveryStatusLabel(status) {
  const rawValue = String(status || "").trim().toLowerCase();
  if (rawValue === "read" || rawValue === "seen") {
    return "Read";
  }
  const normalized = normalizeDeliveryStatus(status);
  if (normalized === "delivered") {
    return "Delivered";
  }
  if (normalized === "failed") {
    return "Failed";
  }
  if (normalized === "sent") {
    return "Sent";
  }
  if (normalized === "pending") {
    return "Pending";
  }
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function getReportReason(message) {
  return String(message?.statusDetails || "").trim();
}

function maskSecretValue(value, options = {}) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }

  const showStart = Math.max(0, Number(options.showStart || 4));
  const showEnd = Math.max(0, Number(options.showEnd || 3));
  const minMaskedLength = Math.max(showStart + showEnd + 1, Number(options.minMaskedLength || 8));
  if (raw.length <= minMaskedLength) {
    return "*".repeat(Math.max(8, raw.length));
  }

  return `${raw.slice(0, showStart)}${"*".repeat(Math.max(8, raw.length - showStart - showEnd))}${raw.slice(-showEnd)}`;
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function broadcastInboxEvent(event) {
  const body = `data: ${JSON.stringify({ timestamp: new Date().toISOString(), ...event })}\n\n`;
  for (const res of inboxStreamClients) {
    try {
      res.write(body);
    } catch {
      inboxStreamClients.delete(res);
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getSupabaseDbConfig() {
  const connectionString = String(process.env.SUPABASE_DB_URL || "").trim();
  if (connectionString) {
    return { connectionString };
  }

  const host = String(process.env.SUPABASE_DB_HOST || "").trim();
  const port = Number(process.env.SUPABASE_DB_PORT || 6543);
  const database = String(process.env.SUPABASE_DB_NAME || "postgres").trim();
  const user = String(process.env.SUPABASE_DB_USER || "").trim();
  const password = String(process.env.SUPABASE_DB_PASSWORD || "").trim();
  const sslMode = String(process.env.SUPABASE_DB_SSLMODE || "require").trim().toLowerCase();

  if (!host || !database || !user || !password) {
    return null;
  }

  return {
    host,
    port,
    database,
    user,
    password,
    ssl: sslMode === "disable" ? false : { rejectUnauthorized: false },
  };
}

async function initDatabase() {
  const config = getSupabaseDbConfig();
  if (!config) {
    throw new Error("Supabase DB config not found. Configure SUPABASE_DB_* or SUPABASE_DB_URL.");
  }

  try {
    dbPool = config.connectionString
      ? new Pool({ connectionString: config.connectionString, ssl: { rejectUnauthorized: false } })
      : new Pool(config);

    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS whatsapp_messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        participant TEXT NOT NULL,
        reply_to TEXT NULL,
        direction TEXT NOT NULL,
        message_type TEXT NOT NULL,
        message_text TEXT NULL,
        media_json JSONB NULL,
        template_name TEXT NULL,
        status TEXT NULL,
        status_details TEXT NULL,
        message_timestamp TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await dbPool.query(`
      CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_conversation_timestamp
      ON whatsapp_messages (conversation_id, message_timestamp)
    `);

    await dbPool.query(`
      CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_direction_timestamp
      ON whatsapp_messages (direction, message_timestamp DESC)
    `);

    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS campaigns (
        id TEXT PRIMARY KEY,
        channel TEXT NOT NULL,
        status TEXT NOT NULL,
        stop_requested BOOLEAN NOT NULL DEFAULT FALSE,
        total INTEGER NOT NULL DEFAULT 0,
        processed INTEGER NOT NULL DEFAULT 0,
        sent INTEGER NOT NULL DEFAULT 0,
        failed INTEGER NOT NULL DEFAULT 0,
        payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        last_message TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        started_at TIMESTAMPTZ NULL,
        completed_at TIMESTAMPTZ NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await dbPool.query(`
      CREATE INDEX IF NOT EXISTS idx_campaigns_channel_created
      ON campaigns (channel, created_at DESC)
    `);

    await dbPool.query(`
      CREATE INDEX IF NOT EXISTS idx_campaigns_channel_status
      ON campaigns (channel, status, created_at ASC)
    `);

    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS campaign_recipients (
        id BIGSERIAL PRIMARY KEY,
        campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
        row_index INTEGER NOT NULL,
        recipient TEXT NOT NULL,
        row_data JSONB NOT NULL DEFAULT '{}'::jsonb,
        status TEXT NOT NULL DEFAULT 'pending',
        provider_message_id TEXT NULL,
        error_text TEXT NULL,
        processed_at TIMESTAMPTZ NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await dbPool.query(`
      CREATE INDEX IF NOT EXISTS idx_campaign_recipients_campaign_status
      ON campaign_recipients (campaign_id, status, row_index)
    `);

    await dbPool.query(`
      CREATE INDEX IF NOT EXISTS idx_campaign_recipients_campaign_row
      ON campaign_recipients (campaign_id, row_index)
    `);

    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS smtp_credentials (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        profile_name TEXT NOT NULL,
        host TEXT NOT NULL,
        port INTEGER NOT NULL,
        secure BOOLEAN NOT NULL DEFAULT FALSE,
        user_name TEXT NOT NULL,
        pass_encrypted TEXT NOT NULL,
        from_address TEXT NOT NULL,
        from_name TEXT NOT NULL DEFAULT '',
        reply_to_address TEXT NULL,
        from_options TEXT NOT NULL DEFAULT '',
        is_active BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await dbPool.query(`
      ALTER TABLE smtp_credentials
      ADD COLUMN IF NOT EXISTS from_name TEXT NOT NULL DEFAULT ''
    `);

    await dbPool.query(`
      ALTER TABLE smtp_credentials
      ADD COLUMN IF NOT EXISTS reply_to_address TEXT NULL
    `);

    await dbPool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_smtp_credentials_provider_active
      ON smtp_credentials (provider)
      WHERE is_active = TRUE
    `);

    await dbPool.query(`
      CREATE INDEX IF NOT EXISTS idx_smtp_credentials_provider_updated
      ON smtp_credentials (provider, updated_at DESC)
    `);

    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS email_unsubscribes (
        email TEXT PRIMARY KEY,
        source TEXT NOT NULL DEFAULT 'footer_link',
        campaign_id TEXT NULL,
        token_hash TEXT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await dbPool.query(`
      CREATE INDEX IF NOT EXISTS idx_email_unsubscribes_updated
      ON email_unsubscribes (updated_at DESC)
    `);

    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS email_suppressions (
        email TEXT PRIMARY KEY,
        source TEXT NOT NULL DEFAULT 'hard_bounce',
        reason TEXT NULL,
        first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await dbPool.query(`
      CREATE INDEX IF NOT EXISTS idx_email_suppressions_updated
      ON email_suppressions (updated_at DESC)
    `);

    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS email_rejections (
        id BIGSERIAL PRIMARY KEY,
        campaign_id TEXT NULL,
        recipient TEXT NOT NULL,
        gate TEXT NOT NULL,
        verdict TEXT NOT NULL DEFAULT 'rejected',
        reason TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'preflight',
        row_index INTEGER NULL,
        row_data JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await dbPool.query(`
      CREATE INDEX IF NOT EXISTS idx_email_rejections_campaign_created
      ON email_rejections (campaign_id, created_at DESC)
    `);

    await dbPool.query(`
      CREATE INDEX IF NOT EXISTS idx_email_rejections_recipient_created
      ON email_rejections (recipient, created_at DESC)
    `);

    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS email_engagement_events (
        id BIGSERIAL PRIMARY KEY,
        campaign_id TEXT NULL,
        recipient TEXT NULL,
        event_type TEXT NOT NULL,
        target_url TEXT NULL,
        row_index INTEGER NULL,
        provider_message_id TEXT NULL,
        token_hash TEXT NULL,
        user_agent TEXT NULL,
        referer TEXT NULL,
        ip_address TEXT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await dbPool.query(`
      CREATE INDEX IF NOT EXISTS idx_email_engagement_campaign_event_created
      ON email_engagement_events (campaign_id, event_type, created_at DESC)
    `);

    await dbPool.query(`
      CREATE INDEX IF NOT EXISTS idx_email_engagement_campaign_recipient
      ON email_engagement_events (campaign_id, recipient)
    `);

    console.log("Supabase Postgres connected. Inbox persistence enabled.");
  } catch (error) {
    dbPool = null;
    throw new Error(`Supabase DB init failed: ${error.message || error}`);
  }
}

function ensureDbAvailable() {
  if (!dbPool) {
    throw new Error("Supabase DB connection is required.");
  }
}

async function saveMessageToDb(participant, message) {
  ensureDbAvailable();

  const conversationId = getConversationId(participant);
  if (!conversationId || !message?.id) {
    return;
  }

  try {
    await dbPool.query(
      `
        INSERT INTO whatsapp_messages (
          id, conversation_id, participant, reply_to, direction, message_type, message_text,
          media_json, template_name, status, status_details, message_timestamp
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12)
        ON CONFLICT (id) DO NOTHING
      `,
      [
        String(message.id),
        conversationId,
        String(participant || ""),
        String(message.replyTo || ""),
        String(message.direction || "unknown"),
        String(message.type || "unknown"),
        String(message.text || ""),
        message.media ? JSON.stringify(message.media) : null,
        String(message.templateName || ""),
        message.status ? String(message.status) : null,
        message.statusDetails ? String(message.statusDetails) : null,
        new Date(message.timestamp || Date.now()),
      ],
    );
    if (String(message.direction || "").toLowerCase() === "outbound") {
      reportSummaryCache.expiresAt = 0;
    }
  } catch (error) {
    pushWebhookLog({
      kind: "db_save_error",
      error: error.message || "DB save failed.",
      messageId: String(message?.id || ""),
    });
  }
}

async function loadMessagesFromDb() {
  ensureDbAvailable();

  try {
    const result = await dbPool.query(
      `
        SELECT
          id, conversation_id, participant, reply_to, direction, message_type, message_text,
          media_json, template_name, status, status_details, message_timestamp
        FROM whatsapp_messages
        ORDER BY message_timestamp ASC
        LIMIT $1
      `,
      [DB_LOAD_MESSAGE_LIMIT],
    );

    const rows = Array.isArray(result.rows) ? result.rows : [];
    for (const row of rows) {
      const media = row.media_json && typeof row.media_json === "object" ? row.media_json : null;
      pushMessage(
        row.participant || row.conversation_id,
        {
          id: row.id,
          direction: row.direction,
          type: row.message_type,
          text: row.message_text || "",
          media,
          templateName: row.template_name || "",
          status: row.status || undefined,
          statusDetails: row.status_details || undefined,
          replyTo: row.reply_to || "",
          timestamp: new Date(row.message_timestamp).toISOString(),
        },
        { persist: false },
      );
    }
    console.log(`Loaded ${rows.length} messages from Supabase DB.`);
  } catch (error) {
    console.error("Failed to load messages from Supabase DB.", error.message || error);
  }
}

async function loadEmailUnsubscribesFromDb() {
  ensureDbAvailable();

  try {
    const result = await dbPool.query(`
      SELECT email
      FROM email_unsubscribes
    `);

    unsubscribedEmailRecipients.clear();
    for (const row of Array.isArray(result.rows) ? result.rows : []) {
      const email = normalizeEmail(row.email);
      if (email) {
        unsubscribedEmailRecipients.add(email);
      }
    }
    console.log(`Loaded ${unsubscribedEmailRecipients.size} unsubscribed recipients from Supabase DB.`);
  } catch (error) {
    console.error("Failed to load email unsubscribes from Supabase DB.", error.message || error);
  }
}

async function loadEmailSuppressionsFromDb() {
  ensureDbAvailable();

  try {
    const result = await dbPool.query(`
      SELECT email
      FROM email_suppressions
    `);

    suppressedEmailRecipients.clear();
    for (const row of Array.isArray(result.rows) ? result.rows : []) {
      const email = normalizeEmail(row.email);
      if (email) {
        suppressedEmailRecipients.add(email);
      }
    }
    console.log(`Loaded ${suppressedEmailRecipients.size} suppressed recipients from Supabase DB.`);
  } catch (error) {
    console.error("Failed to load email suppressions from Supabase DB.", error.message || error);
  }
}

async function upsertEmailSuppression(email, options = {}) {
  const recipient = normalizeEmail(email);
  if (!isValidEmail(recipient)) {
    return;
  }
  if (!dbPool) {
    return;
  }

  try {
    await dbPool.query(
      `
        INSERT INTO email_suppressions (
          email, source, reason, first_seen_at, last_seen_at, updated_at
        )
        VALUES ($1, $2, $3, NOW(), NOW(), NOW())
        ON CONFLICT (email)
        DO UPDATE SET
          source = EXCLUDED.source,
          reason = EXCLUDED.reason,
          last_seen_at = NOW(),
          updated_at = NOW()
      `,
      [
        recipient,
        String(options.source || "hard_bounce").trim() || "hard_bounce",
        String(options.reason || "").trim() || null,
      ],
    );
  } catch (error) {
    console.error("Failed to upsert email suppression.", error.message || error);
  }
}

async function logEmailRejection(entry = {}) {
  if (!dbPool) {
    return;
  }

  const recipient = normalizeEmail(entry.recipient);
  if (!recipient) {
    return;
  }

  const gate = String(entry.gate || "preflight").trim().toLowerCase();
  const reason = String(entry.reason || "Email rejected").trim();

  try {
    await dbPool.query(
      `
        INSERT INTO email_rejections (
          campaign_id, recipient, gate, verdict, reason, source, row_index, row_data
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
      `,
      [
        String(entry.campaignId || "").trim() || null,
        recipient,
        gate || "preflight",
        String(entry.verdict || "rejected").trim().toLowerCase() || "rejected",
        reason,
        String(entry.source || "preflight").trim().toLowerCase() || "preflight",
        Number.isFinite(entry.rowIndex) ? Number(entry.rowIndex) : null,
        JSON.stringify(sanitizeRowObject(entry.rowData)),
      ],
    );
  } catch (error) {
    console.error("Failed to save email rejection.", error.message || error);
  }
}

async function getEmailRejectionList(options = {}) {
  ensureDbAvailable();

  const limit = Number.isFinite(options.limit)
    ? Math.max(1, Math.min(2000, Math.floor(options.limit)))
    : 200;
  const offset = Number.isFinite(options.offset) ? Math.max(0, Math.floor(options.offset)) : 0;
  const campaignId = String(options.campaignId || "").trim();
  const recipient = normalizeEmail(options.recipient || "");

  const whereParts = [];
  const params = [];

  if (campaignId) {
    params.push(campaignId);
    whereParts.push(`campaign_id = $${params.length}`);
  }

  if (recipient) {
    params.push(recipient);
    whereParts.push(`recipient = $${params.length}`);
  }

  const whereSql = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";

  params.push(limit);
  const limitParam = `$${params.length}`;
  params.push(offset);
  const offsetParam = `$${params.length}`;

  const result = await dbPool.query(
    `
      SELECT
        id,
        campaign_id,
        recipient,
        gate,
        verdict,
        reason,
        source,
        row_index,
        row_data,
        created_at,
        COUNT(*) OVER()::int AS total_count
      FROM email_rejections
      ${whereSql}
      ORDER BY created_at DESC
      LIMIT ${limitParam}
      OFFSET ${offsetParam}
    `,
    params,
  );

  const rows = Array.isArray(result.rows) ? result.rows : [];
  const total = Number(rows[0]?.total_count || 0);

  return {
    total,
    items: rows.map((row) => ({
      id: Number(row.id || 0),
      campaignId: String(row.campaign_id || ""),
      recipient: String(row.recipient || ""),
      gate: String(row.gate || ""),
      verdict: String(row.verdict || "rejected"),
      reason: String(row.reason || ""),
      source: String(row.source || ""),
      rowIndex: Number.isFinite(Number(row.row_index)) ? Number(row.row_index) : null,
      rowData: row.row_data && typeof row.row_data === "object" ? row.row_data : {},
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : "",
    })),
    hasMore: offset + rows.length < total,
    nextOffset: offset + rows.length < total ? offset + rows.length : null,
  };
}

async function updateMessageStatusInDb(messageId, status, statusDetails) {
  if (!messageId) {
    return;
  }
  ensureDbAvailable();

  try {
    await dbPool.query(
      `
        UPDATE whatsapp_messages
        SET status = $2, status_details = $3
        WHERE id = $1
      `,
      [String(messageId), status ? String(status) : null, statusDetails ? String(statusDetails) : null],
    );
    reportSummaryCache.expiresAt = 0;
  } catch (error) {
    pushWebhookLog({
      kind: "db_status_update_error",
      error: error.message || "DB status update failed.",
      messageId: String(messageId),
    });
  }
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalLength = 0;

    req.on("data", (chunk) => {
      chunks.push(chunk);
      totalLength += chunk.length;
      if (totalLength > 5 * 1024 * 1024) {
        req.destroy();
        reject(new Error("Request body is too large."));
      }
    });

    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function readRequestBuffer(req, maxBytes = 5 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalLength = 0;

    req.on("data", (chunk) => {
      chunks.push(chunk);
      totalLength += chunk.length;
      if (totalLength > maxBytes) {
        req.destroy();
        reject(new Error("Request body is too large."));
      }
    });

    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function ensureUploadDir() {
  if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  }
}

function sanitizeFileName(fileName) {
  return String(fileName || "")
    .trim()
    .replace(/[^a-zA-Z0-9._ -]/g, "_")
    .replace(/\s+/g, " ")
    .slice(0, 120);
}

function getExt(fileName) {
  const ext = path.extname(fileName || "").toLowerCase();
  return /^[.][a-z0-9]{1,10}$/.test(ext) ? ext : "";
}

function getMimeTypeFromExt(ext) {
  const mimeMap = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".pdf": "application/pdf",
    ".txt": "text/plain",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xls": "application/vnd.ms-excel",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".ppt": "application/vnd.ms-powerpoint",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  };
  return mimeMap[ext] || "application/octet-stream";
}

function getMediaKindFromMime(mimeType, fileName) {
  const mime = String(mimeType || "").toLowerCase();
  if (mime.startsWith("image/")) {
    return "image";
  }
  const ext = getExt(fileName);
  if ([".jpg", ".jpeg", ".png", ".webp", ".gif"].includes(ext)) {
    return "image";
  }
  return "document";
}

function getPublicBaseUrl(req) {
  const envUrl = String(process.env.PUBLIC_BASE_URL || "").trim().replace(/\/+$/, "");
  if (envUrl) {
    return envUrl;
  }

  const forwardedHost = String(req.headers["x-forwarded-host"] || "").trim();
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").trim() || "https";
  if (forwardedHost) {
    return `${forwardedProto}://${forwardedHost}`;
  }

  const host = String(req.headers.host || "").trim();
  if (host && !/^localhost[:]|^127[.]0[.]0[.]1[:]?/.test(host)) {
    return `http://${host}`;
  }

  return "";
}

async function resolvePublicBaseUrl(req) {
  const direct = getPublicBaseUrl(req);
  if (direct) {
    return direct;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1200);
    const response = await fetch("http://127.0.0.1:4040/api/tunnels", {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      return "";
    }

    const payload = await response.json();
    const tunnels = Array.isArray(payload?.tunnels) ? payload.tunnels : [];
    const httpsTunnel = tunnels.find((tunnel) => String(tunnel?.public_url || "").startsWith("https://"));
    return String(httpsTunnel?.public_url || "").trim().replace(/\/+$/, "");
  } catch {
    return "";
  }
}

function normalizePhone(value) {
  const phone = String(value || "").replace(/[+\s().-]/g, "");

  if (/^\d{10}$/.test(phone)) {
    return `91${phone}`;
  }

  if (/^0\d{10}$/.test(phone)) {
    return `91${phone.slice(1)}`;
  }

  return phone;
}

function getCell(row, columnName) {
  if (!columnName) {
    return "";
  }

  return row[columnName] ?? "";
}

function getConversationId(value) {
  return String(value || "").trim().toLowerCase();
}

function getOrCreateConversation(participant) {
  const id = getConversationId(participant);
  if (!id) {
    return null;
  }

  if (!conversations.has(id)) {
    conversations.set(id, {
      id,
      participant,
      replyTo: "",
      unread: 0,
      lastTimestamp: new Date().toISOString(),
      messages: [],
    });
  }

  return conversations.get(id);
}

function pushMessage(participant, message, options = {}) {
  const conversation = getOrCreateConversation(participant);
  if (!conversation) {
    return null;
  }

  conversation.messages.push(message);
  if (conversation.messages.length > MAX_MESSAGES_PER_CONVERSATION) {
    conversation.messages = conversation.messages.slice(-MAX_MESSAGES_PER_CONVERSATION);
  }

  if (message.direction === "inbound") {
    conversation.unread += 1;
  }

  conversation.lastTimestamp = message.timestamp;
  if (conversation.participant !== participant && participant) {
    conversation.participant = participant;
  }
  if (message.replyTo) {
    conversation.replyTo = String(message.replyTo).trim();
  }

  while (conversations.size > MAX_CONVERSATIONS) {
    const oldest = Array.from(conversations.values()).sort(
      (a, b) => new Date(a.lastTimestamp).getTime() - new Date(b.lastTimestamp).getTime(),
    )[0];
    if (!oldest) {
      break;
    }
    conversations.delete(oldest.id);
  }

  if (options.persist !== false) {
    void saveMessageToDb(participant, message);
  }
  if (options.broadcast !== false) {
    broadcastInboxEvent({
      type: "message",
      conversationId: conversation.id,
      direction: message.direction || "unknown",
      messageId: message.id || "",
    });
  }

  return conversation;
}

function ingestInboundEvent(event) {
  const data = event?.data || {};
  const senderRaw = String(data.from || "").trim();
  const senderBsuId = String(data.fromBSUID || "").trim();
  const senderNormalized = normalizePhone(senderRaw);
  const participant = senderRaw || senderBsuId;
  if (!participant) {
    return;
  }

  const body =
    data.content ||
    data.button?.text ||
    data.interactive?.buttonReply?.title ||
    data.interactive?.listReply?.title ||
    data.reaction?.emoji ||
    `[${data.messageType || "message"}]`;

  const media = data.media
    ? {
        id: String(data.media.id || "").trim(),
        mimeType: String(data.media.mimeType || "").trim(),
        caption: String(data.media.caption || "").trim(),
        fileName: String(data.media.fileName || "").trim(),
      }
    : null;

  pushMessage(participant, {
    id: String(data.messageId || event.id || `${Date.now()}-${Math.random()}`),
    direction: "inbound",
    type: data.messageType || "unknown",
    text: String(body || "").trim(),
    media,
    replyTo: /^\d{10,15}$/.test(senderNormalized) ? senderNormalized : "",
    timestamp: data.receivedTimestamp || event.eventTime || new Date().toISOString(),
  });
}

function ingestDeliveryStatusEvent(event) {
  const data = event?.data || {};
  const messageId = String(data.messageId || "").trim();
  if (!messageId || !outboundIndex.has(messageId)) {
    pushWebhookLog({
      kind: "delivery_status_unmatched",
      messageId: messageId || null,
      status: data.status || null,
      data,
    });
    return;
  }

  const conversationId = outboundIndex.get(messageId);
  const conversation = conversations.get(conversationId);
  if (!conversation) {
    return;
  }

  const targetMessage = conversation.messages.find((message) => message.id === messageId);
  if (targetMessage) {
    targetMessage.status = formatDeliveryStatusLabel(data.status || "Sent");
    targetMessage.statusDetails =
      data.error?.message ||
      data.error?.code ||
      data.reason ||
      data.deliveryStatusDetails ||
      data.channelStatusMessage ||
      "";
  }
  broadcastInboxEvent({
    type: "status",
    conversationId,
    messageId,
    status: data.status || "Sent",
  });
  void updateMessageStatusInDb(
    messageId,
    formatDeliveryStatusLabel(data.status || "Sent"),
    data.error?.message ||
      data.error?.code ||
      data.reason ||
      data.deliveryStatusDetails ||
      data.channelStatusMessage ||
      "",
  );

  pushWebhookLog({
    kind: "delivery_status",
    conversationId,
    messageId,
    status: data.status || null,
    details:
      data.error?.message ||
      data.error?.code ||
      data.reason ||
      data.deliveryStatusDetails ||
      data.channelStatusMessage ||
      null,
    data,
  });
}

function markConversationRead(conversationId) {
  const conversation = conversations.get(conversationId);
  if (conversation && conversation.unread > 0) {
    conversation.unread = 0;
    broadcastInboxEvent({
      type: "read",
      conversationId: conversation.id,
    });
  }
  return conversation;
}

function truncateText(value, maxLength = 140) {
  const text = String(value || "");
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxLength - 1))}...`;
}

function buildReportSummary(messages) {
  return messages.reduce(
    (summary, message) => {
      const normalized = normalizeDeliveryStatus(message.status);
      summary.sent += 1;
      if (normalized === "delivered") {
        summary.delivered += 1;
      }
      if (normalized === "failed") {
        summary.failed += 1;
      }
      return summary;
    },
    { sent: 0, delivered: 0, failed: 0 },
  );
}

async function getReportSummaryCounts() {
  const now = Date.now();
  if (reportSummaryCache.expiresAt > now) {
    return reportSummaryCache.value;
  }

  ensureDbAvailable();

  const result = await dbPool.query(`
    SELECT
      COUNT(*)::int AS sent,
      COALESCE(
        SUM(
          CASE
            WHEN LOWER(COALESCE(status, '')) IN ('delivered', 'deliverysuccess', 'success', 'read', 'seen')
            THEN 1 ELSE 0
          END
        ),
        0
      )::int AS delivered,
      COALESCE(
        SUM(
          CASE
            WHEN LOWER(COALESCE(status, '')) IN ('failed', 'deliveryfailed', 'error', 'undelivered')
            THEN 1 ELSE 0
          END
        ),
        0
      )::int AS failed
    FROM whatsapp_messages
    WHERE direction = 'outbound'
  `);

  const row = result.rows?.[0] || {};
  const summary = {
    sent: Number(row.sent || 0),
    delivered: Number(row.delivered || 0),
    failed: Number(row.failed || 0),
  };
  reportSummaryCache = {
    value: summary,
    expiresAt: now + REPORT_SUMMARY_CACHE_TTL_MS,
  };
  return summary;
}

async function getReportRows(limit = 200, options = {}) {
  const includeMessageText = options.includeMessageText === true;
  ensureDbAvailable();

  const selectMessageText = includeMessageText ? ", message_text" : "";
  const result = await dbPool.query(
    `
      SELECT
        id,
        participant,
        reply_to,
        direction,
        message_type,
        template_name,
        status,
        status_details,
        message_timestamp
        ${selectMessageText}
      FROM whatsapp_messages
      WHERE direction = 'outbound'
      ORDER BY message_timestamp DESC
      LIMIT $1
    `,
    [Math.max(1, Math.min(2000, limit))],
  );

  return (result.rows || []).map((row) => ({
    id: row.id || "",
    participant: row.participant || "",
    replyTo: row.reply_to || "",
    type: row.message_type || "",
    templateName: row.template_name || "",
    text: includeMessageText ? row.message_text || "" : "",
    status: formatDeliveryStatusLabel(row.status || "Sent"),
    statusDetails: String(row.status_details || "").trim(),
    timestamp: new Date(row.message_timestamp).toISOString(),
  }));
}

async function getReportPayload(limit = 200, options = {}) {
  const summaryOnly = options.summaryOnly === true;
  if (summaryOnly) {
    return {
      summary: await getReportSummaryCounts(),
      rows: [],
    };
  }

  const includeMessageText = options.includeMessageText === true;
  const rows = await getReportRows(limit, { includeMessageText });
  return {
    summary: buildReportSummary(rows),
    rows,
  };
}

async function getDashboardSummaryPayload(options = {}) {
  const reportPayload = await getReportPayload(1, {
    summaryOnly: true,
    includeMessageText: false,
  });
  return {
    inbox: getInboxCountSummary(),
    report: reportPayload.summary,
  };
}

function getInboxSummary(limit = 10, offset = 0, options = {}) {
  const recentFullLimit = Number.isFinite(options.recentFullLimit)
    ? Math.max(20, Math.min(MAX_MESSAGES_PER_CONVERSATION, Math.floor(options.recentFullLimit)))
    : 80;
  const includeRecentConversation = options.includeRecentConversation !== false;
  const query = String(options.query || "").trim();

  const sorted = Array.from(conversations.values())
    .filter((conversation) => conversationMatchesQuery(conversation, query))
    .sort((a, b) => new Date(b.lastTimestamp).getTime() - new Date(a.lastTimestamp).getTime())
    .map((conversation) => {
      const lastMessage = conversation.messages[conversation.messages.length - 1] || null;
      return {
        id: conversation.id,
        participant: conversation.participant,
        replyTo: conversation.replyTo || "",
        unread: conversation.unread,
        lastTimestamp: conversation.lastTimestamp,
        lastMessage: lastMessage
          ? {
              direction: lastMessage.direction,
              text: truncateText(lastMessage.text, 140),
              status: lastMessage.status || null,
              timestamp: lastMessage.timestamp,
            }
          : null,
      };
    });

  const pageConversations = sorted.slice(offset, offset + limit);
  const recentConversationId = includeRecentConversation && offset === 0 ? pageConversations[0]?.id || "" : "";
  const recentConversationSource = recentConversationId ? conversations.get(recentConversationId) : null;

  return {
    total: sorted.length,
    conversations: pageConversations,
    recentConversation: recentConversationSource
      ? getConversationPayload(recentConversationSource, { limit: recentFullLimit })
      : null,
    hasMore: offset + limit < sorted.length,
    nextOffset: offset + limit < sorted.length ? offset + limit : null,
  };
}

function getInboxCountSummary() {
  const list = Array.from(conversations.values());
  return {
    total: list.length,
    unread: list.reduce((sum, conversation) => sum + Number(conversation.unread || 0), 0),
  };
}

function getConversationPayload(conversation, options = {}) {
  const limit = Number.isFinite(options.limit)
    ? Math.max(20, Math.min(MAX_MESSAGES_PER_CONVERSATION, Math.floor(options.limit)))
    : MAX_MESSAGES_PER_CONVERSATION;
  const messages = conversation.messages.slice(-limit);

  return {
    id: conversation.id,
    participant: conversation.participant,
    replyTo: conversation.replyTo || "",
    unread: conversation.unread,
    totalMessages: conversation.messages.length,
    messages,
  };
}

function normalizeSearchDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

function conversationMatchesQuery(conversation, query) {
  const text = String(query || "").trim().toLowerCase();
  if (!text) {
    return true;
  }

  const digits = normalizeSearchDigits(text);
  const participant = String(conversation.participant || "");
  const replyTo = String(conversation.replyTo || "");
  const id = String(conversation.id || "");
  const haystack = `${participant} ${replyTo} ${id}`.toLowerCase();
  if (haystack.includes(text)) {
    return true;
  }

  if (!digits) {
    return false;
  }

  const digitHaystack = `${normalizeSearchDigits(participant)} ${normalizeSearchDigits(replyTo)} ${normalizeSearchDigits(id)}`;
  return digitHaystack.includes(digits);
}

async function getConversationPayloadById(conversationId, options = {}) {
  const limit = Number.isFinite(options.limit)
    ? Math.max(20, Math.min(MAX_MESSAGES_PER_CONVERSATION, Math.floor(options.limit)))
    : MAX_MESSAGES_PER_CONVERSATION;

  const inMemoryConversation = conversations.get(conversationId);
  if (inMemoryConversation) {
    return getConversationPayload(inMemoryConversation, { limit });
  }

  ensureDbAvailable();

  const rowsResult = await dbPool.query(
    `
      SELECT
        id,
        conversation_id,
        participant,
        reply_to,
        direction,
        message_type,
        message_text,
        media_json,
        template_name,
        status,
        status_details,
        message_timestamp
      FROM whatsapp_messages
      WHERE conversation_id = $1
      ORDER BY message_timestamp DESC
      LIMIT $2
    `,
    [conversationId, limit],
  );

  const rows = Array.isArray(rowsResult.rows) ? rowsResult.rows : [];
  if (!rows.length) {
    return null;
  }

  const latestRow = rows[0];
  const messages = rows
    .slice()
    .reverse()
    .map((row) => ({
      id: row.id || "",
      direction: row.direction || "unknown",
      type: row.message_type || "unknown",
      text: row.message_text || "",
      media: row.media_json && typeof row.media_json === "object" ? row.media_json : null,
      templateName: row.template_name || "",
      status: row.status ? formatDeliveryStatusLabel(row.status) : undefined,
      statusDetails: row.status_details ? String(row.status_details) : undefined,
      replyTo: row.reply_to || "",
      timestamp: new Date(row.message_timestamp).toISOString(),
    }));

  return {
    id: latestRow.conversation_id || conversationId,
    participant: latestRow.participant || latestRow.reply_to || latestRow.conversation_id || "Unknown",
    replyTo: latestRow.reply_to || "",
    unread: 0,
    totalMessages: messages.length,
    messages,
  };
}

async function getInboxSummaryFromDb(limit = 10, offset = 0, options = {}) {
  const recentFullLimit = Number.isFinite(options.recentFullLimit)
    ? Math.max(20, Math.min(MAX_MESSAGES_PER_CONVERSATION, Math.floor(options.recentFullLimit)))
    : 80;
  const includeRecentConversation = options.includeRecentConversation !== false;
  const query = String(options.query || "").trim();
  const digitsQuery = normalizeSearchDigits(query);

  ensureDbAvailable();

  const params = [];
  const whereClauses = [];

  if (query) {
    params.push(`%${query.toLowerCase()}%`);
    const textParam = `$${params.length}`;
    whereClauses.push(`(
      LOWER(COALESCE(participant, '')) LIKE ${textParam}
      OR LOWER(COALESCE(reply_to, '')) LIKE ${textParam}
      OR LOWER(COALESCE(conversation_id, '')) LIKE ${textParam}
    )`);

    if (digitsQuery) {
      params.push(`%${digitsQuery}%`);
      const digitsParam = `$${params.length}`;
      whereClauses.push(`(
        REGEXP_REPLACE(COALESCE(participant, ''), '\\D', '', 'g') LIKE ${digitsParam}
        OR REGEXP_REPLACE(COALESCE(reply_to, ''), '\\D', '', 'g') LIKE ${digitsParam}
        OR REGEXP_REPLACE(COALESCE(conversation_id, ''), '\\D', '', 'g') LIKE ${digitsParam}
      )`);
    }
  }

  const whereSql = whereClauses.length ? `WHERE ${whereClauses.join(" OR ")}` : "";

  params.push(limit);
  const limitParam = `$${params.length}`;
  params.push(offset);
  const offsetParam = `$${params.length}`;

  const result = await dbPool.query(
    `
      WITH ranked AS (
        SELECT
          conversation_id,
          participant,
          reply_to,
          direction,
          message_text,
          status,
          message_timestamp,
          ROW_NUMBER() OVER (PARTITION BY conversation_id ORDER BY message_timestamp DESC) AS rn
        FROM whatsapp_messages
        ${whereSql}
      ),
      latest AS (
        SELECT
          conversation_id,
          participant,
          reply_to,
          direction,
          message_text,
          status,
          message_timestamp
        FROM ranked
        WHERE rn = 1
      )
      SELECT
        conversation_id,
        participant,
        reply_to,
        direction,
        message_text,
        status,
        message_timestamp,
        COUNT(*) OVER()::int AS total_count
      FROM latest
      ORDER BY message_timestamp DESC
      LIMIT ${limitParam}
      OFFSET ${offsetParam}
    `,
    params,
  );

  const rows = Array.isArray(result.rows) ? result.rows : [];
  const total = rows[0]?.total_count ? Number(rows[0].total_count) : 0;
  const pageConversations = rows.map((row) => {
    const id = String(row.conversation_id || "");
    const memoryConversation = conversations.get(id);
    const unread = Number(memoryConversation?.unread || 0);

    return {
      id,
      participant: row.participant || row.reply_to || id || "Unknown",
      replyTo: row.reply_to || "",
      unread,
      lastTimestamp: new Date(row.message_timestamp).toISOString(),
      lastMessage: {
        direction: row.direction || "unknown",
        text: truncateText(row.message_text || "", 140),
        status: row.status ? formatDeliveryStatusLabel(row.status) : null,
        timestamp: new Date(row.message_timestamp).toISOString(),
      },
    };
  });

  const recentConversationId =
    includeRecentConversation && offset === 0 ? pageConversations[0]?.id || "" : "";
  const recentConversation = recentConversationId
    ? await getConversationPayloadById(recentConversationId, { limit: recentFullLimit })
    : null;

  return {
    total,
    conversations: pageConversations,
    recentConversation,
    hasMore: offset + limit < total,
    nextOffset: offset + limit < total ? offset + limit : null,
  };
}

function pushWebhookLog(entry) {
  webhookEventLog.push({
    timestamp: new Date().toISOString(),
    ...entry,
  });
  if (webhookEventLog.length > MAX_EVENT_LOGS) {
    webhookEventLog.splice(0, webhookEventLog.length - MAX_EVENT_LOGS);
  }
}

function workbookToContacts(buffer, options = {}) {
  const workbook = xlsx.read(buffer, { type: "buffer" });
  const sheetNames = Array.isArray(workbook.SheetNames) ? workbook.SheetNames : [];
  if (!sheetNames.length) {
    return {
      sheetName: "",
      sheetNames: [],
      selectedSheetIndex: 0,
      columns: [],
      rows: [],
    };
  }

  const requestedSheetName = String(options.sheetName || "").trim();
  const requestedSheetIndex = Number.isFinite(options.sheetIndex)
    ? Math.max(0, Math.min(sheetNames.length - 1, Math.floor(options.sheetIndex)))
    : 0;
  const selectedSheetIndex = requestedSheetName
    ? Math.max(0, sheetNames.findIndex((name) => String(name).toLowerCase() === requestedSheetName.toLowerCase()))
    : requestedSheetIndex;
  const sheetName = sheetNames[selectedSheetIndex] || sheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const rows = xlsx.utils.sheet_to_json(worksheet, { defval: "" });
  const columns = rows.length ? Object.keys(rows[0]) : [];
  const requestedLimit = Number(options.rowLimit);
  const rowLimit =
    Number.isFinite(requestedLimit) && requestedLimit > 0
      ? Math.min(Math.floor(requestedLimit), SMTP_BULK_MAX_ROWS)
      : DEFAULT_CONTACT_ROWS_LIMIT;

  return {
    sheetName,
    sheetNames,
    selectedSheetIndex,
    columns,
    rows: rows.slice(0, rowLimit),
  };
}

function escapeHtmlForEmail(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;");
}

function interpolateTemplate(template, rowData = {}) {
  return String(template || "").replace(/{{\s*([^{}]+?)\s*}}/g, (_, rawKey) => {
    const key = String(rawKey || "").trim();
    if (!key) {
      return "";
    }
    return String(rowData[key] ?? "").trim();
  });
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function getUnsubscribeTokenSecret() {
  const secret = UNSUBSCRIBE_TOKEN_SECRET || DEFAULT_UNSUBSCRIBE_TOKEN_SECRET;
  if (!UNSUBSCRIBE_TOKEN_SECRET && !unsubscribeSecretWarningLogged) {
    unsubscribeSecretWarningLogged = true;
    console.warn(
      "UNSUBSCRIBE_TOKEN_SECRET not set. Using fallback secret for unsubscribe links. Configure env secret for production.",
    );
  }
  return secret;
}

function getEmailTrackingTokenSecret() {
  const secret = EMAIL_TRACKING_TOKEN_SECRET || DEFAULT_EMAIL_TRACKING_TOKEN_SECRET;
  if (!EMAIL_TRACKING_TOKEN_SECRET && !emailTrackingSecretWarningLogged) {
    emailTrackingSecretWarningLogged = true;
    console.warn(
      "EMAIL_TRACKING_TOKEN_SECRET not set. Using fallback secret for email tracking links. Configure env secret for production.",
    );
  }
  return secret;
}

function toBase64Url(value) {
  return Buffer.from(String(value || ""), "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function fromBase64Url(value) {
  const base = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = `${base}${"=".repeat((4 - (base.length % 4 || 4)) % 4)}`;
  return Buffer.from(padded, "base64").toString("utf8");
}

function hashUnsubscribeToken(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

function hashTrackingValue(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function buildUnsubscribeToken(email, options = {}) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    return "";
  }

  const payload = {
    email: normalizedEmail,
    campaignId: String(options.campaignId || "").trim(),
    iat: Date.now(),
  };
  const payloadEncoded = toBase64Url(JSON.stringify(payload));
  const signature = crypto
    .createHmac("sha256", getUnsubscribeTokenSecret())
    .update(payloadEncoded)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

  return `${payloadEncoded}.${signature}`;
}

function parseUnsubscribeToken(token) {
  const rawToken = String(token || "").trim();
  const parts = rawToken.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error("Invalid unsubscribe token format.");
  }

  const payloadEncoded = parts[0];
  const signature = parts[1];
  const expectedSignature = crypto
    .createHmac("sha256", getUnsubscribeTokenSecret())
    .update(payloadEncoded)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

  const providedBuffer = Buffer.from(signature, "utf8");
  const expectedBuffer = Buffer.from(expectedSignature, "utf8");
  if (providedBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(providedBuffer, expectedBuffer)) {
    throw new Error("Invalid unsubscribe token signature.");
  }

  let payload;
  try {
    payload = JSON.parse(fromBase64Url(payloadEncoded));
  } catch {
    throw new Error("Invalid unsubscribe token payload.");
  }

  const email = normalizeEmail(payload?.email);
  if (!isValidEmail(email)) {
    throw new Error("Token email is invalid.");
  }

  return {
    email,
    campaignId: String(payload?.campaignId || "").trim(),
    iat: Number(payload?.iat || 0),
    tokenHash: hashUnsubscribeToken(rawToken),
  };
}

function buildEmailTrackingToken(payload = {}) {
  const eventType = String(payload.eventType || "").trim().toLowerCase();
  const campaignId = String(payload.campaignId || "").trim();
  const recipient = normalizeEmail(payload.recipient || "");

  if (!["open", "click"].includes(eventType) || !campaignId || !isValidEmail(recipient)) {
    return "";
  }

  const rowIndex = Number.isFinite(Number(payload.rowIndex)) ? Number(payload.rowIndex) : null;
  const tokenPayload = {
    eventType,
    campaignId,
    recipient,
    rowIndex,
    urlHash: String(payload.urlHash || "").trim().toLowerCase(),
    iat: Date.now(),
  };

  const payloadEncoded = toBase64Url(JSON.stringify(tokenPayload));
  const signature = crypto
    .createHmac("sha256", getEmailTrackingTokenSecret())
    .update(payloadEncoded)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

  return `${payloadEncoded}.${signature}`;
}

function parseEmailTrackingToken(token, expectedEventType = "") {
  const rawToken = String(token || "").trim();
  const parts = rawToken.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error("Invalid tracking token format.");
  }

  const payloadEncoded = parts[0];
  const signature = parts[1];
  const expectedSignature = crypto
    .createHmac("sha256", getEmailTrackingTokenSecret())
    .update(payloadEncoded)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

  const providedBuffer = Buffer.from(signature, "utf8");
  const expectedBuffer = Buffer.from(expectedSignature, "utf8");
  if (providedBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(providedBuffer, expectedBuffer)) {
    throw new Error("Invalid tracking token signature.");
  }

  let payload;
  try {
    payload = JSON.parse(fromBase64Url(payloadEncoded));
  } catch {
    throw new Error("Invalid tracking token payload.");
  }

  const eventType = String(payload?.eventType || "").trim().toLowerCase();
  if (!["open", "click"].includes(eventType)) {
    throw new Error("Unsupported tracking event.");
  }

  if (expectedEventType && eventType !== String(expectedEventType).trim().toLowerCase()) {
    throw new Error("Tracking event type mismatch.");
  }

  const campaignId = String(payload?.campaignId || "").trim();
  const recipient = normalizeEmail(payload?.recipient || "");
  if (!campaignId || !isValidEmail(recipient)) {
    throw new Error("Tracking token campaign/recipient invalid.");
  }

  return {
    eventType,
    campaignId,
    recipient,
    rowIndex: Number.isFinite(Number(payload?.rowIndex)) ? Number(payload.rowIndex) : null,
    urlHash: String(payload?.urlHash || "").trim().toLowerCase(),
    iat: Number(payload?.iat || 0),
    tokenHash: hashUnsubscribeToken(rawToken),
  };
}

function decodeHtmlAttributeValue(value) {
  return String(value || "")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function escapeHtmlAttributeValue(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function normalizeTrackableTargetUrl(value) {
  const raw = decodeHtmlAttributeValue(value).trim();
  if (!raw) {
    return "";
  }

  const lowered = raw.toLowerCase();
  if (
    lowered.startsWith("mailto:") ||
    lowered.startsWith("tel:") ||
    lowered.startsWith("javascript:") ||
    lowered.startsWith("#")
  ) {
    return "";
  }

  if (raw.includes("{{") && raw.includes("}}")) {
    return "";
  }

  try {
    const parsed = new URL(raw);
    if (!["http:", "https:"].includes(String(parsed.protocol || "").toLowerCase())) {
      return "";
    }
    return parsed.toString();
  } catch {
    return "";
  }
}

function buildEmailOpenTrackingUrl(options = {}) {
  const campaignId = String(options.campaignId || "").trim();
  const recipient = normalizeEmail(options.recipient || "");
  const rowIndex = Number.isFinite(Number(options.rowIndex)) ? Number(options.rowIndex) : null;

  if (!campaignId || !isValidEmail(recipient)) {
    return "";
  }

  const token = buildEmailTrackingToken({
    eventType: "open",
    campaignId,
    recipient,
    rowIndex,
  });
  if (!token) {
    return "";
  }

  const baseUrl = String(options.baseUrl || "").trim().replace(/\/+$/, "") || getAppBaseUrl();
  return `${baseUrl}${EMAIL_TRACKING_OPEN_ROUTE_PATH}?token=${encodeURIComponent(token)}`;
}

function buildEmailClickTrackingUrl(targetUrl, options = {}) {
  const campaignId = String(options.campaignId || "").trim();
  const recipient = normalizeEmail(options.recipient || "");
  const rowIndex = Number.isFinite(Number(options.rowIndex)) ? Number(options.rowIndex) : null;
  const normalizedTarget = normalizeTrackableTargetUrl(targetUrl);

  if (!campaignId || !isValidEmail(recipient) || !normalizedTarget) {
    return "";
  }

  const urlHash = hashTrackingValue(normalizedTarget);
  const token = buildEmailTrackingToken({
    eventType: "click",
    campaignId,
    recipient,
    rowIndex,
    urlHash,
  });
  if (!token) {
    return "";
  }

  const baseUrl = String(options.baseUrl || "").trim().replace(/\/+$/, "") || getAppBaseUrl();
  return `${baseUrl}${EMAIL_TRACKING_CLICK_ROUTE_PATH}?token=${encodeURIComponent(token)}&url=${encodeURIComponent(
    normalizedTarget,
  )}`;
}

function shouldTrackEmailHref(hrefValue) {
  const targetUrl = normalizeTrackableTargetUrl(hrefValue);
  if (!targetUrl) {
    return false;
  }

  const lowered = targetUrl.toLowerCase();
  if (lowered.includes(EMAIL_TRACKING_OPEN_ROUTE_PATH) || lowered.includes(EMAIL_TRACKING_CLICK_ROUTE_PATH)) {
    return false;
  }

  if (lowered.includes(UNSUBSCRIBE_ROUTE_PATH)) {
    return false;
  }

  return true;
}

function rewriteHtmlLinksWithTracking(htmlBody, options = {}) {
  const source = String(htmlBody || "");
  if (!source) {
    return source;
  }

  return source.replace(/<a\b([^>]*?)\bhref=(['"])(.*?)\2([^>]*)>/gi, (fullMatch, before, quote, hrefValue, after) => {
    if (!shouldTrackEmailHref(hrefValue)) {
      return fullMatch;
    }

    const trackingUrl = buildEmailClickTrackingUrl(hrefValue, options);
    if (!trackingUrl) {
      return fullMatch;
    }

    return `<a${before}href=${quote}${escapeHtmlAttributeValue(trackingUrl)}${quote}${after}>`;
  });
}

function appendOpenPixelToHtml(htmlBody, openTrackingUrl) {
  const source = String(htmlBody || "");
  const pixelUrl = String(openTrackingUrl || "").trim();
  if (!source || !pixelUrl) {
    return source;
  }

  if (source.includes(EMAIL_TRACKING_OPEN_ROUTE_PATH)) {
    return source;
  }

  const pixelTag = `<img src="${escapeHtmlAttributeValue(pixelUrl)}" alt="" width="1" height="1" style="display:none !important;width:1px !important;height:1px !important;opacity:0 !important;border:0 !important;" />`;
  if (/<\/body>/i.test(source)) {
    return source.replace(/<\/body>/i, `${pixelTag}</body>`);
  }

  return `${source}${pixelTag}`;
}

function applyEmailEngagementTracking(emailBodies, options = {}) {
  const html = String(emailBodies?.html || "");
  if (!html) {
    return {
      ...(emailBodies || {}),
    };
  }

  const campaignId = String(options.campaignId || "").trim();
  const recipient = normalizeEmail(options.recipient || "");
  const rowIndex = Number.isFinite(Number(options.rowIndex)) ? Number(options.rowIndex) : null;
  if (!campaignId || !isValidEmail(recipient)) {
    return {
      ...(emailBodies || {}),
    };
  }

  const trackingOptions = {
    campaignId,
    recipient,
    rowIndex,
    baseUrl: String(options.baseUrl || "").trim(),
  };
  const openTrackingUrl = buildEmailOpenTrackingUrl(trackingOptions);
  if (!openTrackingUrl) {
    return {
      ...(emailBodies || {}),
    };
  }

  const linksTrackedHtml = rewriteHtmlLinksWithTracking(html, trackingOptions);
  const trackedHtml = appendOpenPixelToHtml(linksTrackedHtml, openTrackingUrl);
  return {
    ...(emailBodies || {}),
    html: trackedHtml,
  };
}

function getRequestIpAddress(req) {
  const forwarded = String(req?.headers?.["x-forwarded-for"] || "").trim();
  if (forwarded) {
    return String(forwarded.split(",")[0] || "").trim();
  }
  return String(req?.socket?.remoteAddress || "").trim();
}

async function logEmailEngagementEvent(entry = {}) {
  if (!dbPool) {
    return;
  }

  const eventType = String(entry.eventType || "").trim().toLowerCase();
  if (!["open", "click"].includes(eventType)) {
    return;
  }

  const campaignId = String(entry.campaignId || "").trim() || null;
  const recipient = normalizeEmail(entry.recipient || "") || null;
  const targetUrl =
    eventType === "click" ? normalizeTrackableTargetUrl(entry.targetUrl || "") || String(entry.targetUrl || "") : null;

  try {
    await dbPool.query(
      `
        INSERT INTO email_engagement_events (
          campaign_id,
          recipient,
          event_type,
          target_url,
          row_index,
          provider_message_id,
          token_hash,
          user_agent,
          referer,
          ip_address,
          created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
      `,
      [
        campaignId,
        recipient,
        eventType,
        targetUrl,
        Number.isFinite(Number(entry.rowIndex)) ? Number(entry.rowIndex) : null,
        String(entry.providerMessageId || "").trim() || null,
        String(entry.tokenHash || "").trim() || null,
        String(entry.userAgent || "").slice(0, 1000) || null,
        String(entry.referer || "").slice(0, 1000) || null,
        String(entry.ipAddress || "").slice(0, 128) || null,
      ],
    );
  } catch (error) {
    console.error("Failed to save email engagement event.", error.message || error);
  }
}

function toPercent(numerator, denominator) {
  const a = Number(numerator || 0);
  const b = Number(denominator || 0);
  if (!b || !Number.isFinite(a) || !Number.isFinite(b)) {
    return 0;
  }
  return Number(((a / b) * 100).toFixed(2));
}

async function getEmailAnalyticsPayload(options = {}) {
  ensureDbAvailable();

  const campaignId = String(options.campaignId || "").trim();
  const range = String(options.range || "").trim().toLowerCase();
  const days = Number.isFinite(Number(options.days))
    ? Math.max(1, Math.min(90, Math.floor(Number(options.days))))
    : 14;
  const recipientLimit = Number.isFinite(Number(options.recipientLimit))
    ? Math.max(1, Math.min(500, Math.floor(Number(options.recipientLimit))))
    : 100;
  const topLinksLimit = Number.isFinite(Number(options.topLinksLimit))
    ? Math.max(1, Math.min(100, Math.floor(Number(options.topLinksLimit))))
    : 10;
  const detailLimit = Number.isFinite(Number(options.detailLimit))
    ? Math.max(1, Math.min(5000, Math.floor(Number(options.detailLimit))))
    : 10;
  const detailOffset = Number.isFinite(Number(options.detailOffset))
    ? Math.max(0, Math.floor(Number(options.detailOffset)))
    : 0;
  const includeEmptyTimeline = parseTruthyValue(options.includeEmptyTimeline, false);

  const campaignParams = [CAMPAIGN_CHANNEL_EMAIL];
  let campaignWhere = `channel = $1`;
  if (campaignId) {
    campaignParams.push(campaignId);
    campaignWhere += ` AND id = $${campaignParams.length}`;
  }

  const campaignTotalsResult = await dbPool.query(
    `
      SELECT
        COALESCE(SUM(total), 0)::int AS audience,
        COALESCE(SUM(processed), 0)::int AS processed,
        COALESCE(SUM(sent), 0)::int AS sent,
        COALESCE(SUM(failed), 0)::int AS failed
      FROM campaigns
      WHERE ${campaignWhere}
    `,
    campaignParams,
  );
  const campaignTotals = campaignTotalsResult.rows?.[0] || {};

  const eventsParams = [];
  const eventsWhere = [];
  if (campaignId) {
    eventsParams.push(campaignId);
    eventsWhere.push(`campaign_id = $${eventsParams.length}`);
  }
  const eventsWhereSql = eventsWhere.length ? `WHERE ${eventsWhere.join(" AND ")}` : "";

  const eventsSummaryResult = await dbPool.query(
    `
      SELECT
        COALESCE(COUNT(*) FILTER (WHERE event_type = 'open'), 0)::int AS opens,
        COALESCE(COUNT(*) FILTER (WHERE event_type = 'click'), 0)::int AS clicks,
        COALESCE(COUNT(DISTINCT CASE WHEN event_type = 'open' THEN recipient END), 0)::int AS unique_opens,
        COALESCE(COUNT(DISTINCT CASE WHEN event_type = 'click' THEN recipient END), 0)::int AS unique_clicks,
        COALESCE(COUNT(DISTINCT CASE WHEN COALESCE(recipient, '') <> '' THEN recipient END), 0)::int AS engaged_recipients
      FROM email_engagement_events
      ${eventsWhereSql}
    `,
    eventsParams,
  );
  const eventsSummary = eventsSummaryResult.rows?.[0] || {};

  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);

  let resolvedRange = range;
  let timelineGranularity = "day";
  let timelineStart = new Date(now.getTime() - (days - 1) * 24 * 60 * 60 * 1000);
  timelineStart.setHours(0, 0, 0, 0);
  let timelineEndExclusive = new Date(now);

  if (resolvedRange === "today") {
    timelineGranularity = "hour";
    timelineStart = new Date(startOfToday);
    timelineEndExclusive = new Date(now);
  } else if (resolvedRange === "yesterday") {
    timelineGranularity = "hour";
    timelineEndExclusive = new Date(startOfToday);
    timelineStart = new Date(startOfToday);
    timelineStart.setDate(timelineStart.getDate() - 1);
  } else {
    const rangeMatch = resolvedRange.match(/^(\d{1,2})d$/i);
    if (rangeMatch) {
      const rangeDays = Math.max(1, Math.min(90, Number(rangeMatch[1])));
      timelineStart = new Date(now);
      timelineStart.setHours(0, 0, 0, 0);
      timelineStart.setDate(timelineStart.getDate() - (rangeDays - 1));
    } else {
      resolvedRange = `${days}d`;
      timelineStart = new Date(now);
      timelineStart.setHours(0, 0, 0, 0);
      timelineStart.setDate(timelineStart.getDate() - (days - 1));
    }
  }

  const timelineBucketSql = timelineGranularity === "hour" ? "DATE_TRUNC('hour', created_at)" : "DATE_TRUNC('day', created_at)";
  const timelineParams = [timelineStart.toISOString(), timelineEndExclusive.toISOString()];
  const timelineWhere = [`created_at >= $1`, `created_at < $2`];
  if (campaignId) {
    timelineParams.push(campaignId);
    timelineWhere.push(`campaign_id = $${timelineParams.length}`);
  }

  const timelineResult = await dbPool.query(
    `
      SELECT
        ${timelineBucketSql} AS bucket,
        COALESCE(COUNT(*) FILTER (WHERE event_type = 'open'), 0)::int AS opens,
        COALESCE(COUNT(*) FILTER (WHERE event_type = 'click'), 0)::int AS clicks
      FROM email_engagement_events
      WHERE ${timelineWhere.join(" AND ")}
      GROUP BY ${timelineBucketSql}
      ORDER BY bucket ASC
    `,
    timelineParams,
  );

  const timelineRows = (timelineResult.rows || []).map((row) => {
    const bucketDate = new Date(row.bucket);
    const dayKey = bucketDate.toISOString().slice(0, 10);
    const hourLabel = `${String(bucketDate.getHours()).padStart(2, "0")}:00`;
    return {
      bucket: bucketDate.toISOString(),
      bucketKey:
        timelineGranularity === "hour"
          ? Math.floor(bucketDate.getTime() / (60 * 60 * 1000))
          : Math.floor(bucketDate.getTime() / (24 * 60 * 60 * 1000)),
      day: dayKey,
      label: timelineGranularity === "hour" ? hourLabel : dayKey.slice(5),
      opens: Number(row.opens || 0),
      clicks: Number(row.clicks || 0),
    };
  });

  const timeline = [];
  if (includeEmptyTimeline) {
    const bucketSizeMs = timelineGranularity === "hour" ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
    const timelineMap = new Map(
      timelineRows.map((row) => [row.bucketKey, { opens: row.opens, clicks: row.clicks }]),
    );
    const cursor = new Date(timelineStart);
    while (cursor < timelineEndExclusive) {
      const bucketDate = new Date(cursor);
      const bucket = bucketDate.toISOString();
      const bucketKey = Math.floor(bucketDate.getTime() / bucketSizeMs);
      const existing = timelineMap.get(bucketKey);
      const dayKey = bucketDate.toISOString().slice(0, 10);
      const label = timelineGranularity === "hour"
        ? `${String(bucketDate.getHours()).padStart(2, "0")}:00`
        : dayKey.slice(5);

      if (existing) {
        timeline.push({
          bucket,
          day: dayKey,
          label,
          opens: Number(existing.opens || 0),
          clicks: Number(existing.clicks || 0),
        });
      } else {
        timeline.push({
          bucket,
          day: dayKey,
          label,
          opens: 0,
          clicks: 0,
        });
      }

      if (timelineGranularity === "hour") {
        cursor.setHours(cursor.getHours() + 1, 0, 0, 0);
      } else {
        cursor.setDate(cursor.getDate() + 1);
        cursor.setHours(0, 0, 0, 0);
      }
    }
  } else {
    timeline.push(...timelineRows);
  }

  const topLinksParams = [];
  const topLinksWhere = [`event_type = 'click'`, `COALESCE(target_url, '') <> ''`];
  if (campaignId) {
    topLinksParams.push(campaignId);
    topLinksWhere.push(`campaign_id = $${topLinksParams.length}`);
  }
  topLinksParams.push(topLinksLimit);
  const topLinksResult = await dbPool.query(
    `
      SELECT
        target_url,
        COUNT(*)::int AS clicks,
        COUNT(DISTINCT recipient)::int AS unique_clicks
      FROM email_engagement_events
      WHERE ${topLinksWhere.join(" AND ")}
      GROUP BY target_url
      ORDER BY clicks DESC, unique_clicks DESC
      LIMIT $${topLinksParams.length}
    `,
    topLinksParams,
  );

  const detailWhere = [];
  const detailParams = [];
  if (campaignId) {
    detailParams.push(campaignId);
    detailWhere.push(`campaign_id = $${detailParams.length}`);
  }
  const detailWhereSql = detailWhere.length ? `WHERE ${detailWhere.join(" AND ")}` : "";

  const detailCountResult = await dbPool.query(
    `
      SELECT COUNT(*)::int AS total_records
      FROM email_engagement_events
      ${detailWhereSql}
    `,
    detailParams,
  );

  const detailRowsParams = [...detailParams, detailLimit, detailOffset];
  const detailRowsResult = await dbPool.query(
    `
      WITH filtered AS (
        SELECT
          id,
          campaign_id,
          recipient,
          event_type,
          target_url,
          created_at,
          COUNT(*) OVER (
            PARTITION BY LOWER(COALESCE(recipient, '')), event_type, COALESCE(target_url, '')
          )::int AS total_count_for_signature,
          ROW_NUMBER() OVER (
            PARTITION BY LOWER(COALESCE(recipient, '')), event_type, COALESCE(target_url, '')
            ORDER BY created_at ASC, id ASC
          )::int AS occurrence_count
        FROM email_engagement_events
        ${detailWhereSql}
      )
      SELECT
        id,
        campaign_id,
        recipient,
        event_type,
        target_url,
        created_at,
        total_count_for_signature,
        occurrence_count
      FROM filtered
      ORDER BY created_at DESC, id DESC
      LIMIT $${detailParams.length + 1}
      OFFSET $${detailParams.length + 2}
    `,
    detailRowsParams,
  );

  const statusParams = [CAMPAIGN_CHANNEL_EMAIL];
  let statusWhere = `c.channel = $1`;
  if (campaignId) {
    statusParams.push(campaignId);
    statusWhere += ` AND c.id = $${statusParams.length}`;
  }
  const recipientStatusResult = await dbPool.query(
    `
      SELECT
        LOWER(COALESCE(cr.recipient, '')) AS recipient_key,
        MIN(COALESCE(cr.recipient, '')) AS recipient,
        COALESCE(COUNT(*) FILTER (WHERE cr.status = 'sent'), 0)::int AS sent_count,
        COALESCE(COUNT(*) FILTER (WHERE cr.status = 'failed'), 0)::int AS failed_count
      FROM campaign_recipients cr
      INNER JOIN campaigns c ON c.id = cr.campaign_id
      WHERE ${statusWhere}
      GROUP BY LOWER(COALESCE(cr.recipient, ''))
    `,
    statusParams,
  );

  const recipientEventsParams = [];
  const recipientEventsWhere = [`COALESCE(recipient, '') <> ''`];
  if (campaignId) {
    recipientEventsParams.push(campaignId);
    recipientEventsWhere.push(`campaign_id = $${recipientEventsParams.length}`);
  }
  const recipientEventsResult = await dbPool.query(
    `
      SELECT
        LOWER(COALESCE(recipient, '')) AS recipient_key,
        MIN(COALESCE(recipient, '')) AS recipient,
        COALESCE(COUNT(*) FILTER (WHERE event_type = 'open'), 0)::int AS opens,
        COALESCE(COUNT(*) FILTER (WHERE event_type = 'click'), 0)::int AS clicks,
        MAX(created_at) AS last_event_at
      FROM email_engagement_events
      WHERE ${recipientEventsWhere.join(" AND ")}
      GROUP BY LOWER(COALESCE(recipient, ''))
    `,
    recipientEventsParams,
  );

  const recipientMap = new Map();
  for (const row of recipientStatusResult.rows || []) {
    const key = String(row.recipient_key || "").trim();
    if (!key) {
      continue;
    }
    recipientMap.set(key, {
      recipient: String(row.recipient || key),
      sent: Number(row.sent_count || 0),
      failed: Number(row.failed_count || 0),
      opens: 0,
      clicks: 0,
      lastEventAt: "",
    });
  }

  for (const row of recipientEventsResult.rows || []) {
    const key = String(row.recipient_key || "").trim();
    if (!key) {
      continue;
    }
    const existing = recipientMap.get(key) || {
      recipient: String(row.recipient || key),
      sent: 0,
      failed: 0,
      opens: 0,
      clicks: 0,
      lastEventAt: "",
    };
    existing.opens = Number(row.opens || 0);
    existing.clicks = Number(row.clicks || 0);
    existing.lastEventAt = row.last_event_at ? new Date(row.last_event_at).toISOString() : existing.lastEventAt;
    recipientMap.set(key, existing);
  }

  const recipients = Array.from(recipientMap.values())
    .map((item) => ({
      ...item,
      openRate: toPercent(item.opens, item.sent),
      clickRate: toPercent(item.clicks, item.sent),
    }))
    .sort((a, b) => {
      if (b.clicks !== a.clicks) {
        return b.clicks - a.clicks;
      }
      if (b.opens !== a.opens) {
        return b.opens - a.opens;
      }
      return b.sent - a.sent;
    })
    .slice(0, recipientLimit);

  const sent = Number(campaignTotals.sent || 0);
  const processed = Number(campaignTotals.processed || 0);
  const failed = Number(campaignTotals.failed || 0);
  const audience = Number(campaignTotals.audience || 0);
  const opens = Number(eventsSummary.opens || 0);
  const clicks = Number(eventsSummary.clicks || 0);
  const uniqueOpens = Number(eventsSummary.unique_opens || 0);
  const uniqueClicks = Number(eventsSummary.unique_clicks || 0);
  const engagedRecipients = Number(eventsSummary.engaged_recipients || 0);
  const effectiveRateBase = sent > 0
    ? sent
    : Math.max(engagedRecipients, uniqueOpens, uniqueClicks, processed, audience);
  const detailTotalRecords = Number(detailCountResult.rows?.[0]?.total_records || 0);
  const detailRecords = (detailRowsResult.rows || []).map((row) => ({
    id: Number(row.id || 0),
    campaignId: String(row.campaign_id || ""),
    recipient: String(row.recipient || ""),
    eventType: String(row.event_type || "").toLowerCase(),
    targetUrl: String(row.target_url || ""),
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : "",
    occurrenceCount: Number(row.occurrence_count || 0),
    totalCountForSignature: Number(row.total_count_for_signature || 0),
  }));

  return {
    campaignId,
    days,
    range: resolvedRange,
    timelineGranularity,
    timelineStart: timelineStart.toISOString(),
    timelineEnd: timelineEndExclusive.toISOString(),
    summary: {
      audience,
      processed,
      sent,
      failed,
      opens,
      clicks,
      uniqueOpens,
      uniqueClicks,
      openRate: toPercent(uniqueOpens, effectiveRateBase),
      clickRate: toPercent(uniqueClicks, effectiveRateBase),
      ctor: toPercent(uniqueClicks, uniqueOpens),
    },
    timeline,
    topLinks: (topLinksResult.rows || []).map((row) => ({
      url: String(row.target_url || ""),
      clicks: Number(row.clicks || 0),
      uniqueClicks: Number(row.unique_clicks || 0),
    })),
    recipients,
    details: {
      campaignId,
      limit: detailLimit,
      offset: detailOffset,
      fetchedCount: detailRecords.length,
      totalRecords: detailTotalRecords,
      hasMore: detailOffset + detailRecords.length < detailTotalRecords,
      records: detailRecords,
    },
    generatedAt: new Date().toISOString(),
  };
}

function getAppBaseUrl(req = null) {
  if (req) {
    const fromRequest = getPublicBaseUrl(req);
    if (fromRequest) {
      return fromRequest.replace(/\/+$/, "");
    }
  }

  const envBase = String(process.env.PUBLIC_BASE_URL || "").trim().replace(/\/+$/, "");
  if (envBase) {
    return envBase;
  }

  return `http://localhost:${PORT}`;
}

function buildUnsubscribeUrl(email, options = {}) {
  const normalizedEmail = normalizeEmail(email);
  if (!isValidEmail(normalizedEmail)) {
    return "";
  }

  const token = buildUnsubscribeToken(normalizedEmail, {
    campaignId: String(options.campaignId || "").trim(),
  });
  if (!token) {
    return "";
  }

  const baseUrl = String(options.baseUrl || "").trim().replace(/\/+$/, "") || getAppBaseUrl();
  return `${baseUrl}${UNSUBSCRIBE_ROUTE_PATH}?token=${encodeURIComponent(token)}`;
}

function buildEmailTemplateContext(rowData = {}, options = {}) {
  const mergedRow = sanitizeRowObject(rowData);
  const recipient = normalizeEmail(options.recipient || mergedRow.recipientEmail || mergedRow.email || "");
  const unsubscribeUrl = buildUnsubscribeUrl(recipient, {
    campaignId: String(options.campaignId || "").trim(),
    baseUrl: String(options.baseUrl || "").trim(),
  });

  return {
    ...mergedRow,
    recipientEmail: recipient || String(mergedRow.recipientEmail || "").trim(),
    unsubscribe_url: unsubscribeUrl,
    unsubscribeUrl,
  };
}

function buildListUnsubscribeHeaders(recipient, options = {}) {
  const unsubscribeUrl = buildUnsubscribeUrl(recipient, options);
  if (!unsubscribeUrl) {
    return {};
  }

  return {
    "List-Unsubscribe": `<${unsubscribeUrl}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}

function isEmailUnsubscribed(email) {
  const normalized = normalizeEmail(email);
  return Boolean(normalized && unsubscribedEmailRecipients.has(normalized));
}

async function markRecipientUnsubscribed(email, options = {}) {
  const recipient = normalizeEmail(email);
  if (!isValidEmail(recipient)) {
    throw new Error("Valid email is required to unsubscribe.");
  }

  unsubscribedEmailRecipients.add(recipient);

  await dbPool.query(
    `
      INSERT INTO email_unsubscribes (
        email, source, campaign_id, token_hash, updated_at
      )
      VALUES ($1, $2, $3, $4, NOW())
      ON CONFLICT (email)
      DO UPDATE SET
        source = EXCLUDED.source,
        campaign_id = COALESCE(EXCLUDED.campaign_id, email_unsubscribes.campaign_id),
        token_hash = COALESCE(EXCLUDED.token_hash, email_unsubscribes.token_hash),
        updated_at = NOW()
    `,
    [
      recipient,
      String(options.source || "footer_link").trim() || "footer_link",
      String(options.campaignId || "").trim() || null,
      String(options.tokenHash || "").trim() || null,
    ],
  );
}

function normalizeSmtpProvider(value) {
  const provider = String(value || "").trim().toLowerCase();
  if (provider === "ses") {
    return "ses";
  }
  if (provider === "gmail") {
    return "gmail";
  }
  return "";
}

function getActiveSmtpProviderOptions() {
  return Array.from(smtpRuntimeProfiles.keys())
    .map((provider) => normalizeSmtpProvider(provider))
    .filter(Boolean);
}

function getPrimarySmtpProvider() {
  const providerOptions = getActiveSmtpProviderOptions();

  if (!providerOptions.length) {
    runtimeSmtpDefaultProvider = "";
    return "";
  }

  if (runtimeSmtpDefaultProvider && providerOptions.includes(runtimeSmtpDefaultProvider)) {
    return runtimeSmtpDefaultProvider;
  }

  runtimeSmtpDefaultProvider = providerOptions[0] || "";
  return runtimeSmtpDefaultProvider;
}

function setPrimarySmtpProvider(providerInput) {
  const provider = normalizeSmtpProvider(providerInput);
  const options = getActiveSmtpProviderOptions();
  if (!options.length) {
    throw buildHttpError(400, "No active SMTP profile found. Activate a credential first.");
  }
  if (!provider || !options.includes(provider)) {
    throw buildHttpError(400, `SMTP provider must be one of: ${options.join(", ")}.`);
  }

  const smtpConfig = getSmtpConfig(provider);
  if (!smtpConfig.host || !smtpConfig.port) {
    throw buildHttpError(400, `SMTP is not configured for ${provider}.`);
  }

  runtimeSmtpDefaultProvider = provider;
  return runtimeSmtpDefaultProvider;
}

function buildHttpError(statusCode, message) {
  const error = new Error(String(message || "Request failed."));
  error.statusCode = statusCode;
  return error;
}

function parseTruthyValue(value, fallback = false) {
  if (value === undefined || value === null || value === "") {
    return Boolean(fallback);
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

let smtpCredentialCipherKeyCache = null;

function getSmtpCredentialCipherKey() {
  if (smtpCredentialCipherKeyCache) {
    return smtpCredentialCipherKeyCache;
  }

  const seed = String(
    process.env.SMTP_PROFILE_SECRET ||
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.COMMUNICATION_SERVICES_CONNECTION_STRING ||
      process.env.SUPABASE_DB_PASSWORD ||
      "local-dev-smtp-key",
  ).trim();

  smtpCredentialCipherKeyCache = crypto.createHash("sha256").update(seed).digest();
  return smtpCredentialCipherKeyCache;
}

function encryptSmtpCredentialSecret(value) {
  const plainText = String(value || "");
  if (!plainText) {
    return "";
  }

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getSmtpCredentialCipherKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
}

function decryptSmtpCredentialSecret(value) {
  const raw = String(value || "");
  if (!raw) {
    return "";
  }
  if (!raw.startsWith("v1:")) {
    return raw;
  }

  const parts = raw.split(":");
  if (parts.length !== 4) {
    throw new Error("Invalid SMTP credential secret format.");
  }

  const iv = Buffer.from(parts[1], "base64");
  const tag = Buffer.from(parts[2], "base64");
  const encrypted = Buffer.from(parts[3], "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", getSmtpCredentialCipherKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

function normalizeSmtpFromOptionsRaw(rawOptions, fallbackFrom) {
  const options = String(rawOptions || "")
    .split(",")
    .map((item) => String(item || "").trim().toLowerCase())
    .filter((item) => isValidEmail(item));
  const unique = Array.from(new Set(options));
  const normalizedFallback = String(fallbackFrom || "").trim().toLowerCase();
  if (isValidEmail(normalizedFallback) && !unique.includes(normalizedFallback)) {
    unique.unshift(normalizedFallback);
  }
  return unique.join(",");
}

function normalizeSmtpFromName(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 120);
}

function toSmtpCredentialPublic(row) {
  const fromOptions = String(row?.from_options || "")
    .split(",")
    .map((item) => String(item || "").trim().toLowerCase())
    .filter((item) => isValidEmail(item));

  return {
    id: String(row?.id || ""),
    provider: normalizeSmtpProvider(row?.provider),
    profileName: String(row?.profile_name || ""),
    host: String(row?.host || ""),
    port: Number(row?.port || 587),
    secure: Boolean(row?.secure),
    user: String(row?.user_name || ""),
    fromAddress: String(row?.from_address || "").toLowerCase(),
    fromName: normalizeSmtpFromName(row?.from_name || ""),
    replyToAddress: String(row?.reply_to_address || "").trim().toLowerCase(),
    fromOptions,
    isActive: Boolean(row?.is_active),
    createdAt: row?.created_at ? new Date(row.created_at).toISOString() : "",
    updatedAt: row?.updated_at ? new Date(row.updated_at).toISOString() : "",
  };
}

function buildRuntimeSmtpProfileFromCredentialRow(row) {
  const provider = normalizeSmtpProvider(row?.provider);
  const fromAddress = String(row?.from_address || "").trim().toLowerCase();
  const fromName = normalizeSmtpFromName(row?.from_name || "");
  const replyToAddress = String(row?.reply_to_address || "").trim().toLowerCase();
  const fromOptionsRaw = normalizeSmtpFromOptionsRaw(row?.from_options || "", fromAddress);
  return {
    provider,
    profileId: String(row?.id || ""),
    profileName: String(row?.profile_name || ""),
    host: String(row?.host || "").trim(),
    port: Number(row?.port || 587),
    secure: Boolean(row?.secure),
    user: String(row?.user_name || "").trim(),
    pass: decryptSmtpCredentialSecret(String(row?.pass_encrypted || "")),
    from: fromAddress,
    fromName,
    replyTo: isValidEmail(replyToAddress) ? replyToAddress : "",
    fromOptionsRaw,
  };
}

function setRuntimeSmtpProfile(provider, profile = null) {
  const normalizedProvider = normalizeSmtpProvider(provider);
  if (!profile) {
    smtpRuntimeProfiles.delete(normalizedProvider);
    emailQueueSmtpContexts.delete(normalizedProvider);
    return;
  }

  smtpRuntimeProfiles.set(normalizedProvider, profile);
  emailQueueSmtpContexts.delete(normalizedProvider);
}

async function loadActiveSmtpCredentialsFromDb() {
  ensureDbAvailable();

  smtpRuntimeProfiles.clear();
  emailQueueSmtpContexts.clear();

  const result = await dbPool.query(
    `
      SELECT *
      FROM smtp_credentials
      WHERE is_active = TRUE
      ORDER BY updated_at DESC
    `,
  );

  const rows = Array.isArray(result.rows) ? result.rows : [];
  for (const row of rows) {
    try {
      const profile = buildRuntimeSmtpProfileFromCredentialRow(row);
      setRuntimeSmtpProfile(profile.provider, profile);
    } catch (error) {
      console.error("Failed to load active SMTP profile.", error.message || error);
    }
  }
}

async function listSmtpCredentialProfiles() {
  ensureDbAvailable();
  const result = await dbPool.query(
    `
      SELECT
        id, provider, profile_name, host, port, secure, user_name,
        from_address, from_name, reply_to_address, from_options, is_active, created_at, updated_at
      FROM smtp_credentials
      ORDER BY provider ASC, is_active DESC, updated_at DESC
    `,
  );

  return (Array.isArray(result.rows) ? result.rows : []).map((row) => toSmtpCredentialPublic(row));
}

async function getSmtpCredentialProfileRowById(profileId) {
  ensureDbAvailable();
  const result = await dbPool.query(
    `
      SELECT *
      FROM smtp_credentials
      WHERE id = $1
      LIMIT 1
    `,
    [String(profileId || "")],
  );

  return result.rows?.[0] || null;
}

function normalizeSmtpCredentialPayload(payload = {}, options = {}) {
  const provider = normalizeSmtpProvider(payload.provider || options.provider || "");
  const allowedProviders = getSmtpProviderOptions();
  const profileName = String(payload.profileName || options.profileName || "").trim();
  const host = String(payload.host || options.host || "").trim();
  const port = Number(payload.port ?? options.port ?? 587);
  const secure = parseTruthyValue(payload.secure, payload.secure === undefined ? options.secure : false);
  const user = String(payload.user || options.user || "").trim();
  const pass = String(payload.pass || "").trim();
  const defaultFrom = String(options.fromAddress || user || "").trim().toLowerCase();
  const fromAddress = String(payload.fromAddress || options.fromAddress || user || "").trim().toLowerCase();
  const fromName = normalizeSmtpFromName(payload.fromName || options.fromName || "");
  const replyToAddress = String(payload.replyToAddress || options.replyToAddress || "").trim().toLowerCase();
  const fromOptionsRaw = normalizeSmtpFromOptionsRaw(
    payload.fromOptionsRaw ?? payload.fromOptions ?? options.fromOptionsRaw ?? "",
    fromAddress || defaultFrom,
  );
  const setActive = parseTruthyValue(payload.setActive, options.setActive);

  if (!profileName) {
    throw buildHttpError(400, "Profile name is required.");
  }
  if (!provider) {
    throw buildHttpError(400, "SMTP provider is required.");
  }
  if (!allowedProviders.includes(provider)) {
    throw buildHttpError(400, `SMTP provider must be one of: ${allowedProviders.join(", ")}.`);
  }
  if (!host) {
    throw buildHttpError(400, "SMTP host is required.");
  }
  if (!Number.isFinite(port) || port <= 0 || port > 65535) {
    throw buildHttpError(400, "SMTP port must be a valid number between 1 and 65535.");
  }
  if (!user) {
    throw buildHttpError(400, "SMTP username is required.");
  }
  if (options.requirePassword && !pass) {
    throw buildHttpError(400, "SMTP password is required.");
  }
  if (!isValidEmail(fromAddress)) {
    throw buildHttpError(400, "From address must be a valid email.");
  }
  if (replyToAddress && !isValidEmail(replyToAddress)) {
    throw buildHttpError(400, "Reply-To address must be a valid email.");
  }

  return {
    provider,
    profileName,
    host,
    port: Math.floor(port),
    secure,
    user,
    pass,
    fromAddress,
    fromName,
    replyToAddress,
    fromOptionsRaw,
    setActive,
  };
}

async function createSmtpCredentialProfile(payload = {}) {
  ensureDbAvailable();
  const input = normalizeSmtpCredentialPayload(payload, { requirePassword: true, setActive: true });
  const profileId = `smtp-${Date.now()}-${crypto.randomUUID()}`;
  const passEncrypted = encryptSmtpCredentialSecret(input.pass);
  const client = await dbPool.connect();

  try {
    await client.query("BEGIN");
    if (input.setActive) {
      await client.query(
        `
          UPDATE smtp_credentials
          SET is_active = FALSE,
              updated_at = NOW()
          WHERE provider = $1
            AND is_active = TRUE
        `,
        [input.provider],
      );
    }

    await client.query(
      `
        INSERT INTO smtp_credentials (
          id, provider, profile_name, host, port, secure, user_name,
          pass_encrypted, from_address, from_name, reply_to_address, from_options, is_active, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())
      `,
      [
        profileId,
        input.provider,
        input.profileName,
        input.host,
        input.port,
        input.secure,
        input.user,
        passEncrypted,
        input.fromAddress,
        input.fromName,
        input.replyToAddress || null,
        input.fromOptionsRaw,
        input.setActive,
      ],
    );

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  const createdRow = await getSmtpCredentialProfileRowById(profileId);
  if (createdRow?.is_active) {
    setRuntimeSmtpProfile(input.provider, buildRuntimeSmtpProfileFromCredentialRow(createdRow));
  }

  return toSmtpCredentialPublic(createdRow);
}

async function updateSmtpCredentialProfile(profileId, payload = {}) {
  ensureDbAvailable();
  const existing = await getSmtpCredentialProfileRowById(profileId);
  if (!existing) {
    throw buildHttpError(404, "SMTP credential profile not found.");
  }

  const existingProvider = normalizeSmtpProvider(existing.provider);
  const requestedProvider = payload.provider ? normalizeSmtpProvider(payload.provider) : existingProvider;
  if (requestedProvider !== existingProvider) {
    throw buildHttpError(400, "Provider change is not allowed for existing profile.");
  }

  const input = normalizeSmtpCredentialPayload(payload, {
    provider: existingProvider,
    profileName: existing.profile_name,
    host: existing.host,
    port: existing.port,
    secure: existing.secure,
    user: existing.user_name,
    fromAddress: existing.from_address,
    fromName: existing.from_name,
    replyToAddress: existing.reply_to_address,
    fromOptionsRaw: existing.from_options,
    setActive: existing.is_active,
    requirePassword: false,
  });

  const suppliedPass = String(payload.pass || "").trim();
  const passEncrypted = suppliedPass
    ? encryptSmtpCredentialSecret(suppliedPass)
    : String(existing.pass_encrypted || "").trim();

  const shouldActivate = parseTruthyValue(payload.setActive, Boolean(existing.is_active));
  const client = await dbPool.connect();

  try {
    await client.query("BEGIN");
    if (shouldActivate) {
      await client.query(
        `
          UPDATE smtp_credentials
          SET is_active = FALSE,
              updated_at = NOW()
          WHERE provider = $1
            AND is_active = TRUE
            AND id <> $2
        `,
        [existingProvider, String(profileId)],
      );
    }

    await client.query(
      `
        UPDATE smtp_credentials
        SET profile_name = $2,
            host = $3,
            port = $4,
            secure = $5,
            user_name = $6,
            pass_encrypted = $7,
            from_address = $8,
          from_name = $9,
          reply_to_address = $10,
          from_options = $11,
          is_active = $12,
            updated_at = NOW()
        WHERE id = $1
      `,
      [
        String(profileId),
        input.profileName,
        input.host,
        input.port,
        input.secure,
        input.user,
        passEncrypted,
        input.fromAddress,
        input.fromName,
        input.replyToAddress || null,
        input.fromOptionsRaw,
        shouldActivate,
      ],
    );

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  const updatedRow = await getSmtpCredentialProfileRowById(profileId);
  if (updatedRow?.is_active) {
    setRuntimeSmtpProfile(existingProvider, buildRuntimeSmtpProfileFromCredentialRow(updatedRow));
  } else if (existing.is_active) {
    setRuntimeSmtpProfile(existingProvider, null);
  }

  return toSmtpCredentialPublic(updatedRow);
}

async function deleteSmtpCredentialProfile(profileId) {
  ensureDbAvailable();
  const existing = await getSmtpCredentialProfileRowById(profileId);
  if (!existing) {
    throw buildHttpError(404, "SMTP credential profile not found.");
  }

  await dbPool.query(
    `
      DELETE FROM smtp_credentials
      WHERE id = $1
    `,
    [String(profileId)],
  );

  if (existing.is_active) {
    setRuntimeSmtpProfile(existing.provider, null);
  }

  return toSmtpCredentialPublic(existing);
}

async function activateSmtpCredentialProfile(profileId) {
  ensureDbAvailable();
  const existing = await getSmtpCredentialProfileRowById(profileId);
  if (!existing) {
    throw buildHttpError(404, "SMTP credential profile not found.");
  }

  const provider = normalizeSmtpProvider(existing.provider);
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `
        UPDATE smtp_credentials
        SET is_active = FALSE,
            updated_at = NOW()
        WHERE provider = $1
      `,
      [provider],
    );

    await client.query(
      `
        UPDATE smtp_credentials
        SET is_active = TRUE,
            updated_at = NOW()
        WHERE id = $1
      `,
      [String(profileId)],
    );

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  const activatedRow = await getSmtpCredentialProfileRowById(profileId);
  setRuntimeSmtpProfile(provider, buildRuntimeSmtpProfileFromCredentialRow(activatedRow));
  return toSmtpCredentialPublic(activatedRow);
}

function getSmtpProviderOptions() {
  return SMTP_PROVIDER_CATALOG.slice();
}

function resolveSmtpProvider(requestedProvider) {
  const providerOptions = getSmtpProviderOptions();
  const selectedProvider = requestedProvider
    ? normalizeSmtpProvider(requestedProvider)
    : getPrimarySmtpProvider();

  if (!selectedProvider) {
    throw new Error("No active SMTP provider configured. Add and activate SMTP credentials in Config Center.");
  }
  if (!providerOptions.includes(selectedProvider)) {
    throw new Error(`Selected SMTP provider is not allowed. Allowed: ${providerOptions.join(", ")}.`);
  }

  return selectedProvider;
}

function getSmtpConfig(provider) {
  const selectedProvider = resolveSmtpProvider(provider);
  const runtimeProfile = smtpRuntimeProfiles.get(selectedProvider);
  if (runtimeProfile) {
    return {
      provider: selectedProvider,
      host: String(runtimeProfile.host || "").trim(),
      port: Number(runtimeProfile.port || 587),
      secure: Boolean(runtimeProfile.secure),
      user: String(runtimeProfile.user || "").trim(),
      pass: String(runtimeProfile.pass || "").trim(),
      from: String(runtimeProfile.from || "").trim(),
      fromName: normalizeSmtpFromName(runtimeProfile.fromName || ""),
      replyTo: String(runtimeProfile.replyTo || "").trim(),
      fromOptionsRaw: String(runtimeProfile.fromOptionsRaw || "").trim(),
      source: "db",
      profileId: String(runtimeProfile.profileId || ""),
      profileName: String(runtimeProfile.profileName || ""),
    };
  }

  return {
    provider: selectedProvider,
    host: "",
    port: 0,
    secure: false,
    user: "",
    pass: "",
    from: "",
    fromName: "",
    replyTo: "",
    fromOptionsRaw: "",
    source: "db",
    profileId: "",
    profileName: "",
  };
}

function getSmtpFromOptions(provider) {
  const smtpConfig = getSmtpConfig(provider);
  const raw = String(smtpConfig.fromOptionsRaw || "").trim();
  const parsed = raw
    .split(",")
    .map((item) => String(item || "").trim())
    .filter((item) => isValidEmail(item));
  const unique = Array.from(new Set(parsed));

  return unique;
}

function resolveSmtpFromAddress(provider, requestedFrom, defaultFrom) {
  const fromOptions = getSmtpFromOptions(provider);
  const requested = String(requestedFrom || "").trim();
  if (requested) {
    if (!isValidEmail(requested)) {
      throw new Error("Send From must be a valid email address.");
    }
    if (fromOptions.length && !fromOptions.includes(requested)) {
      throw new Error("Selected Send From is not allowed.");
    }
    return requested;
  }

  const configuredDefaultFrom = String(defaultFrom || "").trim();
  if (!configuredDefaultFrom) {
    throw new Error("Send From is required for selected SMTP provider.");
  }
  if (!isValidEmail(configuredDefaultFrom)) {
    throw new Error("Configured Send From is invalid.");
  }
  return configuredDefaultFrom;
}

function resolveSmtpReplyToAddress(requestedReplyTo, defaultReplyTo = "") {
  const requested = String(requestedReplyTo || "").trim().toLowerCase();
  if (requested) {
    if (!isValidEmail(requested)) {
      throw new Error("Reply-To must be a valid email address.");
    }
    return requested;
  }

  const configuredDefault = String(defaultReplyTo || "").trim().toLowerCase();
  if (!configuredDefault) {
    return "";
  }
  if (!isValidEmail(configuredDefault)) {
    throw new Error("Configured Reply-To is invalid.");
  }
  return configuredDefault;
}

function buildSmtpFromHeader(fromAddress, fromName = "") {
  const address = String(fromAddress || "").trim();
  const name = normalizeSmtpFromName(fromName || "");
  if (!name) {
    return address;
  }
  return {
    name,
    address,
  };
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

function getEmailDomain(email) {
  const normalized = normalizeEmail(email);
  const atIndex = normalized.lastIndexOf("@");
  if (atIndex <= 0 || atIndex === normalized.length - 1) {
    return "";
  }
  return normalized.slice(atIndex + 1);
}

function isDisposableDomain(domain) {
  const normalized = String(domain || "").trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  if (BLOCKED_DISPOSABLE_DOMAINS.has(normalized)) {
    return true;
  }
  const parts = normalized.split(".");
  for (let index = 1; index < parts.length - 1; index += 1) {
    const suffix = parts.slice(index).join(".");
    if (BLOCKED_DISPOSABLE_DOMAINS.has(suffix)) {
      return true;
    }
  }
  return false;
}

function isLikelyHardBounceError(errorText) {
  const message = String(errorText || "").toLowerCase();
  if (!message) {
    return false;
  }
  return [
    "user unknown",
    "mailbox unavailable",
    "recipient address rejected",
    "no such user",
    "invalid recipient",
    "unknown recipient",
    "mailbox not found",
    "550",
    "5.1.1",
  ].some((keyword) => message.includes(keyword));
}

function rememberSuppressedRecipient(email, errorText, options = {}) {
  if (!EMAIL_SUPPRESSION_ENABLED) {
    return;
  }
  const recipient = normalizeEmail(email);
  if (!recipient) {
    return;
  }
  const shouldSuppress = options.force === true || isLikelyHardBounceError(errorText);
  if (!shouldSuppress) {
    return;
  }

  suppressedEmailRecipients.add(recipient);
  void upsertEmailSuppression(recipient, {
    source: String(options.source || "hard_bounce").trim() || "hard_bounce",
    reason: String(errorText || "").trim(),
  });
}

function canRetrySoftQueueFailure(dequeueCount) {
  const currentDequeue = Math.max(1, Number(dequeueCount || 1));
  return currentDequeue <= AZURE_EMAIL_QUEUE_SOFT_FAIL_MAX_RETRY + 1;
}

async function withTimeout(promise, timeoutMs, timeoutLabel) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(timeoutLabel)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

async function resolveDomainRecordHealth(domain) {
  const cacheKey = String(domain || "").toLowerCase();
  const now = Date.now();
  const cached = emailDomainCheckCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  let mxRecords = [];
  let hasARecord = false;
  try {
    const records = await withTimeout(dns.resolveMx(cacheKey), EMAIL_VERIFY_TIMEOUT_MS, "MX lookup timeout");
    mxRecords = Array.isArray(records)
      ? records
          .filter((item) => String(item?.exchange || "").trim())
          .map((item) => ({
            exchange: String(item.exchange).trim().toLowerCase(),
            priority: Number.isFinite(Number(item.priority)) ? Number(item.priority) : 0,
          }))
      : [];
    mxRecords.sort((a, b) => a.priority - b.priority || a.exchange.localeCompare(b.exchange));
  } catch {
    mxRecords = [];
  }

  if (!mxRecords.length && EMAIL_VERIFY_ALLOW_A_FALLBACK) {
    try {
      const [a4, a6] = await Promise.allSettled([
        withTimeout(dns.resolve4(cacheKey), EMAIL_VERIFY_TIMEOUT_MS, "A record lookup timeout"),
        withTimeout(dns.resolve6(cacheKey), EMAIL_VERIFY_TIMEOUT_MS, "AAAA record lookup timeout"),
      ]);
      const hasA4 = a4.status === "fulfilled" && Array.isArray(a4.value) && a4.value.length > 0;
      const hasA6 = a6.status === "fulfilled" && Array.isArray(a6.value) && a6.value.length > 0;
      hasARecord = hasA4 || hasA6;
    } catch {
      hasARecord = false;
    }
  }

  const value = {
    domain: cacheKey,
    mxCount: mxRecords.length,
    mxHosts: mxRecords.map((record) => record.exchange),
    hasARecord,
  };
  emailDomainCheckCache.set(cacheKey, {
    value,
    expiresAt: now + EMAIL_VERIFY_CACHE_TTL_MS,
  });
  return value;
}

function getEmailVerifyProbeFromAddress() {
  const configured = normalizeEmail(EMAIL_VERIFY_SMTP_PROBE_FROM);
  if (isValidEmail(configured)) {
    return configured;
  }
  const probeHost = EMAIL_VERIFY_SMTP_HELO_HOST.includes(".")
    ? EMAIL_VERIFY_SMTP_HELO_HOST
    : "localhost.localdomain";
  return `postmaster@${probeHost}`;
}

function classifySmtpRcptResponse(response = {}) {
  const code = Number(response.code || 0);
  const message = String(response.text || "").trim();

  if ([250, 251, 252].includes(code)) {
    return {
      verdict: "deliverable",
      reason: message || "Recipient accepted by destination MX.",
      smtpCode: code,
    };
  }

  if (code >= 500 && code < 600) {
    return {
      verdict: "undeliverable",
      reason: message || `Destination rejected recipient (SMTP ${code}).`,
      smtpCode: code,
    };
  }

  if (code >= 400 && code < 500) {
    return {
      verdict: "risky",
      reason: message || `Destination returned temporary SMTP ${code}.`,
      smtpCode: code,
    };
  }

  return {
    verdict: "risky",
    reason: message || "SMTP probe inconclusive.",
    smtpCode: code || null,
  };
}

function createSmtpLineReader(socket) {
  let buffer = "";
  let closed = false;
  let failure = null;
  const pendingLines = [];
  const waitingResolvers = [];

  function flushWaiting() {
    while (pendingLines.length && waitingResolvers.length) {
      const waiter = waitingResolvers.shift();
      const line = pendingLines.shift();
      waiter.resolve({ ok: true, line });
    }
  }

  function pushLine(line) {
    if (!String(line || "").trim()) {
      return;
    }
    pendingLines.push(String(line).trim());
    flushWaiting();
  }

  function finalizeFailure(error) {
    if (!failure) {
      failure = error instanceof Error ? error : new Error(String(error || "SMTP connection closed."));
    }
    while (waitingResolvers.length) {
      const waiter = waitingResolvers.shift();
      waiter.resolve({ ok: false, error: failure });
    }
  }

  socket.setEncoding("utf8");
  socket.on("data", (chunk) => {
    buffer += String(chunk || "");
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    lines.forEach(pushLine);
  });
  socket.on("error", (error) => {
    finalizeFailure(error);
  });
  socket.on("close", () => {
    closed = true;
    finalizeFailure(failure || new Error("SMTP connection closed."));
  });

  async function readLine(timeoutMs, label) {
    if (pendingLines.length) {
      return pendingLines.shift();
    }

    if (failure) {
      throw failure;
    }

    if (closed) {
      throw new Error("SMTP connection closed.");
    }

    return await new Promise((resolve, reject) => {
      const waiter = {
        resolve: (result) => {
          clearTimeout(timer);
          if (!result?.ok) {
            reject(result?.error || new Error("SMTP connection closed."));
            return;
          }
          resolve(result.line);
        },
      };

      const timer = setTimeout(() => {
        const index = waitingResolvers.indexOf(waiter);
        if (index >= 0) {
          waitingResolvers.splice(index, 1);
        }
        reject(new Error(label));
      }, Math.max(1000, Number(timeoutMs) || EMAIL_VERIFY_SMTP_COMMAND_TIMEOUT_MS));

      waitingResolvers.push(waiter);
    });
  }

  async function readResponse(timeoutMs, label) {
    const lines = [];
    let code = 0;
    let safetyCounter = 0;

    while (safetyCounter < 20) {
      safetyCounter += 1;
      const line = await readLine(timeoutMs, label);
      lines.push(line);
      const match = line.match(/^(\d{3})([\s-])(.*)$/);
      if (!match) {
        continue;
      }

      code = Number(match[1]);
      if (match[2] === " ") {
        break;
      }
    }

    return {
      code,
      text: lines.join(" | ").trim(),
      lines,
    };
  }

  return {
    readResponse,
  };
}

async function runSmtpRecipientProbe(mxHost, recipientEmail) {
  const host = String(mxHost || "").trim().toLowerCase();
  if (!host) {
    return {
      verdict: "risky",
      reason: "Empty MX host.",
      host,
      smtpCode: null,
    };
  }

  const recipient = normalizeEmail(recipientEmail);
  const envelopeFrom = getEmailVerifyProbeFromAddress();
  const socket = net.createConnection({
    host,
    port: 25,
    timeout: EMAIL_VERIFY_SMTP_CONNECT_TIMEOUT_MS,
  });
  socket.setNoDelay(true);
  socket.setTimeout(EMAIL_VERIFY_SMTP_COMMAND_TIMEOUT_MS);
  socket.on("timeout", () => {
    socket.destroy(new Error("SMTP socket timeout"));
  });

  const lineReader = createSmtpLineReader(socket);

  try {
    await withTimeout(
      new Promise((resolve, reject) => {
        socket.once("connect", resolve);
        socket.once("error", reject);
      }),
      EMAIL_VERIFY_SMTP_CONNECT_TIMEOUT_MS,
      "SMTP connect timeout",
    );

    const greeting = await lineReader.readResponse(EMAIL_VERIFY_SMTP_COMMAND_TIMEOUT_MS, "SMTP greeting timeout");
    if (Number(greeting.code || 0) !== 220) {
      return {
        verdict: "risky",
        reason: greeting.text || `Unexpected SMTP greeting from ${host}.`,
        host,
        smtpCode: greeting.code || null,
      };
    }

    const sendCommand = async (command, label) => {
      socket.write(`${command}\r\n`);
      return await lineReader.readResponse(EMAIL_VERIFY_SMTP_COMMAND_TIMEOUT_MS, label);
    };

    let heloResponse = await sendCommand(`EHLO ${EMAIL_VERIFY_SMTP_HELO_HOST}`, "EHLO timeout");
    if (Number(heloResponse.code || 0) >= 500) {
      heloResponse = await sendCommand(`HELO ${EMAIL_VERIFY_SMTP_HELO_HOST}`, "HELO timeout");
    }

    if (Number(heloResponse.code || 0) >= 500) {
      return {
        verdict: "risky",
        reason: heloResponse.text || `SMTP HELO rejected by ${host}.`,
        host,
        smtpCode: heloResponse.code || null,
      };
    }

    const mailFromResponse = await sendCommand(`MAIL FROM:<${envelopeFrom}>`, "MAIL FROM timeout");
    if (Number(mailFromResponse.code || 0) >= 500) {
      return {
        verdict: "risky",
        reason: mailFromResponse.text || `SMTP MAIL FROM rejected by ${host}.`,
        host,
        smtpCode: mailFromResponse.code || null,
      };
    }

    const rcptResponse = await sendCommand(`RCPT TO:<${recipient}>`, "RCPT TO timeout");
    const classified = classifySmtpRcptResponse(rcptResponse);

    return {
      ...classified,
      host,
      smtpText: rcptResponse.text || "",
    };
  } catch (error) {
    return {
      verdict: "risky",
      reason: error.message || `SMTP probe failed for ${host}.`,
      host,
      smtpCode: null,
    };
  } finally {
    try {
      socket.write("QUIT\r\n");
    } catch {
      // no-op
    }
    socket.destroy();
  }
}

async function probeRecipientWithMx(email, domainHealth) {
  const recipient = normalizeEmail(email);
  const cacheKey = recipient;
  const now = Date.now();
  const cached = emailSmtpProbeCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const mxHosts = Array.isArray(domainHealth?.mxHosts)
    ? domainHealth.mxHosts.filter((item) => String(item || "").trim())
    : [];

  if (!mxHosts.length) {
    const value = {
      verdict: "undeliverable",
      reason: "No MX host found for SMTP probe.",
      host: "",
      smtpCode: null,
    };
    emailSmtpProbeCache.set(cacheKey, {
      value,
      expiresAt: now + EMAIL_VERIFY_SMTP_PROBE_CACHE_TTL_MS,
    });
    return value;
  }

  let latestRiskyResult = {
    verdict: "risky",
    reason: "SMTP probe inconclusive.",
    host: mxHosts[0],
    smtpCode: null,
  };

  const probeTargets = mxHosts.slice(0, EMAIL_VERIFY_SMTP_MAX_MX_TO_TRY);
  for (const host of probeTargets) {
    const outcome = await runSmtpRecipientProbe(host, recipient);
    if (outcome.verdict === "deliverable") {
      if (EMAIL_VERIFY_SMTP_CHECK_CATCH_ALL) {
        const domain = getEmailDomain(recipient);
        const randomLocalPart = `probe-${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
        const randomOutcome = await runSmtpRecipientProbe(host, `${randomLocalPart}@${domain}`);
        if (randomOutcome.verdict === "deliverable") {
          latestRiskyResult = {
            verdict: "risky",
            reason: "Domain appears catch-all (MX accepted random mailbox).",
            host,
            smtpCode: randomOutcome.smtpCode || null,
          };
          continue;
        }
      }

      emailSmtpProbeCache.set(cacheKey, {
        value: outcome,
        expiresAt: now + EMAIL_VERIFY_SMTP_PROBE_CACHE_TTL_MS,
      });
      return outcome;
    }

    if (outcome.verdict === "undeliverable") {
      emailSmtpProbeCache.set(cacheKey, {
        value: outcome,
        expiresAt: now + EMAIL_VERIFY_SMTP_PROBE_CACHE_TTL_MS,
      });
      return outcome;
    }

    latestRiskyResult = outcome;
  }

  emailSmtpProbeCache.set(cacheKey, {
    value: latestRiskyResult,
    expiresAt: now + EMAIL_VERIFY_SMTP_PROBE_CACHE_TTL_MS,
  });
  return latestRiskyResult;
}

async function preflightEmailDeliverability(recipient) {
  const email = normalizeEmail(recipient);
  if (!isValidEmail(email)) {
    return {
      ok: false,
      reason: "Invalid email address.",
      gate: "syntax",
      verdict: "undeliverable",
    };
  }

  if (EMAIL_SUPPRESSION_ENABLED && suppressedEmailRecipients.has(email)) {
    return {
      ok: false,
      reason: "Recipient suppressed after earlier hard bounce.",
      gate: "suppression",
      verdict: "undeliverable",
    };
  }

  if (isEmailUnsubscribed(email)) {
    return {
      ok: false,
      reason: "Recipient has unsubscribed from campaigns.",
      gate: "unsubscribe",
      verdict: "undeliverable",
    };
  }

  const domain = getEmailDomain(email);
  if (!domain) {
    return {
      ok: false,
      reason: "Invalid email domain.",
      gate: "domain",
      verdict: "undeliverable",
    };
  }

  if (EMAIL_BLOCK_DISPOSABLE_DOMAINS && isDisposableDomain(domain)) {
    return {
      ok: false,
      reason: "Disposable email domain blocked.",
      gate: "disposable",
      verdict: "undeliverable",
    };
  }

  if (EMAIL_VERIFY_MODE === "none" || EMAIL_VERIFY_MODE === "syntax") {
    return { ok: true, reason: "Syntax-only validation passed.", gate: "syntax", verdict: "deliverable" };
  }

  if (!isEmailMxValidationEnabled() && !isEmailSmtpProbeEnabled()) {
    return {
      ok: true,
      reason: `Verification mode \"${EMAIL_VERIFY_MODE}\" does not run DNS/SMTP checks.`,
      gate: "mode",
      verdict: "risky",
    };
  }

  const domainHealth = await resolveDomainRecordHealth(domain);

  const hasMxRecord = Number(domainHealth.mxCount || 0) > 0;
  const hasARecordFallback = EMAIL_VERIFY_ALLOW_A_FALLBACK && Boolean(domainHealth.hasARecord);

  if (isEmailMxValidationEnabled() && !hasMxRecord && !hasARecordFallback) {
    return {
      ok: false,
      reason: "Email domain has no MX record (and no A/AAAA fallback).",
      gate: "dns",
      verdict: "undeliverable",
    };
  }

  if (isEmailSmtpProbeEnabled()) {
    if (!hasMxRecord) {
      return {
        ok: false,
        reason: "SMTP probe requires MX records on recipient domain.",
        gate: "smtp_probe",
        verdict: "undeliverable",
      };
    }

    const probeResult = await probeRecipientWithMx(email, domainHealth);
    if (probeResult.verdict === "deliverable") {
      return {
        ok: true,
        reason: probeResult.reason,
        gate: "smtp_probe",
        verdict: "deliverable",
      };
    }

    if (probeResult.verdict === "undeliverable") {
      rememberSuppressedRecipient(email, probeResult.reason, {
        force: true,
        source: "preflight_smtp",
      });
      return {
        ok: false,
        reason: probeResult.reason,
        gate: "smtp_probe",
        verdict: "undeliverable",
      };
    }

    if (EMAIL_VERIFY_REJECT_RISKY) {
      return {
        ok: false,
        reason: probeResult.reason,
        gate: "smtp_probe",
        verdict: "risky",
      };
    }

    return {
      ok: true,
      reason: `${probeResult.reason} (accepted as risky)`,
      gate: "smtp_probe",
      verdict: "risky",
    };
  }

  return {
    ok: true,
    reason: hasMxRecord ? "MX found." : "A/AAAA fallback found.",
    gate: "dns",
    verdict: hasMxRecord ? "deliverable" : "risky",
  };
}

function normalizeEmailBodyFormat(value) {
  return String(value || "html").trim().toLowerCase() === "plain" ? "plain" : "html";
}

function buildEmailBodiesFromTemplate(bodyTemplate, mergedRow, formatInput) {
  const rendered = interpolateTemplate(bodyTemplate, mergedRow);
  const normalizedFormat = normalizeEmailBodyFormat(formatInput);

  if (normalizedFormat === "plain") {
    return {
      html: `<div style="font-family:Arial,Helvetica,sans-serif;line-height:1.6;color:#1f2937;">${escapeHtmlForEmail(
        rendered,
      ).replace(/\r?\n/g, "<br>")}</div>`,
      text: rendered,
      bodyFormat: normalizedFormat,
    };
  }

  const looksLikeHtml = /<\/?[a-z][\s\S]*>/i.test(rendered);
  if (looksLikeHtml) {
    return {
      html: rendered,
      text: rendered.replace(/<[^>]+>/g, ""),
      bodyFormat: normalizedFormat,
    };
  }

  return {
    html: `<div style="font-family:Arial,Helvetica,sans-serif;line-height:1.6;color:#1f2937;">${escapeHtmlForEmail(
      rendered,
    ).replace(/\r?\n/g, "<br>")}</div>`,
    text: rendered,
    bodyFormat: normalizedFormat,
  };
}

function createSmtpTransporter(providerInput) {
  const provider = resolveSmtpProvider(providerInput);
  const smtpConfig = getSmtpConfig(provider);

  if (!smtpConfig.host || !smtpConfig.port) {
    throw new Error(`SMTP not configured for ${provider}. Activate a DB credential profile in Config Center.`);
  }

  const transporterConfig = {
    host: smtpConfig.host,
    port: smtpConfig.port,
    secure: smtpConfig.secure,
    connectionTimeout: SMTP_CONNECTION_TIMEOUT_MS,
    greetingTimeout: SMTP_GREETING_TIMEOUT_MS,
    socketTimeout: SMTP_SOCKET_TIMEOUT_MS,
  };

  if (smtpConfig.user && smtpConfig.pass) {
    transporterConfig.auth = { user: smtpConfig.user, pass: smtpConfig.pass };
  }

  return {
    provider,
    transporter: nodemailer.createTransport(transporterConfig),
    fromAddress: smtpConfig.from,
    fromName: smtpConfig.fromName,
    replyToAddress: smtpConfig.replyTo,
  };
}

function getAzureEmailQueueConfig() {
  const connectionString = String(process.env.AZURE_STORAGE_QUEUE_CONNECTION_STRING || "").trim();
  const queueName = String(process.env.AZURE_EMAIL_QUEUE_NAME || "").trim();

  return {
    enabled: Boolean(connectionString && queueName),
    connectionString,
    queueName,
  };
}

async function initAzureEmailQueue() {
  const config = getAzureEmailQueueConfig();
  if (!config.enabled) {
    console.log(
      "Azure Email Queue disabled. Set AZURE_STORAGE_QUEUE_CONNECTION_STRING and AZURE_EMAIL_QUEUE_NAME to enable queue-based SMTP campaigns.",
    );
    emailQueueRuntime.enabled = false;
    emailQueueRuntime.queueClient = null;
    emailQueueRuntime.queueName = "";
    return;
  }

  const queueServiceClient = QueueServiceClient.fromConnectionString(config.connectionString);
  const queueClient = queueServiceClient.getQueueClient(config.queueName);
  await queueClient.createIfNotExists();

  emailQueueRuntime.enabled = true;
  emailQueueRuntime.queueClient = queueClient;
  emailQueueRuntime.queueName = config.queueName;
  console.log(`Azure Email Queue enabled: ${config.queueName}`);
  if (AZURE_EMAIL_QUEUE_VISIBILITY_TIMEOUT_SECONDS > AZURE_EMAIL_QUEUE_VISIBILITY_TIMEOUT_SECONDS_RAW) {
    console.log(
      `Azure Email Queue visibility timeout raised to ${AZURE_EMAIL_QUEUE_VISIBILITY_TIMEOUT_SECONDS}s to match SMTP rate/batch size.`,
    );
  }
}

async function getEmailQueueSmtpContext(provider) {
  const selectedProvider = resolveSmtpProvider(provider);
  const cached = emailQueueSmtpContexts.get(selectedProvider);
  if (cached) {
    return cached;
  }

  const context = createSmtpTransporter(selectedProvider);
  if (!context.fromAddress) {
    throw new Error(`From address is required for active ${selectedProvider} SMTP profile.`);
  }

  await withTimeout(context.transporter.verify(), SMTP_VERIFY_TIMEOUT_MS, "SMTP verify timeout");
  emailQueueSmtpContexts.set(selectedProvider, context);
  return context;
}

async function applyEmailQueueThrottle(sendDelayMs = DEFAULT_SMTP_SEND_DELAY_MS) {
  const delayMs = Math.max(0, Number(sendDelayMs) || 0);
  if (delayMs <= 0 || !emailQueueLastSentAt) {
    return;
  }

  const elapsed = Date.now() - emailQueueLastSentAt;
  if (elapsed < delayMs) {
    await sleep(delayMs - elapsed);
  }
}

async function enqueueEmailTaskMessage(taskPayload) {
  if (!emailQueueRuntime.enabled || !emailQueueRuntime.queueClient) {
    return false;
  }

  await emailQueueRuntime.queueClient.sendMessage(JSON.stringify(taskPayload || {}));
  return true;
}

async function processQueuedEmailTask(payload, options = {}) {
  const dequeueCount = Math.max(1, Number(options.dequeueCount || 1));
  const campaignId = String(payload?.campaignId || "").trim();
  const rowIndex = Number.isFinite(Number(payload?.rowIndex)) ? Number(payload.rowIndex) : null;
  const recipient = normalizeEmail(payload?.recipient);
  const rowData = sanitizeRowObject(payload?.rowData);
  const subjectTemplate = String(payload?.subjectTemplate || "").trim();
  const bodyTemplate = String(payload?.bodyTemplate || "").trim();
  const bodyFormat = normalizeEmailBodyFormat(payload?.bodyFormat);
  const smtpProvider = resolveSmtpProvider(payload?.smtpProvider);
  const requestedFrom = String(payload?.mailFrom || "").trim();
  const requestedReplyTo = String(payload?.replyTo || "").trim();
  const trackingBaseUrl = String(payload?.baseUrl || "").trim();
  const sendRatePerMinute = normalizeSmtpSendRatePerMinute(payload?.sendRatePerMinute);
  const sendDelayMs = getSmtpSendDelayMs(sendRatePerMinute);

  if (!campaignId || !subjectTemplate || !bodyTemplate || !recipient) {
    return { action: "delete", reason: "invalid_payload" };
  }

  const campaign = await getCampaignById(campaignId);
  if (!campaign) {
    return { action: "delete", reason: "campaign_missing" };
  }

  const campaignStatus = String(campaign.status || "").toLowerCase();
  if (CAMPAIGN_STATUS_TERMINAL.has(campaignStatus) || campaign.stop_requested) {
    return { action: "delete", reason: "campaign_stopped" };
  }

  let resultPatch;
  const preflight = await preflightEmailDeliverability(recipient);
  if (!preflight.ok && EMAIL_VERIFY_ENFORCE) {
    await logEmailRejection({
      campaignId,
      recipient,
      gate: String(preflight.gate || "preflight"),
      verdict: String(preflight.verdict || "rejected"),
      reason: preflight.reason,
      source: "preflight",
      rowIndex,
      rowData,
    });
    resultPatch = {
      status: "failed",
      errorText: preflight.reason,
      lastMessage: `Precheck failed: ${preflight.gate}`,
    };
  } else {
    await applyEmailQueueThrottle(sendDelayMs);
    const mergedRow = buildEmailTemplateContext(rowData, {
      recipient,
      campaignId,
    });
    const subject = interpolateTemplate(subjectTemplate, mergedRow);
    const emailBodies = buildEmailBodiesFromTemplate(bodyTemplate, mergedRow, bodyFormat);
    const trackedEmailBodies = applyEmailEngagementTracking(emailBodies, {
      campaignId,
      recipient,
      rowIndex,
      baseUrl: trackingBaseUrl,
    });
    const headers = buildListUnsubscribeHeaders(recipient, { campaignId });

    try {
      const context = await getEmailQueueSmtpContext(smtpProvider);
      const fromAddress = resolveSmtpFromAddress(smtpProvider, requestedFrom, context.fromAddress);
      const fromHeader = buildSmtpFromHeader(fromAddress, context.fromName || "");
      const replyToAddress = resolveSmtpReplyToAddress(requestedReplyTo, context.replyToAddress);
      const info = await withTimeout(
        context.transporter.sendMail({
          from: fromHeader,
          to: recipient,
          replyTo: replyToAddress || undefined,
          subject: subject || "Notification",
          html: trackedEmailBodies.html,
          text: trackedEmailBodies.text,
          headers: Object.keys(headers).length ? headers : undefined,
        }),
        SMTP_SEND_TIMEOUT_MS,
        "SMTP send timeout",
      );
      emailQueueLastSentAt = Date.now();
      resultPatch = {
        status: "sent",
        providerMessageId: String(info.messageId || ""),
        lastMessage: "Sending in progress",
      };
    } catch (error) {
      const errorText = String(error?.message || "Send failed.");
      const hardBounce = isLikelyHardBounceError(errorText);
      emailQueueSmtpContexts.delete(smtpProvider);
      if (hardBounce) {
        rememberSuppressedRecipient(recipient, errorText, {
          source: "smtp_send",
        });
        await logEmailRejection({
          campaignId,
          recipient,
          gate: "smtp_send",
          verdict: "undeliverable",
          reason: errorText,
          source: "smtp_send",
          rowIndex,
          rowData,
        });
      }
      if (!hardBounce && canRetrySoftQueueFailure(dequeueCount)) {
        return {
          action: "retry",
          reason: "soft_fail",
          errorText,
        };
      }
      resultPatch = {
        status: "failed",
        errorText,
        lastMessage: hardBounce ? "Hard bounce: recipient marked invalid" : errorText,
      };
    }
  }

  const status = String(resultPatch.status || "failed").toLowerCase();
  const isSuccess = status === "sent";

  if (Number.isFinite(rowIndex)) {
    await dbPool.query(
      `
        UPDATE campaign_recipients
        SET status = $3,
            provider_message_id = $4,
            error_text = $5,
            processed_at = NOW(),
            updated_at = NOW()
        WHERE campaign_id = $1
          AND row_index = $2
      `,
      [
        campaignId,
        Number(rowIndex),
        status,
        resultPatch.providerMessageId ? String(resultPatch.providerMessageId) : null,
        resultPatch.errorText ? String(resultPatch.errorText) : null,
      ],
    );
  }

  const updated = await dbPool.query(
    `
      UPDATE campaigns
      SET status = CASE
            WHEN stop_requested THEN 'stopped'
            WHEN processed + 1 >= total THEN 'completed'
            ELSE 'running'
          END,
          started_at = COALESCE(started_at, NOW()),
          completed_at = CASE
            WHEN stop_requested OR processed + 1 >= total THEN NOW()
            ELSE completed_at
          END,
          processed = LEAST(total, processed + 1),
          sent = sent + $2,
          failed = failed + $3,
          last_message = $4,
          updated_at = NOW()
      WHERE id = $1
      RETURNING id, status
    `,
    [campaignId, isSuccess ? 1 : 0, isSuccess ? 0 : 1, String(resultPatch.lastMessage || "Sending in progress")],
  );

  if (!updated.rows?.length) {
    return { action: "delete", reason: "campaign_update_missing" };
  }

  const nextStatus = String(updated.rows[0].status || "").toLowerCase();
  if (nextStatus === "completed") {
    await finalizeCampaign(campaignId, "completed", "Campaign completed");
  }
  if (nextStatus === "stopped") {
    await finalizeCampaign(campaignId, "stopped", "Stopped by user");
  }

  return {
    action: "delete",
    reason: String(resultPatch.status || "failed").toLowerCase(),
  };
}

async function drainAzureEmailQueueOnce() {
  if (!emailQueueRuntime.enabled || !emailQueueRuntime.queueClient || emailQueueRuntime.pollInProgress) {
    return;
  }

  emailQueueRuntime.pollInProgress = true;
  try {
    const response = await emailQueueRuntime.queueClient.receiveMessages({
      numberOfMessages: AZURE_EMAIL_QUEUE_BATCH_SIZE,
      visibilityTimeout: AZURE_EMAIL_QUEUE_VISIBILITY_TIMEOUT_SECONDS,
    });
    const messages = response.receivedMessageItems || [];

    for (const message of messages) {
      let shouldDelete = false;
      try {
        const payload = JSON.parse(String(message.messageText || "{}"));
        const messageType = String(payload.type || "smtp_email_task").trim().toLowerCase();
        if (messageType === "smtp_email_task") {
          const outcome = await processQueuedEmailTask(payload, {
            dequeueCount: Number(message.dequeueCount || 1),
          });
          shouldDelete = outcome?.action !== "retry";
          continue;
        }

        if (messageType !== "smtp_campaign") {
          shouldDelete = true;
          continue;
        }

        void processCampaignQueue(CAMPAIGN_CHANNEL_EMAIL);
        shouldDelete = true;
      } catch (error) {
        const dequeueCount = Number(message.dequeueCount || 0);
        if (dequeueCount >= AZURE_EMAIL_QUEUE_MAX_DEQUEUE) {
          shouldDelete = true;
          console.error("Dropping poison Azure email queue message.", error.message || error);
        }
      }

      if (shouldDelete) {
        await emailQueueRuntime.queueClient.deleteMessage(message.messageId, message.popReceipt);
      }
    }
  } catch (error) {
    console.error("Azure email queue polling failed.", error.message || error);
  } finally {
    emailQueueRuntime.pollInProgress = false;
  }
}

function startAzureEmailQueueConsumer() {
  if (!emailQueueRuntime.enabled || emailQueueRuntime.pollTimer) {
    return;
  }

  emailQueueRuntime.pollTimer = setInterval(() => {
    void drainAzureEmailQueueOnce();
  }, AZURE_EMAIL_QUEUE_POLL_INTERVAL_MS);

  void drainAzureEmailQueueOnce();
}

function buildCampaignId(channel) {
  return `${channel}-${Date.now()}-${crypto.randomUUID()}`;
}

function sanitizeRowObject(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    return {};
  }
  return row;
}

function buildValueOverridesFromMapping(row, valueMappings = {}) {
  const valueOverrides = {};

  Object.entries(valueMappings).forEach(([templateKey, mapping]) => {
    if (!templateKey || !mapping) {
      return;
    }

    if (typeof mapping === "string") {
      valueOverrides[templateKey] = String(getCell(row, mapping)).trim();
      return;
    }

    const source = String(mapping.source || "column").trim();
    if (source === "static") {
      valueOverrides[templateKey] = String(mapping.value || "").trim();
      return;
    }

    valueOverrides[templateKey] = String(getCell(row, mapping.column)).trim();
  });

  return valueOverrides;
}

function buildCampaignSummary(campaign) {
  if (!campaign) {
    return {
      runId: "",
      channel: "",
      status: "idle",
      loaded: 0,
      total: 0,
      processed: 0,
      sent: 0,
      failed: 0,
      inProgress: false,
      stopRequested: false,
      lastMessage: "Idle",
      lastUpdatedAt: "",
      createdAt: "",
      startedAt: "",
      completedAt: "",
    };
  }

  return {
    runId: String(campaign.id || ""),
    channel: String(campaign.channel || ""),
    status: String(campaign.status || "idle"),
    loaded: Number(campaign.total || 0),
    total: Number(campaign.total || 0),
    processed: Number(campaign.processed || 0),
    sent: Number(campaign.sent || 0),
    failed: Number(campaign.failed || 0),
    inProgress: !CAMPAIGN_STATUS_TERMINAL.has(String(campaign.status || "").toLowerCase()),
    stopRequested: Boolean(campaign.stop_requested),
    lastMessage: String(campaign.last_message || ""),
    lastUpdatedAt: campaign.updated_at ? new Date(campaign.updated_at).toISOString() : "",
    createdAt: campaign.created_at ? new Date(campaign.created_at).toISOString() : "",
    startedAt: campaign.started_at ? new Date(campaign.started_at).toISOString() : "",
    completedAt: campaign.completed_at ? new Date(campaign.completed_at).toISOString() : "",
  };
}

async function getCampaignById(campaignId) {
  ensureDbAvailable();
  const result = await dbPool.query(
    `
      SELECT *
      FROM campaigns
      WHERE id = $1
      LIMIT 1
    `,
    [String(campaignId || "")],
  );

  return result.rows?.[0] || null;
}

async function getLatestCampaign(channel) {
  ensureDbAvailable();
  const result = await dbPool.query(
    `
      SELECT *
      FROM campaigns
      WHERE channel = $1
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [channel],
  );

  return result.rows?.[0] || null;
}

async function getLiveCampaignSummary(channel, campaignId = "") {
  const campaign = campaignId ? await getCampaignById(campaignId) : await getLatestCampaign(channel);
  const summary = buildCampaignSummary(campaign);

  if (channel === CAMPAIGN_CHANNEL_EMAIL) {
    return {
      ...summary,
      lastTestRecipient: smtpTestState.lastTestRecipient || "",
      lastTestAt: smtpTestState.lastTestAt || "",
      testInProgress: Boolean(smtpTestState.inProgress),
      testMessage: String(smtpTestState.lastMessage || ""),
    };
  }

  return summary;
}

function broadcastCampaignSummaryEvent(campaign) {
  if (!campaign) {
    return;
  }

  broadcastInboxEvent({
    type: "campaign",
    channel: String(campaign.channel || "").toLowerCase(),
    summary: buildCampaignSummary(campaign),
  });
}

async function createEmailCampaignRecord(payload, total, rows = [], recipientColumn = "") {
  ensureDbAvailable();
  const campaignId = buildCampaignId(CAMPAIGN_CHANNEL_EMAIL);
  const sanitizedRows = Array.isArray(rows) ? rows.map((row) => sanitizeRowObject(row)) : [];
  const client = await dbPool.connect();

  try {
    await client.query("BEGIN");
    await client.query(
      `
        INSERT INTO campaigns (
          id, channel, status, total, processed, sent, failed, payload_json, last_message
        )
        VALUES ($1, $2, 'queued', $3, 0, 0, 0, $4::jsonb, 'Queued')
      `,
      [campaignId, CAMPAIGN_CHANNEL_EMAIL, Number(total || 0), JSON.stringify(payload || {})],
    );

    for (let index = 0; index < sanitizedRows.length; index += 1) {
      const row = sanitizedRows[index];
      const recipient = normalizeEmail(getCell(row, recipientColumn));

      await client.query(
        `
          INSERT INTO campaign_recipients (
            campaign_id, row_index, recipient, row_data, status
          )
          VALUES ($1, $2, $3, $4::jsonb, 'pending')
        `,
        [campaignId, index, String(recipient || ""), JSON.stringify(row)],
      );
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  const campaign = await getCampaignById(campaignId);
  broadcastCampaignSummaryEvent(campaign);
  return campaignId;
}

async function enqueueEmailCampaignTasks(campaignId, campaignPayload, rows, recipientColumn) {
  if (!emailQueueRuntime.enabled || !emailQueueRuntime.queueClient) {
    return false;
  }

  const subjectTemplate = String(campaignPayload.subjectTemplate || "").trim();
  const bodyTemplate = String(campaignPayload.bodyTemplate || "").trim();
  const bodyFormat = normalizeEmailBodyFormat(campaignPayload.bodyFormat);
  const smtpProvider = resolveSmtpProvider(campaignPayload.smtpProvider);
  const sendRatePerMinute = normalizeSmtpSendRatePerMinute(campaignPayload.sendRatePerMinute);
  const mailFrom = String(campaignPayload.mailFrom || "").trim();
  const replyTo = String(campaignPayload.replyTo || "").trim();
  const baseUrl = String(campaignPayload.baseUrl || "").trim();
  const sanitizedRows = rows.map((row) => sanitizeRowObject(row));

  for (let rowIndex = 0; rowIndex < sanitizedRows.length; rowIndex += 1) {
    const rowData = sanitizedRows[rowIndex];
    const recipient = normalizeEmail(getCell(rowData, recipientColumn));
    await enqueueEmailTaskMessage({
      type: "smtp_email_task",
      campaignId: String(campaignId || ""),
      rowIndex,
      recipient,
      rowData,
      subjectTemplate,
      bodyTemplate,
      bodyFormat,
      smtpProvider,
      sendRatePerMinute,
      mailFrom,
      replyTo,
      baseUrl,
      enqueuedAt: new Date().toISOString(),
    });
  }

  await dbPool.query(
    `
      UPDATE campaigns
      SET status = 'running',
          started_at = COALESCE(started_at, NOW()),
          updated_at = NOW(),
          last_message = 'Queued in Azure'
      WHERE id = $1
    `,
    [campaignId],
  );

  const campaign = await getCampaignById(campaignId);
  broadcastCampaignSummaryEvent(campaign);

  return true;
}

async function createCampaignWithRecipients(channel, payload, rows, recipientColumn) {
  ensureDbAvailable();

  const campaignId = buildCampaignId(channel);
  const sanitizedRows = rows.map((row) => sanitizeRowObject(row));
  const client = await dbPool.connect();

  try {
    await client.query("BEGIN");
    await client.query(
      `
        INSERT INTO campaigns (
          id, channel, status, total, processed, sent, failed, payload_json, last_message
        )
        VALUES ($1, $2, 'queued', $3, 0, 0, 0, $4::jsonb, 'Queued')
      `,
      [campaignId, channel, sanitizedRows.length, JSON.stringify(payload || {})],
    );

    for (let index = 0; index < sanitizedRows.length; index += 1) {
      const row = sanitizedRows[index];
      const recipientRaw = getCell(row, recipientColumn);
      const recipient =
        channel === CAMPAIGN_CHANNEL_WHATSAPP ? normalizePhone(recipientRaw) : normalizeEmail(recipientRaw);

      await client.query(
        `
          INSERT INTO campaign_recipients (
            campaign_id, row_index, recipient, row_data, status
          )
          VALUES ($1, $2, $3, $4::jsonb, 'pending')
        `,
        [campaignId, index, String(recipient || ""), JSON.stringify(row)],
      );
    }

    await client.query("COMMIT");
    return campaignId;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function claimNextCampaign(channel) {
  ensureDbAvailable();
  const client = await dbPool.connect();

  try {
    await client.query("BEGIN");
    const result = await client.query(
      `
        SELECT *
        FROM campaigns
        WHERE channel = $1
          AND status IN ('queued', 'running')
        ORDER BY CASE WHEN status = 'running' THEN 0 ELSE 1 END, created_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      `,
      [channel],
    );

    const campaign = result.rows?.[0] || null;
    if (!campaign) {
      await client.query("COMMIT");
      return null;
    }

    if (campaign.stop_requested) {
      await client.query(
        `
          UPDATE campaigns
          SET status = 'stopped',
              completed_at = NOW(),
              updated_at = NOW(),
              last_message = 'Stopped'
          WHERE id = $1
        `,
        [campaign.id],
      );
      await client.query("COMMIT");
      return null;
    }

    await client.query(
      `
        UPDATE campaigns
        SET status = 'running',
            started_at = COALESCE(started_at, NOW()),
            updated_at = NOW(),
            last_message = CASE WHEN status = 'queued' THEN 'Campaign started' ELSE last_message END
        WHERE id = $1
      `,
      [campaign.id],
    );

    await client.query("COMMIT");
    const startedCampaign = {
      ...campaign,
      status: "running",
      updated_at: new Date().toISOString(),
      started_at: campaign.started_at || new Date().toISOString(),
      last_message: campaign.status === "queued" ? "Campaign started" : campaign.last_message,
    };
    broadcastCampaignSummaryEvent(startedCampaign);
    return {
      ...campaign,
      status: "running",
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function claimNextRecipient(campaignId) {
  ensureDbAvailable();
  const client = await dbPool.connect();

  try {
    await client.query("BEGIN");
    const result = await client.query(
      `
        SELECT id, row_index, recipient, row_data
        FROM campaign_recipients
        WHERE campaign_id = $1
          AND status = 'pending'
        ORDER BY row_index ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      `,
      [campaignId],
    );
    const row = result.rows?.[0] || null;
    if (!row) {
      await client.query("COMMIT");
      return null;
    }

    await client.query(
      `
        UPDATE campaign_recipients
        SET status = 'processing',
            updated_at = NOW()
        WHERE id = $1
      `,
      [row.id],
    );

    await client.query("COMMIT");
    return row;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function completeRecipient(campaignId, recipientId, resultPatch = {}) {
  const status = String(resultPatch.status || "failed").toLowerCase();
  const isSuccess = status === "sent";

  await dbPool.query(
    `
      UPDATE campaign_recipients
      SET status = $2,
          provider_message_id = $3,
          error_text = $4,
          processed_at = NOW(),
          updated_at = NOW()
      WHERE id = $1
    `,
    [
      recipientId,
      status,
      resultPatch.providerMessageId ? String(resultPatch.providerMessageId) : null,
      resultPatch.errorText ? String(resultPatch.errorText) : null,
    ],
  );

  const campaignResult = await dbPool.query(
    `
      UPDATE campaigns
      SET processed = processed + 1,
          sent = sent + $2,
          failed = failed + $3,
          last_message = $4,
          updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `,
    [campaignId, isSuccess ? 1 : 0, isSuccess ? 0 : 1, String(resultPatch.lastMessage || "Sending in progress")],
  );

  broadcastCampaignSummaryEvent(campaignResult.rows?.[0] || null);
}

async function finalizeCampaign(campaignId, status, lastMessage) {
  const normalized = String(status || "completed").toLowerCase();
  const result = await dbPool.query(
    `
      UPDATE campaigns
      SET status = $2,
          completed_at = CASE WHEN $2 IN ('completed', 'failed', 'stopped') THEN NOW() ELSE completed_at END,
          updated_at = NOW(),
          last_message = $3
      WHERE id = $1
      RETURNING *
    `,
    [campaignId, normalized, String(lastMessage || "")],
  );

  broadcastCampaignSummaryEvent(result.rows?.[0] || null);
}

async function requestCampaignStop(channel, campaignId = "") {
  ensureDbAvailable();

  const params = [channel];
  let whereSql = `channel = $1`;
  if (campaignId) {
    params.push(String(campaignId));
    whereSql += ` AND id = $2`;
  }

  const target = await dbPool.query(
    `
      SELECT id, status
      FROM campaigns
      WHERE ${whereSql}
      ORDER BY created_at DESC
      LIMIT 1
    `,
    params,
  );

  const found = target.rows?.[0] || null;
  if (!found) {
    return null;
  }

  const status = String(found.status || "").toLowerCase();
  if (CAMPAIGN_STATUS_TERMINAL.has(status)) {
    return await getCampaignById(found.id);
  }

  await dbPool.query(
    `
      UPDATE campaigns
      SET stop_requested = TRUE,
          status = CASE WHEN status = 'queued' THEN 'stopped' ELSE status END,
          completed_at = CASE WHEN status = 'queued' THEN NOW() ELSE completed_at END,
          updated_at = NOW(),
          last_message = CASE WHEN status = 'queued' THEN 'Stopped' ELSE 'Stop requested' END
      WHERE id = $1
    `,
    [found.id],
  );

  const campaign = await getCampaignById(found.id);
  broadcastCampaignSummaryEvent(campaign);
  return campaign;
}

async function shouldStopCampaign(campaignId) {
  const current = await getCampaignById(campaignId);
  if (!current) {
    return true;
  }
  return Boolean(current.stop_requested);
}

async function processWhatsappRecipient(campaign, recipientRow, attemptIndex) {
  const payload = campaign.payload_json && typeof campaign.payload_json === "object" ? campaign.payload_json : {};
  const templateName = String(payload.templateName || "").trim();
  const valueMappings = payload.valueMappings && typeof payload.valueMappings === "object" ? payload.valueMappings : {};
  const rowData = sanitizeRowObject(recipientRow.row_data);
  const recipientPhoneNumber = normalizePhone(recipientRow.recipient);
  const valueOverrides = buildValueOverridesFromMapping(rowData, valueMappings);

  if (!/^\d{10,15}$/.test(recipientPhoneNumber)) {
    pushMessage(recipientPhoneNumber || `invalid-${Date.now()}-${Math.random()}`, {
      id: `bulk-failed-${Date.now()}-${Math.random()}`,
      direction: "outbound",
      type: "template",
      text: buildTemplateMessagePreview(templateName, valueOverrides),
      media: getTemplateMediaPreview(templateName, valueOverrides),
      templateName,
      status: "Failed",
      statusDetails: "Invalid phone number.",
      timestamp: new Date().toISOString(),
    });

    return {
      status: "failed",
      errorText: "Invalid phone number.",
      lastMessage: "Invalid phone skipped",
    };
  }

  const missingValues = getMissingTemplateValues(templateName, valueOverrides);
  if (missingValues.length) {
    const errorText = `Template values required: ${missingValues.join(", ")}.`;
    pushMessage(recipientPhoneNumber, {
      id: `bulk-failed-${Date.now()}-${Math.random()}`,
      direction: "outbound",
      type: "template",
      text: buildTemplateMessagePreview(templateName, valueOverrides),
      media: getTemplateMediaPreview(templateName, valueOverrides),
      templateName,
      status: "Failed",
      statusDetails: errorText,
      timestamp: new Date().toISOString(),
    });

    return {
      status: "failed",
      errorText,
      lastMessage: "Template value missing",
    };
  }

  if (attemptIndex > 0) {
    await sleep(BULK_SEND_DELAY_MS);
  }

  const result = await sendTemplate(templateName, recipientPhoneNumber, valueOverrides);
  pushMessage(recipientPhoneNumber, {
    id: result.receipts?.[0]?.messageId || `${Date.now()}-${Math.random()}`,
    direction: "outbound",
    type: "template",
    text: buildTemplateMessagePreview(templateName, valueOverrides),
    media: getTemplateMediaPreview(templateName, valueOverrides),
    templateName,
    status: "Sent",
    timestamp: new Date().toISOString(),
  });
  (result.receipts || []).forEach((receipt) => {
    if (receipt.messageId) {
      outboundIndex.set(String(receipt.messageId), getConversationId(recipientPhoneNumber));
    }
  });

  return {
    status: "sent",
    providerMessageId: result.receipts?.[0]?.messageId || null,
    lastMessage: "Sending in progress",
  };
}

async function processEmailRecipient(campaign, recipientRow, attemptIndex, transporterContext) {
  const payload = campaign.payload_json && typeof campaign.payload_json === "object" ? campaign.payload_json : {};
  const subjectTemplate = String(payload.subjectTemplate || "").trim();
  const bodyTemplate = String(payload.bodyTemplate || "").trim();
  const bodyFormat = normalizeEmailBodyFormat(payload.bodyFormat);
  const smtpProvider = resolveSmtpProvider(payload.smtpProvider);
  const requestedFrom = String(payload.mailFrom || "").trim();
  const requestedReplyTo = String(payload.replyTo || "").trim();
  const sendRatePerMinute = normalizeSmtpSendRatePerMinute(payload.sendRatePerMinute);
  const sendDelayMs = getSmtpSendDelayMs(sendRatePerMinute);
  const trackingBaseUrl = String(payload.baseUrl || "").trim();
  const campaignId = String(campaign.id || "").trim();
  const rowIndex = Number.isFinite(Number(recipientRow?.row_index)) ? Number(recipientRow.row_index) : null;
  const rowData = sanitizeRowObject(recipientRow.row_data);
  const recipient = normalizeEmail(recipientRow.recipient);

  const preflight = await preflightEmailDeliverability(recipient);
  if (!preflight.ok && EMAIL_VERIFY_ENFORCE) {
    await logEmailRejection({
      campaignId,
      recipient,
      gate: String(preflight.gate || "preflight"),
      verdict: String(preflight.verdict || "rejected"),
      reason: preflight.reason,
      source: "preflight",
      rowIndex,
      rowData,
    });
    return {
      status: "failed",
      errorText: preflight.reason,
      lastMessage: `Precheck failed: ${preflight.gate}`,
    };
  }

  if (attemptIndex > 0) {
    await sleep(sendDelayMs);
  }

  const mergedRow = buildEmailTemplateContext(rowData, {
    recipient,
    campaignId,
  });
  const subject = interpolateTemplate(subjectTemplate, mergedRow);
  const emailBodies = buildEmailBodiesFromTemplate(bodyTemplate, mergedRow, bodyFormat);
  const trackedEmailBodies = applyEmailEngagementTracking(emailBodies, {
    campaignId,
    recipient,
    rowIndex,
    baseUrl: trackingBaseUrl,
  });
  const headers = buildListUnsubscribeHeaders(recipient, { campaignId });

  let info;
  try {
    const fromAddress = resolveSmtpFromAddress(smtpProvider, requestedFrom, transporterContext.fromAddress);
    const fromHeader = buildSmtpFromHeader(fromAddress, transporterContext.fromName || "");
    const replyToAddress = resolveSmtpReplyToAddress(requestedReplyTo, transporterContext.replyToAddress);
    info = await withTimeout(
      transporterContext.transporter.sendMail({
        from: fromHeader,
        to: recipient,
        replyTo: replyToAddress || undefined,
        subject: subject || "Notification",
        html: trackedEmailBodies.html,
        text: trackedEmailBodies.text,
        headers: Object.keys(headers).length ? headers : undefined,
      }),
      SMTP_SEND_TIMEOUT_MS,
      "SMTP send timeout",
    );
  } catch (error) {
    const errorText = String(error?.message || "Send failed.");
    const hardBounce = isLikelyHardBounceError(errorText);
    if (hardBounce) {
      rememberSuppressedRecipient(recipient, errorText, {
        source: "smtp_send",
      });
      await logEmailRejection({
        campaignId,
        recipient,
        gate: "smtp_send",
        verdict: "undeliverable",
        reason: errorText,
        source: "smtp_send",
        rowIndex,
        rowData,
      });
    }
    throw error;
  }

  return {
    status: "sent",
    providerMessageId: String(info.messageId || ""),
    lastMessage: "Sending in progress",
  };
}

async function runCampaign(campaign) {
  const channel = String(campaign.channel || "").toLowerCase();
  const campaignId = String(campaign.id || "").trim();
  if (!campaignId) {
    return;
  }

  const payload = campaign.payload_json && typeof campaign.payload_json === "object" ? campaign.payload_json : {};
  if (channel === CAMPAIGN_CHANNEL_WHATSAPP && !TEMPLATE_KEYS[String(payload.templateName || "").trim()]) {
    await finalizeCampaign(campaignId, "failed", "Invalid template configuration");
    return;
  }

  if (
    channel === CAMPAIGN_CHANNEL_EMAIL &&
    (!String(payload.subjectTemplate || "").trim() || !String(payload.bodyTemplate || "").trim())
  ) {
    await finalizeCampaign(campaignId, "failed", "Subject/body template missing");
    return;
  }

  let attemptIndex = 0;
  let transporterContext = null;

  if (channel === CAMPAIGN_CHANNEL_EMAIL) {
    const smtpProvider = resolveSmtpProvider(payload.smtpProvider);
    transporterContext = createSmtpTransporter(smtpProvider);
    if (!transporterContext.fromAddress) {
      await finalizeCampaign(campaignId, "failed", `SMTP from address missing for ${smtpProvider} provider.`);
      return;
    }
    await withTimeout(transporterContext.transporter.verify(), SMTP_VERIFY_TIMEOUT_MS, "SMTP verify timeout");
  }

  while (true) {
    if (await shouldStopCampaign(campaignId)) {
      await finalizeCampaign(campaignId, "stopped", "Stopped by user");
      return;
    }

    const recipientRow = await claimNextRecipient(campaignId);
    if (!recipientRow) {
      await finalizeCampaign(campaignId, "completed", "Campaign completed");
      return;
    }

    try {
      const result =
        channel === CAMPAIGN_CHANNEL_WHATSAPP
          ? await processWhatsappRecipient(campaign, recipientRow, attemptIndex)
          : await processEmailRecipient(campaign, recipientRow, attemptIndex, transporterContext);

      attemptIndex += 1;
      await completeRecipient(campaignId, recipientRow.id, result);
    } catch (error) {
      await completeRecipient(campaignId, recipientRow.id, {
        status: "failed",
        errorText: error.message || "Send failed.",
        lastMessage: error.message || "Send failed",
      });
    }
  }
}

async function processCampaignQueue(channel) {
  if (campaignWorkers.get(channel)) {
    return;
  }

  campaignWorkers.set(channel, true);
  try {
    while (true) {
      const campaign = await claimNextCampaign(channel);
      if (!campaign) {
        break;
      }

      try {
        await runCampaign(campaign);
      } catch (error) {
        await finalizeCampaign(campaign.id, "failed", error.message || "Campaign failed");
      }
    }
  } finally {
    campaignWorkers.delete(channel);
  }
}

async function resetProcessingRecipientsOnStartup() {
  ensureDbAvailable();
  await dbPool.query(
    `
      UPDATE campaign_recipients
      SET status = 'pending',
          updated_at = NOW()
      WHERE status = 'processing'
    `,
  );
}

function googleSheetCsvUrl(sheetUrl) {
  const url = new URL(sheetUrl);
  const match = url.pathname.match(/\/spreadsheets\/d\/([^/]+)/);

  if (!match) {
    throw new Error("Enter a valid Google Sheet URL.");
  }

  const gid = url.searchParams.get("gid") || "0";
  return `https://docs.google.com/spreadsheets/d/${match[1]}/export?format=csv&gid=${gid}`;
}

function getTemplates() {
  return Object.keys(TEMPLATE_KEYS).map((name) => {
    const template = buildTemplateDefinition(name);
    return {
      name,
      label: name
        .split("_")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" "),
      language: template.language,
      values: template.values.filter((value) => ["text", "quickAction"].includes(value.kind)),
      bindings: template.bindings,
    };
  });
}

function getMissingTemplateValues(templateName, valueOverrides = {}) {
  const template = buildTemplateDefinition(templateName);
  return template.values
    .filter((value) => ["text", "quickAction", "image", "document", "video"].includes(value.kind))
    .map((value) => value.name)
    .filter((name) => {
      const templateValue = template.values.find((value) => value.name === name);
      const override = String(valueOverrides[name] ?? "").trim();
      const existingUrl = String(templateValue?.url || "").trim();
      const existingText = String(templateValue?.text || "").trim();
      return !override && !existingUrl && !existingText;
    });
}

async function handleApi(req, res) {
  const routePath = String(req.url || "").split("?")[0];

  if (req.method === "GET" && routePath === EMAIL_TRACKING_OPEN_ROUTE_PATH) {
    const parsedUrl = new URL(req.url, "http://localhost");
    const token = String(parsedUrl.searchParams.get("token") || "").trim();

    try {
      const tracking = parseEmailTrackingToken(token, "open");
      await logEmailEngagementEvent({
        campaignId: tracking.campaignId,
        recipient: tracking.recipient,
        eventType: "open",
        rowIndex: tracking.rowIndex,
        tokenHash: tracking.tokenHash,
        userAgent: String(req.headers["user-agent"] || "").trim(),
        referer: String(req.headers.referer || req.headers.referrer || "").trim(),
        ipAddress: getRequestIpAddress(req),
      });

      broadcastInboxEvent({
        type: "email_analytics",
        channel: CAMPAIGN_CHANNEL_EMAIL,
        campaignId: tracking.campaignId,
        eventType: "open",
      });
    } catch {
      // Intentionally return tracking pixel for invalid tokens as well.
    }

    res.writeHead(200, {
      "Content-Type": "image/gif",
      "Content-Length": EMAIL_TRACKING_PIXEL_BUFFER.length,
      "Cache-Control": "no-store, no-cache, must-revalidate, private, max-age=0",
      Pragma: "no-cache",
      Expires: "0",
    });
    res.end(EMAIL_TRACKING_PIXEL_BUFFER);
    return true;
  }

  if (req.method === "GET" && routePath === EMAIL_TRACKING_CLICK_ROUTE_PATH) {
    const parsedUrl = new URL(req.url, "http://localhost");
    const token = String(parsedUrl.searchParams.get("token") || "").trim();
    const targetUrl = normalizeTrackableTargetUrl(parsedUrl.searchParams.get("url") || "");

    try {
      const tracking = parseEmailTrackingToken(token, "click");
      if (!targetUrl) {
        throw new Error("Invalid click target URL.");
      }
      if (!tracking.urlHash || tracking.urlHash !== hashTrackingValue(targetUrl)) {
        throw new Error("Tracking URL signature mismatch.");
      }

      await logEmailEngagementEvent({
        campaignId: tracking.campaignId,
        recipient: tracking.recipient,
        eventType: "click",
        targetUrl,
        rowIndex: tracking.rowIndex,
        tokenHash: tracking.tokenHash,
        userAgent: String(req.headers["user-agent"] || "").trim(),
        referer: String(req.headers.referer || req.headers.referrer || "").trim(),
        ipAddress: getRequestIpAddress(req),
      });

      broadcastInboxEvent({
        type: "email_analytics",
        channel: CAMPAIGN_CHANNEL_EMAIL,
        campaignId: tracking.campaignId,
        eventType: "click",
      });

      res.writeHead(302, {
        Location: targetUrl,
        "Cache-Control": "no-store, no-cache, must-revalidate, private, max-age=0",
        Pragma: "no-cache",
        Expires: "0",
      });
      res.end();
    } catch (error) {
      res.writeHead(400, {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store, no-cache, must-revalidate, private, max-age=0",
      });
      res.end(error.message || "Invalid tracking link.");
    }
    return true;
  }

  if (req.method === "GET" && req.url === "/api/config") {
    try {
      const smtpProviderOptions = getSmtpProviderOptions();
      const smtpDefaultProvider = getPrimarySmtpProvider();
      const smtpProviderStatuses = smtpProviderOptions.map((provider) => {
        const config = getSmtpConfig(provider);
        return {
          provider,
          host: String(config.host || "").trim(),
          port: Number(config.port || 0),
          from: String(config.from || "").trim(),
          fromName: normalizeSmtpFromName(config.fromName || ""),
          replyTo: String(config.replyTo || "").trim(),
          profileName: String(config.profileName || "").trim(),
          profileId: String(config.profileId || "").trim(),
          configured: Boolean(config.host && config.port),
          isDefault: provider === smtpDefaultProvider,
        };
      });
      const smtpConfigured = smtpProviderStatuses.some((item) => item.configured);
      const smtpFromOptionsByProvider = Object.fromEntries(
        smtpProviderOptions.map((provider) => [provider, getSmtpFromOptions(provider)]),
      );
      const smtpDefaultFromByProvider = Object.fromEntries(
        smtpProviderOptions.map((provider) => [provider, getSmtpConfig(provider).from]),
      );
      const smtpDefaultReplyToByProvider = Object.fromEntries(
        smtpProviderOptions.map((provider) => [provider, getSmtpConfig(provider).replyTo || ""]),
      );
      const smtpCredentials = await listSmtpCredentialProfiles();
      sendJson(res, 200, {
        templates: getTemplates(),
        defaultRecipient: process.env.RECIPIENT_PHONE_NUMBER || "",
        smtpSendRatePerMinute: DEFAULT_SMTP_SEND_RATE_PER_MINUTE,
        smtpConfigured,
        smtpProviderOptions,
        smtpDefaultProvider,
        smtpProviderStatuses,
        smtpFromOptionsByProvider,
        smtpDefaultFromByProvider,
        smtpDefaultReplyToByProvider,
        smtpCredentials,
        emailVerification: {
          mode: EMAIL_VERIFY_MODE,
          enforce: EMAIL_VERIFY_ENFORCE,
          rejectRisky: EMAIL_VERIFY_REJECT_RISKY,
          allowAFallback: EMAIL_VERIFY_ALLOW_A_FALLBACK,
          smtpProbeEnabled: isEmailSmtpProbeEnabled(),
          smtpProbeMaxMxHosts: EMAIL_VERIFY_SMTP_MAX_MX_TO_TRY,
          suppressionEnabled: EMAIL_SUPPRESSION_ENABLED,
          suppressedCount: suppressedEmailRecipients.size,
        },
      });
    } catch (error) {
      sendJson(res, 500, { error: error.message || "Failed to read configuration." });
    }
    return true;
  }

  if (req.method === "POST" && routePath === "/api/smtp-default-provider") {
    try {
      const rawBody = await readRequestBody(req);
      const payload = rawBody ? JSON.parse(rawBody) : {};
      const provider = setPrimarySmtpProvider(payload.provider);

      sendJson(res, 200, {
        ok: true,
        provider,
      });
    } catch (error) {
      sendJson(res, error.statusCode || 500, { error: error.message || "Failed to set SMTP default provider." });
    }
    return true;
  }

  if (req.method === "GET" && routePath === "/api/smtp-credentials") {
    try {
      const smtpCredentials = await listSmtpCredentialProfiles();
      sendJson(res, 200, { ok: true, items: smtpCredentials });
    } catch (error) {
      sendJson(res, error.statusCode || 500, { error: error.message || "Failed to load SMTP credentials." });
    }
    return true;
  }

  if (req.method === "POST" && routePath === "/api/smtp-credentials") {
    try {
      const rawBody = await readRequestBody(req);
      const payload = rawBody ? JSON.parse(rawBody) : {};
      const item = await createSmtpCredentialProfile(payload);
      sendJson(res, 201, { ok: true, item });
    } catch (error) {
      sendJson(res, error.statusCode || 500, { error: error.message || "Failed to create SMTP credential." });
    }
    return true;
  }

  const smtpCredentialActivateMatch = routePath.match(/^\/api\/smtp-credentials\/([^/]+)\/activate$/i);
  if (req.method === "POST" && smtpCredentialActivateMatch) {
    try {
      const profileId = decodeURIComponent(String(smtpCredentialActivateMatch[1] || "")).trim();
      const item = await activateSmtpCredentialProfile(profileId);
      sendJson(res, 200, { ok: true, item });
    } catch (error) {
      sendJson(res, error.statusCode || 500, { error: error.message || "Failed to activate SMTP credential." });
    }
    return true;
  }

  const smtpCredentialItemMatch = routePath.match(/^\/api\/smtp-credentials\/([^/]+)$/i);
  if (smtpCredentialItemMatch && req.method === "PUT") {
    try {
      const profileId = decodeURIComponent(String(smtpCredentialItemMatch[1] || "")).trim();
      const rawBody = await readRequestBody(req);
      const payload = rawBody ? JSON.parse(rawBody) : {};
      const item = await updateSmtpCredentialProfile(profileId, payload);
      sendJson(res, 200, { ok: true, item });
    } catch (error) {
      sendJson(res, error.statusCode || 500, { error: error.message || "Failed to update SMTP credential." });
    }
    return true;
  }

  if (smtpCredentialItemMatch && req.method === "DELETE") {
    try {
      const profileId = decodeURIComponent(String(smtpCredentialItemMatch[1] || "")).trim();
      const item = await deleteSmtpCredentialProfile(profileId);
      sendJson(res, 200, { ok: true, item });
    } catch (error) {
      sendJson(res, error.statusCode || 500, { error: error.message || "Failed to delete SMTP credential." });
    }
    return true;
  }

  if (req.method === "POST" && req.url === "/api/send") {
    let templateName = "";
    let recipientPhoneNumber = "";
    let valueOverrides = {};
    try {
      const rawBody = await readRequestBody(req);
      const payload = rawBody ? JSON.parse(rawBody) : {};
      templateName = String(payload.templateName || "").trim();
      recipientPhoneNumber = normalizePhone(payload.recipientPhoneNumber);
      valueOverrides =
        payload.valueOverrides && typeof payload.valueOverrides === "object" ? payload.valueOverrides : {};

      if (!TEMPLATE_KEYS[templateName]) {
        sendJson(res, 400, { error: "Select a valid template." });
        return true;
      }

      if (!/^\d{10,15}$/.test(recipientPhoneNumber)) {
        sendJson(res, 400, {
          error: "Enter a valid phone number with country code, without plus sign.",
        });
        return true;
      }

      const missingValues = getMissingTemplateValues(templateName, valueOverrides);
      if (missingValues.length) {
        sendJson(res, 400, {
          error: `Template values required: ${missingValues.join(", ")}.`,
        });
        return true;
      }

      const result = await sendTemplate(templateName, recipientPhoneNumber, valueOverrides);
      pushMessage(recipientPhoneNumber, {
        id: result.receipts?.[0]?.messageId || `${Date.now()}-${Math.random()}`,
        direction: "outbound",
        type: "template",
        text: buildTemplateMessagePreview(templateName, valueOverrides),
        media: getTemplateMediaPreview(templateName, valueOverrides),
        templateName,
        status: "Sent",
        timestamp: new Date().toISOString(),
      });
      (result.receipts || []).forEach((receipt) => {
        if (receipt.messageId) {
          outboundIndex.set(String(receipt.messageId), getConversationId(recipientPhoneNumber));
        }
      });
      sendJson(res, 200, {
        ok: true,
        message: `Template "${templateName}" sent to ${recipientPhoneNumber}.`,
        values: valueOverrides,
        receipts: result.receipts,
      });
    } catch (error) {
      if (recipientPhoneNumber || templateName) {
        pushMessage(recipientPhoneNumber || `send-failed-${Date.now()}`, {
          id: `send-failed-${Date.now()}-${Math.random()}`,
          direction: "outbound",
          type: "template",
          text: buildTemplateMessagePreview(templateName, valueOverrides),
          media: getTemplateMediaPreview(templateName, valueOverrides),
          templateName,
          status: "Failed",
          statusDetails: error.message || "Failed to send message.",
          timestamp: new Date().toISOString(),
        });
      }
      sendJson(res, 500, { error: error.message || "Failed to send message." });
    }
    return true;
  }

  if (req.method === "POST" && req.url === "/api/contacts/sheet") {
    try {
      const rawBody = await readRequestBody(req);
      const payload = rawBody ? JSON.parse(rawBody) : {};
      const sheetUrl = String(payload.sheetUrl || "").trim();
      const rowLimit = Number(payload.rowLimit);

      if (!sheetUrl) {
        sendJson(res, 400, { error: "Google Sheet URL is required." });
        return true;
      }

      const csvResponse = await fetch(googleSheetCsvUrl(sheetUrl));
      if (!csvResponse.ok) {
        throw new Error("Could not read Google Sheet. Share it publicly or publish it as CSV.");
      }

      const csvBuffer = Buffer.from(await csvResponse.arrayBuffer());
      sendJson(
        res,
        200,
        workbookToContacts(csvBuffer, {
          rowLimit,
        }),
      );
    } catch (error) {
      sendJson(res, 500, { error: error.message || "Failed to parse Google Sheet." });
    }
    return true;
  }

  if (req.method === "POST" && req.url.startsWith("/api/contacts/upload")) {
    try {
      const parsedUrl = new URL(req.url, "http://localhost");
      const sheetName = String(parsedUrl.searchParams.get("sheetName") || "").trim();
      const sheetIndexRaw = Number(parsedUrl.searchParams.get("sheetIndex"));
      const sheetIndex = Number.isFinite(sheetIndexRaw) ? Math.max(0, Math.floor(sheetIndexRaw)) : 0;
      const rowLimit = Number(parsedUrl.searchParams.get("rowLimit"));
      const buffer = await readRequestBuffer(req);
      sendJson(
        res,
        200,
        workbookToContacts(buffer, {
          sheetName,
          sheetIndex,
          rowLimit,
        }),
      );
    } catch (error) {
      sendJson(res, 500, { error: error.message || "Failed to parse uploaded file." });
    }
    return true;
  }

  if (req.method === "GET" && req.url.startsWith("/api/smtp/live-summary")) {
    try {
      const parsedUrl = new URL(req.url, "http://localhost");
      const campaignId = String(parsedUrl.searchParams.get("campaignId") || "").trim();
      const summary = await getLiveCampaignSummary(CAMPAIGN_CHANNEL_EMAIL, campaignId);
      sendJson(res, 200, summary);
    } catch (error) {
      sendJson(res, 500, { error: error.message || "Failed to load SMTP live summary." });
    }
    return true;
  }

  if (req.method === "GET" && req.url.startsWith("/api/whatsapp/live-summary")) {
    try {
      const parsedUrl = new URL(req.url, "http://localhost");
      const campaignId = String(parsedUrl.searchParams.get("campaignId") || "").trim();
      const summary = await getLiveCampaignSummary(CAMPAIGN_CHANNEL_WHATSAPP, campaignId);
      sendJson(res, 200, summary);
    } catch (error) {
      sendJson(res, 500, { error: error.message || "Failed to load WhatsApp live summary." });
    }
    return true;
  }

  if (req.method === "POST" && req.url === "/api/campaigns/stop") {
    try {
      const rawBody = await readRequestBody(req);
      const payload = rawBody ? JSON.parse(rawBody) : {};
      const channel = String(payload.channel || "").trim().toLowerCase();
      const campaignId = String(payload.campaignId || "").trim();

      if (![CAMPAIGN_CHANNEL_WHATSAPP, CAMPAIGN_CHANNEL_EMAIL].includes(channel)) {
        sendJson(res, 400, { error: "Valid channel is required (whatsapp/email)." });
        return true;
      }

      const campaign = await requestCampaignStop(channel, campaignId);
      if (!campaign) {
        sendJson(res, 404, { error: "Campaign not found." });
        return true;
      }

      sendJson(res, 200, {
        ok: true,
        campaignId: campaign.id,
        summary: buildCampaignSummary(campaign),
      });
    } catch (error) {
      sendJson(res, 500, { error: error.message || "Failed to stop campaign." });
    }
    return true;
  }

  if (req.method === "POST" && req.url === "/api/send-smtp-test") {
    try {
      const rawBody = await readRequestBody(req);
      const payload = rawBody ? JSON.parse(rawBody) : {};
      const smtpProvider = resolveSmtpProvider(payload.smtpProvider);
      const recipientColumn = String(payload.recipientColumn || "").trim();
      const subjectTemplate = String(payload.subjectTemplate || "").trim();
      const bodyTemplate = String(payload.bodyTemplate || "").trim();
      const bodyFormat = normalizeEmailBodyFormat(payload.bodyFormat);
      const requestedFrom = String(payload.mailFrom || "").trim();
      const requestedReplyTo = String(payload.replyTo || "").trim();
      const row = payload.row && typeof payload.row === "object" ? payload.row : {};
      const testRecipient = normalizeEmail(
        String(payload.testRecipient || process.env.SMTP_TEST_RECIPIENT || "").trim(),
      );

      if (!subjectTemplate || !bodyTemplate) {
        sendJson(res, 400, {
          error: "Subject template and body template are required.",
        });
        return true;
      }

      updateSmtpTestState({
        inProgress: true,
        lastMessage: "Sending test email",
      });

      if (!isValidEmail(testRecipient)) {
        sendJson(res, 400, {
          error: "Set SMTP_TEST_RECIPIENT with a valid email in .env.",
        });
        return true;
      }

      const { transporter, fromAddress, replyToAddress: defaultReplyToAddress } = createSmtpTransporter(smtpProvider);
      if (!fromAddress) {
        sendJson(res, 400, { error: `SMTP sender is required for active ${smtpProvider} profile.` });
        return true;
      }
      const finalFrom = resolveSmtpFromAddress(smtpProvider, requestedFrom, fromAddress);
      const fromHeader = buildSmtpFromHeader(finalFrom, getSmtpConfig(smtpProvider).fromName || "");
      const finalReplyTo = resolveSmtpReplyToAddress(requestedReplyTo, defaultReplyToAddress);
      const appBaseUrl = getAppBaseUrl(req);

      await withTimeout(transporter.verify(), SMTP_VERIFY_TIMEOUT_MS, "SMTP verify timeout");

      const sampleRecipient = recipientColumn ? normalizeEmail(getCell(row, recipientColumn)) : "";
      const mergedRow = buildEmailTemplateContext(
        {
          ...row,
          recipientEmail: sampleRecipient,
        },
        {
          recipient: sampleRecipient || testRecipient,
          baseUrl: appBaseUrl,
        },
      );
      const subject = interpolateTemplate(subjectTemplate, mergedRow);
      const emailBodies = buildEmailBodiesFromTemplate(bodyTemplate, mergedRow, bodyFormat);
      const headers = SMTP_TEST_INCLUDE_LIST_UNSUBSCRIBE
        ? buildListUnsubscribeHeaders(sampleRecipient || testRecipient, {
            baseUrl: appBaseUrl,
          })
        : {};

      const info = await withTimeout(
        transporter.sendMail({
          from: fromHeader,
          to: testRecipient,
          replyTo: finalReplyTo || undefined,
          subject: subject || "SMTP Test",
          html: emailBodies.html,
          text: emailBodies.text,
          headers: Object.keys(headers).length ? headers : undefined,
        }),
        SMTP_SEND_TIMEOUT_MS,
        "SMTP send timeout",
      );

      sendJson(res, 200, {
        ok: true,
        testRecipient,
        messageId: String(info.messageId || ""),
      });
      updateSmtpTestState({
        inProgress: false,
        lastMessage: "Test email sent",
        lastTestRecipient: testRecipient,
        lastTestAt: new Date().toISOString(),
      });
    } catch (error) {
      updateSmtpTestState({
        inProgress: false,
        lastMessage: error.message || "Test email failed",
      });
      sendJson(res, 500, { error: error.message || "Failed to send SMTP test email." });
    }
    return true;
  }

  if (req.method === "POST" && req.url === "/api/send-smtp-bulk") {
    try {
      const rawBody = await readRequestBody(req);
      const payload = rawBody ? JSON.parse(rawBody) : {};
      const smtpProvider = resolveSmtpProvider(payload.smtpProvider);
      const recipientColumn = String(payload.recipientColumn || "").trim();
      const subjectTemplate = String(payload.subjectTemplate || "").trim();
      const bodyTemplate = String(payload.bodyTemplate || "").trim();
      const bodyFormat = normalizeEmailBodyFormat(payload.bodyFormat);
      const sendRatePerMinute = normalizeSmtpSendRatePerMinute(payload.sendRatePerMinute);
      const requestedFrom = String(payload.mailFrom || "").trim();
      const requestedReplyTo = String(payload.replyTo || "").trim();
      const rows = Array.isArray(payload.rows) ? payload.rows.slice(0, SMTP_BULK_MAX_ROWS) : [];
      const publicBaseUrl = (await resolvePublicBaseUrl(req)) || getAppBaseUrl(req);
      const trackingBaseUrl = String(publicBaseUrl || "").trim();
      const trackingBaseLooksLocal = /^https?:\/\/(localhost|127(?:\.\d+){3})(?::\d+)?/i.test(trackingBaseUrl);

      if (!recipientColumn || !rows.length || !subjectTemplate || !bodyTemplate) {
        sendJson(res, 400, {
          error: "Recipient column, templates, and audience rows are required.",
        });
        return true;
      }

      const campaignPayload = {
        smtpProvider,
        recipientColumn,
        subjectTemplate,
        bodyTemplate,
        bodyFormat,
        sendRatePerMinute,
        baseUrl: trackingBaseUrl,
        mailFrom: resolveSmtpFromAddress(smtpProvider, requestedFrom, getSmtpConfig(smtpProvider).from),
        replyTo: resolveSmtpReplyToAddress(requestedReplyTo, getSmtpConfig(smtpProvider).replyTo),
      };
      let campaignId;
      let queuedInAzure = false;

      if (emailQueueRuntime.enabled) {
        campaignId = await createEmailCampaignRecord(campaignPayload, rows.length, rows, recipientColumn);
        queuedInAzure = await enqueueEmailCampaignTasks(campaignId, campaignPayload, rows, recipientColumn);
      }

      if (!queuedInAzure) {
        campaignId = await createCampaignWithRecipients(
          CAMPAIGN_CHANNEL_EMAIL,
          campaignPayload,
          rows,
          recipientColumn,
        );
        void processCampaignQueue(CAMPAIGN_CHANNEL_EMAIL);
      }

      const campaign = await getCampaignById(campaignId);
      sendJson(res, 202, {
        ok: true,
        campaignId,
        dispatchMode: queuedInAzure ? "azure_queue_tasks" : "in_process",
        summary: buildCampaignSummary(campaign),
        tracking: {
          baseUrl: trackingBaseUrl,
          publicReachable: !trackingBaseLooksLocal,
        },
        trackingWarning: trackingBaseLooksLocal
          ? "Tracking base URL is local (localhost/127.0.0.1). For real open/click analytics set PUBLIC_BASE_URL or run ngrok."
          : "",
        emailValidation: {
          mode: EMAIL_VERIFY_MODE,
          enforce: EMAIL_VERIFY_ENFORCE,
          rejectRisky: EMAIL_VERIFY_REJECT_RISKY,
          smtpProbe: isEmailSmtpProbeEnabled(),
        },
        rejectedListEndpoint: `/api/email-rejections?campaignId=${encodeURIComponent(String(campaignId || ""))}`,
      });
    } catch (error) {
      sendJson(res, 500, { error: error.message || "Failed to send SMTP bulk campaign." });
    }
    return true;
  }

  if (req.method === "POST" && req.url === "/api/send-bulk") {
    try {
      const rawBody = await readRequestBody(req);
      const payload = rawBody ? JSON.parse(rawBody) : {};
      const templateName = String(payload.templateName || "").trim();
      const phoneColumn = String(payload.phoneColumn || "").trim();
      const valueMappings =
        payload.valueMappings && typeof payload.valueMappings === "object" ? payload.valueMappings : {};
      const rows = Array.isArray(payload.rows) ? payload.rows.slice(0, 1000) : [];

      if (!TEMPLATE_KEYS[templateName]) {
        sendJson(res, 400, { error: "Select a valid template." });
        return true;
      }

      if (!phoneColumn || !rows.length) {
        sendJson(res, 400, { error: "Contacts and phone column are required." });
        return true;
      }

      const campaignPayload = {
        templateName,
        phoneColumn,
        valueMappings,
      };
      const campaignId = await createCampaignWithRecipients(
        CAMPAIGN_CHANNEL_WHATSAPP,
        campaignPayload,
        rows,
        phoneColumn,
      );

      void processCampaignQueue(CAMPAIGN_CHANNEL_WHATSAPP);

      const campaign = await getCampaignById(campaignId);
      sendJson(res, 202, {
        ok: true,
        campaignId,
        summary: buildCampaignSummary(campaign),
      });
    } catch (error) {
      sendJson(res, 500, { error: error.message || "Failed to send bulk messages." });
    }
    return true;
  }

  if (req.method === "POST" && req.url === "/api/uploads") {
    try {
      const rawName = decodeURIComponent(String(req.headers["x-file-name"] || "").trim());
      const fileName = sanitizeFileName(rawName);
      if (!fileName) {
        sendJson(res, 400, { error: "File name is required." });
        return true;
      }

      const data = await readRequestBuffer(req, MAX_UPLOAD_SIZE_BYTES);
      if (!data.length) {
        sendJson(res, 400, { error: "Uploaded file is empty." });
        return true;
      }
      if (data.length > MAX_UPLOAD_SIZE_BYTES) {
        sendJson(res, 413, { error: "File too large. Max 20 MB." });
        return true;
      }

      const ext = getExt(fileName);
      const mimeHeader = String(req.headers["x-file-type"] || "").trim().toLowerCase();
      const mimeType = mimeHeader || getMimeTypeFromExt(ext);
      const mediaKind = getMediaKindFromMime(mimeType, fileName);

      const publicBase = await resolvePublicBaseUrl(req);
      if (!publicBase) {
        sendJson(res, 400, {
          error:
            "Public base URL not found. Either set PUBLIC_BASE_URL in .env or run ngrok on this machine (agent API on 127.0.0.1:4040).",
        });
        return true;
      }

      ensureUploadDir();
      const storedName = `${Date.now()}-${crypto.randomUUID()}${ext || ".bin"}`;
      const storedPath = path.join(UPLOAD_DIR, storedName);
      fs.writeFileSync(storedPath, data);

      sendJson(res, 200, {
        ok: true,
        kind: mediaKind,
        fileName,
        mimeType,
        size: data.length,
        url: `${publicBase}/uploads/${encodeURIComponent(storedName)}`,
      });
    } catch (error) {
      sendJson(res, 500, { error: error.message || "Failed to upload file." });
    }
    return true;
  }

  if (req.method === "GET" && req.url.startsWith("/api/inbox?")) {
    try {
      const parsedUrl = new URL(req.url, "http://localhost");
      const limitRaw = Number(parsedUrl.searchParams.get("limit"));
      const offsetRaw = Number(parsedUrl.searchParams.get("offset"));
      const fullLimitRaw = Number(parsedUrl.searchParams.get("fullLimit"));
      const includeRecentConversation = parsedUrl.searchParams.get("includeRecentConversation") !== "0";
      const query = String(parsedUrl.searchParams.get("q") || "").trim();
      const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(100, Math.floor(limitRaw))) : 10;
      const offset = Number.isFinite(offsetRaw) ? Math.max(0, Math.floor(offsetRaw)) : 0;
      const fullLimit = Number.isFinite(fullLimitRaw)
        ? Math.max(20, Math.min(200, Math.floor(fullLimitRaw)))
        : 80;

      const payload = await getInboxSummaryFromDb(limit, offset, {
        includeRecentConversation,
        recentFullLimit: fullLimit,
        query,
      });

      sendJson(res, 200, payload);
    } catch (error) {
      const parsedUrl = new URL(req.url, "http://localhost");
      const limitRaw = Number(parsedUrl.searchParams.get("limit"));
      const offsetRaw = Number(parsedUrl.searchParams.get("offset"));
      const fullLimitRaw = Number(parsedUrl.searchParams.get("fullLimit"));
      const includeRecentConversation = parsedUrl.searchParams.get("includeRecentConversation") !== "0";
      const query = String(parsedUrl.searchParams.get("q") || "").trim();
      const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(100, Math.floor(limitRaw))) : 10;
      const offset = Number.isFinite(offsetRaw) ? Math.max(0, Math.floor(offsetRaw)) : 0;
      const fullLimit = Number.isFinite(fullLimitRaw)
        ? Math.max(20, Math.min(200, Math.floor(fullLimitRaw)))
        : 80;

      sendJson(
        res,
        200,
        getInboxSummary(limit, offset, {
          includeRecentConversation,
          recentFullLimit: fullLimit,
          query,
        }),
      );
    }
    return true;
  }

  if (req.method === "GET" && req.url === "/api/inbox") {
    try {
      sendJson(res, 200, await getInboxSummaryFromDb(10, 0));
    } catch {
      sendJson(res, 200, getInboxSummary(10, 0));
    }
    return true;
  }

  if (req.method === "GET" && req.url === "/api/inbox/count") {
    sendJson(res, 200, getInboxCountSummary());
    return true;
  }

  if (req.method === "GET" && req.url.startsWith("/api/dashboard/summary")) {
    try {
      const payload = await getDashboardSummaryPayload();
      sendJson(res, 200, { ok: true, ...payload });
    } catch (error) {
      sendJson(res, 500, { error: error.message || "Failed to load dashboard summary." });
    }
    return true;
  }

  if (req.method === "GET" && req.url.startsWith("/api/email-analytics/export")) {
    try {
      const parsedUrl = new URL(req.url, "http://localhost");
      const campaignId = String(parsedUrl.searchParams.get("campaignId") || "").trim();
      const daysRaw = Number(parsedUrl.searchParams.get("days"));
      const payload = await getEmailAnalyticsPayload({
        campaignId,
        days: Number.isFinite(daysRaw) ? daysRaw : undefined,
        recipientLimit: 1000,
        topLinksLimit: 200,
        detailLimit: 5000,
        detailOffset: 0,
      });

      const workbook = xlsx.utils.book_new();
      const summarySheet = xlsx.utils.json_to_sheet([
        {
          CampaignId: payload.campaignId || "all",
          Audience: payload.summary.audience,
          Processed: payload.summary.processed,
          Sent: payload.summary.sent,
          Failed: payload.summary.failed,
          Opens: payload.summary.opens,
          Clicks: payload.summary.clicks,
          UniqueOpens: payload.summary.uniqueOpens,
          UniqueClicks: payload.summary.uniqueClicks,
          OpenRate: `${payload.summary.openRate}%`,
          ClickRate: `${payload.summary.clickRate}%`,
          CTOR: `${payload.summary.ctor}%`,
          GeneratedAt: new Date(payload.generatedAt).toLocaleString(),
        },
      ]);
      xlsx.utils.book_append_sheet(workbook, summarySheet, "Summary");

      const timelineSheet = xlsx.utils.json_to_sheet(
        payload.timeline.map((item) => ({
          Day: item.day,
          Opens: item.opens,
          Clicks: item.clicks,
        })),
      );
      xlsx.utils.book_append_sheet(workbook, timelineSheet, "Timeline");

      const recipientsSheet = xlsx.utils.json_to_sheet(
        payload.recipients.map((item) => ({
          Recipient: item.recipient,
          Sent: item.sent,
          Failed: item.failed,
          Opens: item.opens,
          Clicks: item.clicks,
          OpenRate: `${item.openRate}%`,
          ClickRate: `${item.clickRate}%`,
          LastEventAt: item.lastEventAt ? new Date(item.lastEventAt).toLocaleString() : "",
        })),
      );
      xlsx.utils.book_append_sheet(workbook, recipientsSheet, "Recipients");

      const linksSheet = xlsx.utils.json_to_sheet(
        payload.topLinks.map((item) => ({
          Url: item.url,
          Clicks: item.clicks,
          UniqueClicks: item.uniqueClicks,
        })),
      );
      xlsx.utils.book_append_sheet(workbook, linksSheet, "Top Links");

      const detailSheet = xlsx.utils.json_to_sheet(
        (payload.details?.records || []).map((item) => ({
          Time: item.createdAt ? new Date(item.createdAt).toLocaleString() : "",
          Recipient: item.recipient,
          EventType: item.eventType,
          Link: item.targetUrl || "",
          TimesBySameUserAndLink: item.occurrenceCount,
          TotalBySameUserAndLink: item.totalCountForSignature,
          CampaignId: item.campaignId,
        })),
      );
      xlsx.utils.book_append_sheet(workbook, detailSheet, "Event Log");

      const buffer = xlsx.write(workbook, { type: "buffer", bookType: "xlsx" });
      res.writeHead(200, {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="email-analytics-${campaignId || "all"}-${Date.now()}.xlsx"`,
        "Content-Length": buffer.length,
      });
      res.end(buffer);
    } catch (error) {
      sendJson(res, 500, { error: error.message || "Failed to export email analytics." });
    }
    return true;
  }

  if (req.method === "GET" && req.url.startsWith("/api/email-analytics")) {
    try {
      const parsedUrl = new URL(req.url, "http://localhost");
      const campaignId = String(parsedUrl.searchParams.get("campaignId") || "").trim();
      const daysRaw = Number(parsedUrl.searchParams.get("days"));
      const range = String(parsedUrl.searchParams.get("range") || "").trim().toLowerCase();
      const recipientLimitRaw = Number(parsedUrl.searchParams.get("recipientLimit"));
      const topLinksLimitRaw = Number(parsedUrl.searchParams.get("topLinksLimit"));
      const detailLimitRaw = Number(parsedUrl.searchParams.get("detailLimit"));
      const detailOffsetRaw = Number(parsedUrl.searchParams.get("detailOffset"));
      const includeEmptyTimelineRaw = parsedUrl.searchParams.get("includeEmptyTimeline");
      const includeEmptyTimeline =
        includeEmptyTimelineRaw === null ? undefined : parseTruthyValue(includeEmptyTimelineRaw, false);

      const payload = await getEmailAnalyticsPayload({
        campaignId,
        days: Number.isFinite(daysRaw) ? daysRaw : undefined,
        range,
        includeEmptyTimeline,
        recipientLimit: Number.isFinite(recipientLimitRaw) ? recipientLimitRaw : undefined,
        topLinksLimit: Number.isFinite(topLinksLimitRaw) ? topLinksLimitRaw : undefined,
        detailLimit: Number.isFinite(detailLimitRaw) ? detailLimitRaw : undefined,
        detailOffset: Number.isFinite(detailOffsetRaw) ? detailOffsetRaw : undefined,
      });

      sendJson(res, 200, {
        ok: true,
        ...payload,
      });
    } catch (error) {
      sendJson(res, 500, { error: error.message || "Failed to load email analytics." });
    }
    return true;
  }

  if (req.method === "GET" && req.url.startsWith("/api/reports/export")) {
    try {
      const payload = await getReportPayload(2000, { includeMessageText: true });
      const workbook = xlsx.utils.book_new();
      const rows = payload.rows.map((row) => ({
        Time: new Date(row.timestamp).toLocaleString(),
        Recipient: row.participant,
        "Reply To": row.replyTo,
        Type: row.type || row.templateName || "message",
        Status: row.status,
        Reason: row.statusDetails,
        Template: row.templateName,
        Message: row.text,
      }));
      const worksheet = xlsx.utils.json_to_sheet(rows.length ? rows : [{}]);
      xlsx.utils.book_append_sheet(workbook, worksheet, "WhatsApp Report");
      const buffer = xlsx.write(workbook, { type: "buffer", bookType: "xlsx" });
      res.writeHead(200, {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="whatsapp-report-${Date.now()}.xlsx"`,
        "Content-Length": buffer.length,
      });
      res.end(buffer);
    } catch (error) {
      sendJson(res, 500, { error: error.message || "Failed to export report." });
    }
    return true;
  }

  if (req.method === "GET" && req.url.startsWith("/api/reports")) {
    try {
      const parsedUrl = new URL(req.url, "http://localhost");
      const limitRaw = Number(parsedUrl.searchParams.get("limit"));
      const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(500, Math.floor(limitRaw))) : 100;
      const summaryOnly = parsedUrl.searchParams.get("summaryOnly") === "1";
      const payload = await getReportPayload(limit, { summaryOnly, includeMessageText: false });
      sendJson(res, 200, { ok: true, ...payload });
    } catch (error) {
      sendJson(res, 500, { error: error.message || "Failed to load report." });
    }
    return true;
  }

  if (req.method === "GET" && req.url.startsWith("/api/email-rejections")) {
    try {
      const parsedUrl = new URL(req.url, "http://localhost");
      const campaignId = String(parsedUrl.searchParams.get("campaignId") || "").trim();
      const recipient = String(parsedUrl.searchParams.get("recipient") || "").trim();
      const limitRaw = Number(parsedUrl.searchParams.get("limit"));
      const offsetRaw = Number(parsedUrl.searchParams.get("offset"));
      const payload = await getEmailRejectionList({
        campaignId,
        recipient,
        limit: Number.isFinite(limitRaw) ? limitRaw : undefined,
        offset: Number.isFinite(offsetRaw) ? offsetRaw : undefined,
      });
      sendJson(res, 200, {
        ok: true,
        ...payload,
      });
    } catch (error) {
      sendJson(res, 500, { error: error.message || "Failed to load email rejection list." });
    }
    return true;
  }

  if (req.method === "GET" && req.url === "/api/inbox/stream") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write("retry: 2000\n\n");
    inboxStreamClients.add(res);

    const heartbeat = setInterval(() => {
      try {
        res.write(": ping\n\n");
      } catch {
        clearInterval(heartbeat);
        inboxStreamClients.delete(res);
      }
    }, 25000);

    req.on("close", () => {
      clearInterval(heartbeat);
      inboxStreamClients.delete(res);
    });
    return true;
  }

  if (
    req.method === "GET" &&
    req.url.startsWith("/api/inbox/") &&
    !req.url.startsWith("/api/inbox/count") &&
    !req.url.startsWith("/api/inbox/stream")
  ) {
    const parsedUrl = new URL(req.url, "http://localhost");
    const conversationId = getConversationId(
      decodeURIComponent(parsedUrl.pathname.replace("/api/inbox/", "")),
    );
    const shouldMarkRead = parsedUrl.searchParams.get("markRead") !== "0";
    const limitRaw = Number(parsedUrl.searchParams.get("limit"));
    const limit = Number.isFinite(limitRaw) ? Math.max(20, Math.min(200, Math.floor(limitRaw))) : 80;
    const conversation = shouldMarkRead ? markConversationRead(conversationId) : conversations.get(conversationId);

    if (conversation) {
      sendJson(res, 200, getConversationPayload(conversation, { limit }));
      return true;
    }

    const dbConversation = await getConversationPayloadById(conversationId, { limit });
    if (!dbConversation) {
      sendJson(res, 404, { error: "Conversation not found." });
      return true;
    }

    sendJson(res, 200, dbConversation);
    return true;
  }

  if (req.method === "POST" && req.url === "/api/reply") {
    try {
      const rawBody = await readRequestBody(req);
      const payload = rawBody ? JSON.parse(rawBody) : {};
      const to = String(payload.to || "").trim();
      const content = String(payload.content || "").trim();
      const messageType = String(payload.messageType || "text").trim().toLowerCase();
      const mediaUrl = String(payload.mediaUrl || "").trim();
      const fileName = String(payload.fileName || "").trim();
      const recipientPhoneNumber = normalizePhone(to);

      if (!recipientPhoneNumber) {
        sendJson(res, 400, {
          error:
            "Reply failed: valid sender phone not available for this chat (likely BSUID/username-only message). Ask user to share phone or start from a phone-based chat.",
        });
        return true;
      }
      let result;
      if (messageType === "text") {
        if (!content) {
          sendJson(res, 400, { error: "Reply text is required." });
          return true;
        }
        result = await sendText(recipientPhoneNumber, content);
      } else {
        if (!mediaUrl) {
          sendJson(res, 400, { error: "Media URL is required." });
          return true;
        }
        result = await sendMedia(recipientPhoneNumber, messageType, mediaUrl, {
          caption: content,
          fileName,
        });
      }

      const messageId = result.receipts?.[0]?.messageId || `${Date.now()}-${Math.random()}`;
      pushMessage(recipientPhoneNumber, {
        id: messageId,
        direction: "outbound",
        type: messageType,
        text: content || `[${messageType}]`,
        media:
          messageType === "text"
            ? null
            : {
                id: "",
                mimeType: "",
                caption: content,
                fileName,
                mediaUri: mediaUrl,
              },
        status: "Sent",
        timestamp: new Date().toISOString(),
      });
      (result.receipts || []).forEach((receipt) => {
        if (receipt.messageId) {
          outboundIndex.set(String(receipt.messageId), getConversationId(recipientPhoneNumber));
        }
      });

      sendJson(res, 200, { ok: true, to: recipientPhoneNumber, receipts: result.receipts || [] });
    } catch (error) {
      sendJson(res, 500, { error: error.message || "Failed to send reply." });
    }
    return true;
  }

  if (req.method === "GET" && req.url.startsWith("/api/media/")) {
    try {
      const mediaId = decodeURIComponent(req.url.split("/api/media/")[1].split("?")[0] || "").trim();
      if (!mediaId) {
        sendJson(res, 400, { error: "Media id is required." });
        return true;
      }

      const { buffer, contentType } = await downloadMediaStream(mediaId);
      res.writeHead(200, {
        "Content-Type": contentType || "application/octet-stream",
        "Content-Length": buffer.length,
        "Cache-Control": "private, max-age=60",
      });
      res.end(buffer);
    } catch (error) {
      const message = error.message || "Failed to download media.";
      pushWebhookLog({
        kind: "media_error",
        error: message,
      });
      res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(message);
    }
    return true;
  }

  if (req.method === "POST" && req.url === "/api/webhooks/acs-events") {
    try {
      const aegEventType = String(req.headers["aeg-event-type"] || "");
      const rawBody = await readRequestBody(req);
      const events = rawBody ? JSON.parse(rawBody) : [];
      const list = Array.isArray(events) ? events : [events];

      pushWebhookLog({
        kind: "incoming",
        headerEventType: aegEventType || null,
        eventTypes: list.map((event) => event?.eventType || null),
        count: list.length,
      });

      const validationEvent = list.find(
        (event) => event?.eventType === "Microsoft.EventGrid.SubscriptionValidationEvent",
      );
      if (validationEvent?.data?.validationCode) {
        pushWebhookLog({
          kind: "subscription_validation",
          validationCode: validationEvent.data.validationCode,
        });
        sendJson(res, 200, {
          validationResponse: validationEvent.data.validationCode,
        });
        return true;
      }

      for (const event of list) {
        if (event?.eventType === "Microsoft.Communication.AdvancedMessageReceived") {
          ingestInboundEvent(event);
        }
        if (event?.eventType === "Microsoft.Communication.AdvancedMessageDeliveryStatusUpdated") {
          ingestDeliveryStatusEvent(event);
        }
      }

      sendJson(res, 200, { ok: true });
    } catch (error) {
      pushWebhookLog({
        kind: "error",
        error: error.message || "Invalid webhook payload.",
      });
      sendJson(res, 400, { error: error.message || "Invalid webhook payload." });
    }
    return true;
  }

  if (req.method === "GET" && req.url === "/api/webhooks/acs-events/logs") {
    sendJson(res, 200, {
      ok: true,
      logs: webhookEventLog.slice().reverse(),
    });
    return true;
  }

  return false;
}

function serveUpload(req, res) {
  ensureUploadDir();
  const requestPath = decodeURIComponent(req.url.split("?")[0]);
  const relative = requestPath.replace(/^\/uploads\//, "");
  const safeName = path.basename(relative);
  const filePath = path.join(UPLOAD_DIR, safeName);

  if (!filePath.startsWith(UPLOAD_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return true;
  }

  if (!fs.existsSync(filePath)) {
    res.writeHead(404);
    res.end("Not found");
    return true;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = getMimeTypeFromExt(ext);
  const stat = fs.statSync(filePath);

  res.writeHead(200, {
    "Content-Type": contentType,
    "Content-Length": stat.size,
    "Cache-Control": "public, max-age=3600",
  });
  fs.createReadStream(filePath).pipe(res);
  return true;
}

function serveStatic(req, res) {
  const requestPath = req.url === "/" ? "/index.html" : decodeURIComponent(req.url.split("?")[0]);
  const safePath = path.normalize(requestPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(PUBLIC_DIR, safePath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    const ext = path.extname(filePath);
    res.writeHead(200, { "Content-Type": CONTENT_TYPES[ext] || "application/octet-stream" });
    res.end(data);
  });
}

function writeHtml(res, statusCode, htmlBody) {
  const content = Buffer.from(String(htmlBody || ""), "utf8");
  res.writeHead(statusCode, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": content.length,
    "Cache-Control": "no-store",
  });
  res.end(content);
}

function maskEmailForDisplay(email) {
  const normalized = normalizeEmail(email);
  const [name, domain] = normalized.split("@");
  if (!name || !domain) {
    return "your email";
  }
  if (name.length <= 2) {
    return `${name[0] || "*"}*@${domain}`;
  }
  return `${name.slice(0, 2)}***@${domain}`;
}

function buildUnsubscribeResultPage(options = {}) {
  const title = escapeHtmlForEmail(String(options.title || "Email Preferences"));
  const message = escapeHtmlForEmail(String(options.message || ""));
  const detail = escapeHtmlForEmail(String(options.detail || ""));
  const toneColor = options.success ? "#166534" : "#991b1b";
  const toneBg = options.success ? "#f0fdf4" : "#fef2f2";
  const toneBorder = options.success ? "#bbf7d0" : "#fecaca";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
</head>
<body style="margin:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#0f172a;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:28px 16px;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden;">
          <tr>
            <td style="padding:28px;">
              <h1 style="margin:0 0 12px 0;font-size:24px;line-height:1.3;">${title}</h1>
              <div style="background:${toneBg};border:1px solid ${toneBorder};color:${toneColor};border-radius:10px;padding:14px 16px;font-size:15px;line-height:1.5;">
                ${message}
              </div>
              <p style="margin:14px 0 0 0;color:#475569;font-size:14px;line-height:1.6;">${detail}</p>
              <p style="margin:20px 0 0 0;color:#64748b;font-size:13px;line-height:1.6;">TalentWale hiring alerts team</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

async function handleUnsubscribeRequest(req, res) {
  if (!req.url) {
    writeHtml(
      res,
      400,
      buildUnsubscribeResultPage({
        success: false,
        title: "Invalid request",
        message: "Unsubscribe link is not valid.",
        detail: "Please use the full link from the email footer.",
      }),
    );
    return true;
  }

  if (!["GET", "POST"].includes(req.method || "")) {
    writeHtml(
      res,
      405,
      buildUnsubscribeResultPage({
        success: false,
        title: "Method not allowed",
        message: "Only GET or POST is supported for this unsubscribe endpoint.",
        detail: "Retry from the original email footer link.",
      }),
    );
    return true;
  }

  let token = "";
  try {
    const parsedUrl = new URL(req.url, "http://localhost");
    token = String(parsedUrl.searchParams.get("token") || "").trim();
  } catch {
    token = "";
  }

  if (!token) {
    writeHtml(
      res,
      400,
      buildUnsubscribeResultPage({
        success: false,
        title: "Missing token",
        message: "Unsubscribe token not found in the link.",
        detail: "Open the full URL from the footer of the received email.",
      }),
    );
    return true;
  }

  try {
    const payload = parseUnsubscribeToken(token);
    await markRecipientUnsubscribed(payload.email, {
      source: "footer_link",
      campaignId: payload.campaignId,
      tokenHash: payload.tokenHash,
    });

    writeHtml(
      res,
      200,
      buildUnsubscribeResultPage({
        success: true,
        title: "You are unsubscribed",
        message: `${maskEmailForDisplay(payload.email)} will no longer receive TalentWale campaign emails.`,
        detail: "It may take a few minutes for all in-flight campaigns to stop.",
      }),
    );
  } catch (error) {
    writeHtml(
      res,
      400,
      buildUnsubscribeResultPage({
        success: false,
        title: "Unable to unsubscribe",
        message: "This unsubscribe link is invalid or has been modified.",
        detail: error.message || "Please retry using the latest email footer link.",
      }),
    );
  }

  return true;
}

const server = http.createServer(async (req, res) => {
  const routePath = String(req.url || "").split("?")[0];

  if (req.url.startsWith("/uploads/")) {
    serveUpload(req, res);
    return;
  }

  if (routePath === UNSUBSCRIBE_ROUTE_PATH) {
    await handleUnsubscribeRequest(req, res);
    return;
  }

  if (req.url.startsWith("/api/")) {
    const handled = await handleApi(req, res);
    if (!handled) {
      sendJson(res, 404, { error: "API route not found." });
    }
    return;
  }

  serveStatic(req, res);
});

async function startServer() {
  await initDatabase();
  await loadActiveSmtpCredentialsFromDb();
  await loadEmailUnsubscribesFromDb();
  await loadEmailSuppressionsFromDb();
  await loadMessagesFromDb();
  await resetProcessingRecipientsOnStartup();
  await initAzureEmailQueue();
  void processCampaignQueue(CAMPAIGN_CHANNEL_WHATSAPP);
  if (emailQueueRuntime.enabled) {
    startAzureEmailQueueConsumer();
  } else {
    void processCampaignQueue(CAMPAIGN_CHANNEL_EMAIL);
  }
  server.listen(PORT, () => {
    console.log(`WhatsApp UI running at http://localhost:${PORT}`);
  });
}

// ─── AWS Lambda Support ───────────────────────────────────────────────────────
// Jab IS_LAMBDA=true hoga, server auto-start nahi karega.
// backend/lambda.js => lambdaInit() call karega + serverless-http wrap karega.

/**
 * lambdaInit — Lambda cold start mein ek baar run hota hai.
 * DB connect karta hai, campaign workers shuru karta hai.
 * serverless-http ke through HTTP handle hota hai — server.listen() nahi.
 */
async function lambdaInit() {
  await initDatabase();
  await loadActiveSmtpCredentialsFromDb();
  await loadEmailUnsubscribesFromDb();
  await loadEmailSuppressionsFromDb();
  await loadMessagesFromDb();
  await resetProcessingRecipientsOnStartup();
  await initAzureEmailQueue();
  void processCampaignQueue(CAMPAIGN_CHANNEL_WHATSAPP);
  if (emailQueueRuntime.enabled) {
    startAzureEmailQueueConsumer();
  } else {
    void processCampaignQueue(CAMPAIGN_CHANNEL_EMAIL);
  }
}

// Local dev: IS_LAMBDA nahi set hai toh normal server start karo
if (!process.env.IS_LAMBDA) {
  startServer().catch((error) => {
    console.error("Failed to start server.", error.message || error);
    process.exit(1);
  });
}

// Lambda handler ke liye exports
module.exports = { server, lambdaInit };
