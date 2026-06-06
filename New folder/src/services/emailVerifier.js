const validator = require("validator");
const mailchecker = require("mailchecker");
const { parse: parseDomain } = require("tldts");
const { resolveMx, probeGmailRcpt } = require("./smtpProbe");

const disposableDomainSet = mailchecker.blacklist();

const roleBasedLocals = new Set([
  "admin",
  "support",
  "info",
  "contact",
  "sales",
  "hello",
  "hr",
  "billing",
  "team",
  "noreply",
  "no-reply",
]);

async function verifyEmail(email, smtpTimeoutMs) {
  const trimmed = String(email || "").trim().toLowerCase();

  const result = {
    email: trimmed,
    status: "invalid",
    reason: "Unknown",
    checks: {
      syntax: false,
      domain: null,
      mx: false,
      disposable: false,
      roleBased: false,
      gmailOnlyPolicy: false,
      smtp: {
        checked: false,
        status: "not_checked",
        code: null,
        response: "",
      },
    },
  };

  if (!trimmed) {
    result.reason = "Empty email";
    return result;
  }

  const syntaxOk = validator.isEmail(trimmed, {
    allow_utf8_local_part: false,
    domain_specific_validation: true,
    ignore_max_length: false,
  });
  result.checks.syntax = syntaxOk;

  if (!syntaxOk) {
    result.reason = "Invalid syntax";
    return result;
  }

  const at = trimmed.lastIndexOf("@");
  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  result.checks.domain = domain;

  const parsed = parseDomain(domain);
  if (!parsed || !parsed.isIcann) {
    result.reason = "Invalid domain";
    return result;
  }

  result.checks.disposable = disposableDomainSet.has(domain);
  result.checks.roleBased = roleBasedLocals.has(local);

  if (result.checks.disposable) {
    result.reason = "Disposable email domain";
    return result;
  }

  const mxRecords = await resolveMx(domain);
  result.checks.mx = mxRecords.length > 0;

  if (!result.checks.mx) {
    result.reason = "No MX record";
    return result;
  }

  result.checks.gmailOnlyPolicy = domain === "gmail.com";
  if (!result.checks.gmailOnlyPolicy) {
    result.reason = "Rejected by policy: only gmail.com allowed for SMTP validation";
    return result;
  }

  result.checks.smtp.checked = true;
  const smtpResult = await probeGmailRcpt(trimmed, smtpTimeoutMs);
  result.checks.smtp.status = smtpResult.status;
  result.checks.smtp.code = smtpResult.code;
  result.checks.smtp.response = smtpResult.response;

  if (smtpResult.status === "valid") {
    result.status = "valid";
    result.reason = smtpResult.reason;
  } else {
    result.status = "invalid";
    result.reason = smtpResult.reason;
  }

  return result;
}

module.exports = {
  verifyEmail,
};
