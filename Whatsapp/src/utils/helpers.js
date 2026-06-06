/**
 * Utility / Helper Functions
 * Generic helpers used across the application.
 */

const path = require("path");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(value));
}

function getEmailDomain(email) {
  const normalized = normalizeEmail(email);
  const atIndex = normalized.indexOf("@");
  return atIndex >= 0 ? normalized.slice(atIndex + 1) : "";
}

function truncateText(value, maxLength = 140) {
  const text = String(value || "").trim();
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 3)}...`;
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

function escapeHtmlForEmail(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function interpolateTemplate(template, rowData = {}) {
  return String(template || "").replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const value = rowData[key];
    return value !== undefined && value !== null ? String(value) : "";
  });
}

function sanitizeRowObject(row) {
  if (!row || typeof row !== "object") {
    return {};
  }
  const sanitized = {};
  for (const [key, value] of Object.entries(row)) {
    sanitized[key] = value !== undefined && value !== null ? String(value) : "";
  }
  return sanitized;
}

function buildHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function parseTruthyValue(value, fallback = false) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) {
    return fallback;
  }
  if (["1", "true", "yes", "on"].includes(raw)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(raw)) {
    return false;
  }
  return fallback;
}

function toPercent(numerator, denominator) {
  if (!denominator || denominator <= 0) {
    return 0;
  }
  return Math.round((numerator / denominator) * 10000) / 100;
}

function normalizeSearchDigits(value) {
  return String(value || "").replace(/[^0-9]/g, "");
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

async function withTimeout(promise, timeoutMs, timeoutLabel) {
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(timeoutLabel || `Timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timer);
  }
}

function ensureUploadDir() {
  const fs = require("fs");
  const { UPLOAD_DIR } = require("../config/constants");
  if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  }
}

function normalizeSmtpSendRatePerMinute(value, fallback) {
  const { DEFAULT_SMTP_SEND_RATE_PER_MINUTE } = require("../config/constants");
  const fallbackValue = Math.max(1, Math.floor(Number(fallback) || DEFAULT_SMTP_SEND_RATE_PER_MINUTE));
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallbackValue;
  }
  return Math.min(60000, parsed);
}

function getSmtpSendDelayMs(sendRatePerMinute) {
  const { DEFAULT_SMTP_SEND_RATE_PER_MINUTE } = require("../config/constants");
  return Math.ceil(60000 / normalizeSmtpSendRatePerMinute(sendRatePerMinute || DEFAULT_SMTP_SEND_RATE_PER_MINUTE));
}

module.exports = {
  sleep,
  normalizePhone,
  getCell,
  getConversationId,
  sanitizeFileName,
  getExt,
  getMimeTypeFromExt,
  getMediaKindFromMime,
  normalizeEmail,
  isValidEmail,
  getEmailDomain,
  truncateText,
  normalizeDeliveryStatus,
  formatDeliveryStatusLabel,
  getReportReason,
  maskSecretValue,
  escapeHtmlForEmail,
  interpolateTemplate,
  sanitizeRowObject,
  buildHttpError,
  parseTruthyValue,
  toPercent,
  normalizeSearchDigits,
  getPublicBaseUrl,
  resolvePublicBaseUrl,
  withTimeout,
  ensureUploadDir,
  normalizeSmtpSendRatePerMinute,
  getSmtpSendDelayMs,
};
