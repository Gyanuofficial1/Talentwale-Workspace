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
const nodemailer = require("nodemailer");
// using built-in fetch
const net = require("net");
const dns = require("dns").promises;
const crypto = require("crypto");
const { SESClient, SendRawEmailCommand } = require("@aws-sdk/client-ses");


function getSmtpProviderOptions() {
  return SMTP_PROVIDER_CATALOG.slice();
}

function resolveSmtpProvider(requestedProvider) {
  return "sesapi";
}

function getSesApiConfig() {
  return {
    accessKeyId: String(process.env.AWS_SES_API_ACCESS_KEY_ID || "").trim(),
    secretAccessKey: String(process.env.AWS_SES_API_SECRET_ACCESS_KEY || "").trim(),
    region: String(process.env.AWS_SES_API_REGION || process.env.AWS_SQS_REGION || "ap-south-1").trim(),
    fromAddress: String(process.env.AWS_SES_API_FROM_ADDRESS || "").trim().toLowerCase(),
    fromName: String(process.env.AWS_SES_API_FROM_NAME || "TalentWale").trim(),
    replyTo: String(process.env.AWS_SES_API_REPLY_TO || "").trim().toLowerCase(),
  };
}

function getSmtpConfig(provider) {
  const selectedProvider = resolveSmtpProvider(provider);

  if (selectedProvider === "sesapi") {
    const sesApiCfg = getSesApiConfig();
    return {
      provider: "sesapi",
      host: "email.us-east-1.amazonaws.com", // kept for backwards compat
      port: 443,
      secure: true,
      user: sesApiCfg.accessKeyId,
      pass: sesApiCfg.secretAccessKey,
      from: sesApiCfg.fromAddress,
      fromName: sesApiCfg.fromName,
      replyTo: sesApiCfg.replyTo,
      fromOptionsRaw: sesApiCfg.fromAddress,
      source: "env",
      profileId: "sesapi-env",
      profileName: "AWS SES API (SDK)",
    };
  }

  throw new Error(`Unsupported email provider: ${selectedProvider}`);
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
  const name = String(fromName || "").trim();
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
  
  if (provider === "sesapi") {
    const sesApiCfg = getSesApiConfig();
    if (!sesApiCfg.accessKeyId || !sesApiCfg.secretAccessKey) {
      throw new Error(
        "AWS SES API credentials missing. Set AWS_SES_API_ACCESS_KEY_ID and AWS_SES_API_SECRET_ACCESS_KEY in .env"
      );
    }
    if (!sesApiCfg.fromAddress) {
      throw new Error(
        "AWS SES API from address missing. Set AWS_SES_API_FROM_ADDRESS in .env"
      );
    }

    const sesClient = new SESClient({
      region: sesApiCfg.region,
      credentials: {
        accessKeyId: sesApiCfg.accessKeyId,
        secretAccessKey: sesApiCfg.secretAccessKey,
      },
    });

    const transporter = nodemailer.createTransport({
      SES: { ses: sesClient, aws: { SendRawEmailCommand } },
      sendingRate: 14, // ~14 emails/sec max for SES
    });

    return {
      provider,
      transporter,
      fromAddress: sesApiCfg.fromAddress,
      fromName: sesApiCfg.fromName,
      replyToAddress: sesApiCfg.replyTo,
    };
  }

  throw new Error(`Unsupported email provider: ${provider}`);
}

module.exports = {
  getSmtpProviderOptions,
  resolveSmtpProvider,
  getSmtpConfig,
  getSesApiConfig,
  getSmtpFromOptions,
  resolveSmtpFromAddress,
  resolveSmtpReplyToAddress,
  buildSmtpFromHeader,
  normalizeEmailBodyFormat,
  buildEmailBodiesFromTemplate,
  createSmtpTransporter
};
