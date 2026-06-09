/**
 * SMTP Model
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
let smtpCredentialCipherKeyCache = null;


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

module.exports = {
  loadActiveSmtpCredentialsFromDb,
  listSmtpCredentialProfiles,
  getSmtpCredentialProfileRowById,
  createSmtpCredentialProfile,
  updateSmtpCredentialProfile,
  deleteSmtpCredentialProfile,
  activateSmtpCredentialProfile,
  normalizeSmtpProvider,
  getActiveSmtpProviderOptions,
  getPrimarySmtpProvider,
  setPrimarySmtpProvider,
  getSmtpCredentialCipherKey,
  encryptSmtpCredentialSecret,
  decryptSmtpCredentialSecret,
  normalizeSmtpFromOptionsRaw,
  normalizeSmtpFromName,
  toSmtpCredentialPublic,
  buildRuntimeSmtpProfileFromCredentialRow,
  setRuntimeSmtpProfile
};
