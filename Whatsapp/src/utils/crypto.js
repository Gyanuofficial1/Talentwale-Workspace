/**
 * Crypto / Token Utilities
 * Token generation, HMAC signing, encryption/decryption for SMTP credentials.
 */

const crypto = require("crypto");
const {
  UNSUBSCRIBE_TOKEN_SECRET,
  EMAIL_TRACKING_TOKEN_SECRET,
  DEFAULT_UNSUBSCRIBE_TOKEN_SECRET,
  DEFAULT_EMAIL_TRACKING_TOKEN_SECRET,
} = require("../config/constants");
const { normalizeEmail, isValidEmail } = require("./helpers");

let unsubscribeSecretWarningLogged = false;
let emailTrackingSecretWarningLogged = false;

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
  const normalizedEmail_ = normalizeEmail(email);
  if (!normalizedEmail_) {
    return "";
  }

  const payload = {
    email: normalizedEmail_,
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

  const campaignId_ = String(payload?.campaignId || "").trim();
  const recipient = normalizeEmail(payload?.recipient || "");
  if (!campaignId_ || !isValidEmail(recipient)) {
    throw new Error("Tracking token campaign/recipient invalid.");
  }

  return {
    eventType,
    campaignId: campaignId_,
    recipient,
    rowIndex: Number.isFinite(Number(payload?.rowIndex)) ? Number(payload.rowIndex) : null,
    urlHash: String(payload?.urlHash || "").trim().toLowerCase(),
    iat: Number(payload?.iat || 0),
    tokenHash: hashUnsubscribeToken(rawToken),
  };
}

// SMTP credential encryption
function getSmtpCredentialCipherKey() {
  const raw =
    String(
      process.env.SMTP_CREDENTIAL_CIPHER_KEY ||
        process.env.UNSUBSCRIBE_TOKEN_SECRET ||
        process.env.SUPABASE_DB_PASSWORD ||
        "",
    ).trim() || "local-dev-cipher-key-change-me-32b";
  return crypto.createHash("sha256").update(raw).digest();
}

function encryptSmtpCredentialSecret(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", getSmtpCredentialCipherKey(), iv);
  let encrypted = cipher.update(raw, "utf8", "base64");
  encrypted += cipher.final("base64");
  return `${iv.toString("base64")}:${encrypted}`;
}

function decryptSmtpCredentialSecret(value) {
  const raw = String(value || "").trim();
  if (!raw || !raw.includes(":")) {
    return raw;
  }

  try {
    const [ivBase64, encrypted] = raw.split(":");
    if (!ivBase64 || !encrypted) {
      return raw;
    }
    const iv = Buffer.from(ivBase64, "base64");
    const decipher = crypto.createDecipheriv("aes-256-cbc", getSmtpCredentialCipherKey(), iv);
    let decrypted = decipher.update(encrypted, "base64", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch {
    return raw;
  }
}

module.exports = {
  getUnsubscribeTokenSecret,
  getEmailTrackingTokenSecret,
  toBase64Url,
  fromBase64Url,
  hashUnsubscribeToken,
  hashTrackingValue,
  buildUnsubscribeToken,
  parseUnsubscribeToken,
  buildEmailTrackingToken,
  parseEmailTrackingToken,
  getSmtpCredentialCipherKey,
  encryptSmtpCredentialSecret,
  decryptSmtpCredentialSecret,
};
