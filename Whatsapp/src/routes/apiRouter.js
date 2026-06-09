/**
 * API Router
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
const jwt = require("jsonwebtoken");
const { requireAuth } = require("../middleware/authMiddleware");


async function handleApi(req, res) {
  const routePath = String(req.url || "").split("?")[0];

  if (req.method === "POST" && routePath === "/api/login") {
    try {
      const rawBody = await readRequestBody(req);
      const payload = rawBody ? JSON.parse(rawBody) : {};
      const { password } = payload;
      if (password === DASHBOARD_PASSWORD) {
        const token = jwt.sign({ role: "admin" }, JWT_SECRET, { expiresIn: "7d" });
        sendJson(res, 200, { ok: true, token });
      } else {
        sendJson(res, 401, { error: "Invalid password" });
      }
    } catch (error) {
      sendJson(res, 500, { error: "Login failed" });
    }
    return true;
  }

  const isAuth = requireAuth(req, res);
  if (!isAuth) return true;

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

  if (req.method === "GET" && routePath === UNSUBSCRIBE_ROUTE_PATH) {
    const parsedUrl = new URL(req.url, "http://localhost");
    const token = String(parsedUrl.searchParams.get("token") || "").trim();

    try {
      if (!token) throw new Error("Missing token.");
      const payload = cryptoUtils.parseUnsubscribeToken(token);
      await markRecipientUnsubscribed(payload.recipient, {
        campaignId: payload.campaignId,
        tokenHash: payload.tokenHash,
        source: "footer_link"
      });
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store, no-cache, must-revalidate, private, max-age=0"
      });
      res.end(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Unsubscribed</title>
          <style>
            body { font-family: system-ui, sans-serif; text-align: center; padding: 50px; background: #f3f4f6; color: #1f2937; }
            .box { max-width: 400px; margin: 0 auto; background: white; padding: 30px; border-radius: 12px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); }
            h2 { color: #16a34a; }
          </style>
        </head>
        <body>
          <div class="box">
            <h2>Successfully Unsubscribed</h2>
            <p>You have been removed from our mailing list and will no longer receive these emails.</p>
          </div>
        </body>
        </html>
      `);
    } catch (error) {
      res.writeHead(400, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store, no-cache, must-revalidate, private, max-age=0"
      });
      res.end(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Unsubscribe Error</title>
          <style>
            body { font-family: system-ui, sans-serif; text-align: center; padding: 50px; background: #f3f4f6; color: #1f2937; }
            .box { max-width: 400px; margin: 0 auto; background: white; padding: 30px; border-radius: 12px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); }
            h2 { color: #dc2626; }
          </style>
        </head>
        <body>
          <div class="box">
            <h2>Error</h2>
            <p>${error.message || "Invalid or expired unsubscribe link."}</p>
          </div>
        </body>
        </html>
      `);
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
          suppressedCount: await getSuppressedCount(),
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
      const campaignId = await createEmailCampaignRecord(campaignPayload, rows.length, rows, recipientColumn);
      await enqueueEmailCampaignTasks(campaignId, campaignPayload, rows, recipientColumn);

      const campaign = await getCampaignById(campaignId);
      sendJson(res, 202, {
        ok: true,
        campaignId,
        dispatchMode: "aws_sqs_queue_tasks",
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

  if (req.method === "GET" && req.url.startsWith("/api/inbox/stream")) {
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

module.exports = { handleApi };
