/**
 * Application Constants & Environment Configuration
 * Extracted from server.js — all constants, rate limits, timeouts, and env parsing.
 */

const path = require("path");

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, "..", "..", "frontend", "src");
const PUBLIC_ASSETS_DIR = path.join(__dirname, "..", "..", "frontend", "public");
const UPLOAD_DIR = path.join(__dirname, "..", "..", "uploads");
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
const SMTP_TEST_INCLUDE_LIST_UNSUBSCRIBE = ["1", "true", "yes"].includes(
  String(process.env.SMTP_TEST_INCLUDE_LIST_UNSUBSCRIBE || "false").trim().toLowerCase(),
);
const CAMPAIGN_STATUS_TERMINAL = new Set(["completed", "failed", "stopped"]);
const CAMPAIGN_CHANNEL_WHATSAPP = "whatsapp";
const CAMPAIGN_CHANNEL_EMAIL = "email";
const EMAIL_QUEUE_POLL_INTERVAL_MS = Math.max(1000, Number(process.env.EMAIL_QUEUE_POLL_INTERVAL_MS || 5000));
const EMAIL_QUEUE_BATCH_SIZE = Math.min(32, Math.max(1, Number(process.env.EMAIL_QUEUE_BATCH_SIZE || 5)));
const EMAIL_QUEUE_VISIBILITY_TIMEOUT_SECONDS_RAW = Math.max(
  10,
  Number(process.env.EMAIL_QUEUE_VISIBILITY_TIMEOUT_SECONDS || 60),
);
const EMAIL_QUEUE_VISIBILITY_TIMEOUT_SECONDS = Math.max(
  EMAIL_QUEUE_VISIBILITY_TIMEOUT_SECONDS_RAW,
  Math.ceil(((DEFAULT_SMTP_SEND_DELAY_MS + SMTP_SEND_TIMEOUT_MS) * EMAIL_QUEUE_BATCH_SIZE) / 1000) + 15,
);
const EMAIL_QUEUE_MAX_DEQUEUE = Math.max(1, Number(process.env.EMAIL_QUEUE_MAX_DEQUEUE || 8));
const EMAIL_QUEUE_SOFT_FAIL_MAX_RETRY = Math.max(
  0,
  Number(process.env.EMAIL_QUEUE_SOFT_FAIL_MAX_RETRY || 1),
);
const SMTP_PROVIDER_CATALOG = ["sesapi"];
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
const DASHBOARD_PASSWORD = String(process.env.DASHBOARD_PASSWORD || "admin123").trim();
const JWT_SECRET = String(process.env.JWT_SECRET || "default-jwt-secret-change-me").trim();

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

module.exports = {
  PORT,
  PUBLIC_DIR,
  UPLOAD_DIR,
  MAX_UPLOAD_SIZE_BYTES,
  BULK_SEND_RATE_PER_SECOND,
  BULK_SEND_DELAY_MS,
  DEFAULT_CONTACT_ROWS_LIMIT,
  SMTP_BULK_MAX_ROWS,
  DEFAULT_SMTP_SEND_RATE_PER_MINUTE,
  DEFAULT_SMTP_SEND_DELAY_MS,
  SMTP_SEND_TIMEOUT_MS,
  SMTP_TEST_INCLUDE_LIST_UNSUBSCRIBE,
  CAMPAIGN_STATUS_TERMINAL,
  CAMPAIGN_CHANNEL_WHATSAPP,
  CAMPAIGN_CHANNEL_EMAIL,
  EMAIL_QUEUE_POLL_INTERVAL_MS,
  EMAIL_QUEUE_BATCH_SIZE,
  EMAIL_QUEUE_VISIBILITY_TIMEOUT_SECONDS,
  EMAIL_QUEUE_VISIBILITY_TIMEOUT_SECONDS_RAW,
  EMAIL_QUEUE_MAX_DEQUEUE,
  EMAIL_QUEUE_SOFT_FAIL_MAX_RETRY,
  SMTP_PROVIDER_CATALOG,
  UNSUBSCRIBE_ROUTE_PATH,
  EMAIL_TRACKING_OPEN_ROUTE_PATH,
  EMAIL_TRACKING_CLICK_ROUTE_PATH,
  EMAIL_TRACKING_PIXEL_BUFFER,
  UNSUBSCRIBE_TOKEN_SECRET,
  EMAIL_TRACKING_TOKEN_SECRET,
  DEFAULT_UNSUBSCRIBE_TOKEN_SECRET,
  DEFAULT_EMAIL_TRACKING_TOKEN_SECRET,
  CONTENT_TYPES,
  MAX_CONVERSATIONS,
  MAX_MESSAGES_PER_CONVERSATION,
  MAX_EVENT_LOGS,
  DB_LOAD_MESSAGE_LIMIT,
  REPORT_SUMMARY_CACHE_TTL_MS,
  BLOCKED_DISPOSABLE_DOMAINS,
  EMAIL_VERIFY_MODES_WITH_MX,
  EMAIL_VERIFY_MODES_WITH_SMTP_PROBE,
  DASHBOARD_PASSWORD,
  JWT_SECRET,
  PUBLIC_ASSETS_DIR,
};
