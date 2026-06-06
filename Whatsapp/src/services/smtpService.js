/**
 * SMTP Service
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

module.exports = {
  getSmtpProviderOptions,
  resolveSmtpProvider,
  getSmtpConfig,
  getSmtpFromOptions,
  resolveSmtpFromAddress,
  resolveSmtpReplyToAddress,
  buildSmtpFromHeader,
  normalizeEmailBodyFormat,
  buildEmailBodiesFromTemplate,
  createSmtpTransporter
};
