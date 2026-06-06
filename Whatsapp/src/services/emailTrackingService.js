/**
 * Email Tracking Service
 */

const constants = require("../config/constants");
const ObjectKeys = Object.keys(constants);
for (const k of ObjectKeys) {
  if (typeof global[k] === "undefined") {
    global[k] = constants[k];
  }
}
const { getPool, ensureDbAvailable } = require("../config/database");
const helpers = require("../utils/helpers");
const cryptoUtils = require("../utils/crypto");
const { broadcastInboxEvent } = require("../middleware/requestHelpers");
const { QueueServiceClient } = require("@azure/storage-queue");
const nodemailer = require("nodemailer");
// using built-in fetch
const net = require("net");
const dns = require("dns").promises;
const crypto = require("crypto");


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

module.exports = {
  decodeHtmlAttributeValue,
  escapeHtmlAttributeValue,
  normalizeTrackableTargetUrl,
  buildEmailOpenTrackingUrl,
  buildEmailClickTrackingUrl,
  shouldTrackEmailHref,
  rewriteHtmlLinksWithTracking,
  appendOpenPixelToHtml,
  applyEmailEngagementTracking,
  getAppBaseUrl,
  buildUnsubscribeUrl,
  buildEmailTemplateContext,
  buildListUnsubscribeHeaders
};
