/**
 * Email Verify Service
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


function isEmailMxValidationEnabled() {
  return EMAIL_VERIFY_MODES_WITH_MX.has(EMAIL_VERIFY_MODE);
}

function isEmailSmtpProbeEnabled() {
  return EMAIL_VERIFY_MODES_WITH_SMTP_PROBE.has(EMAIL_VERIFY_MODE);
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

  if (EMAIL_SUPPRESSION_ENABLED && (await isEmailSuppressed(email))) {
    return {
      ok: false,
      reason: "Recipient suppressed after earlier hard bounce.",
      gate: "suppression",
      verdict: "undeliverable",
    };
  }

  if (await isEmailUnsubscribed(email)) {
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

module.exports = {
  isEmailMxValidationEnabled,
  isEmailSmtpProbeEnabled,
  isDisposableDomain,
  isLikelyHardBounceError,
  rememberSuppressedRecipient,
  canRetrySoftQueueFailure,
  resolveDomainRecordHealth,
  getEmailVerifyProbeFromAddress,
  classifySmtpRcptResponse,
  createSmtpLineReader,
  runSmtpRecipientProbe,
  probeRecipientWithMx,
  preflightEmailDeliverability
};
