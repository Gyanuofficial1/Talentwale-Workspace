/**
 * Campaign Service
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


async function processWhatsappRecipient(campaign, recipientRow, attemptIndex) {
  const payload = campaign.payload_json && typeof campaign.payload_json === "object" ? campaign.payload_json : {};
  const templateName = String(payload.templateName || "").trim();
  const valueMappings = payload.valueMappings && typeof payload.valueMappings === "object" ? payload.valueMappings : {};
  const rowData = sanitizeRowObject(recipientRow.row_data);
  const recipientPhoneNumber = normalizePhone(recipientRow.recipient);
  const valueOverrides = buildValueOverridesFromMapping(rowData, valueMappings);

  if (!/^\d{10,15}$/.test(recipientPhoneNumber)) {
    pushMessage(recipientPhoneNumber || `invalid-${Date.now()}-${Math.random()}`, {
      id: `bulk-failed-${Date.now()}-${Math.random()}`,
      direction: "outbound",
      type: "template",
      text: buildTemplateMessagePreview(templateName, valueOverrides),
      media: getTemplateMediaPreview(templateName, valueOverrides),
      templateName,
      status: "Failed",
      statusDetails: "Invalid phone number.",
      timestamp: new Date().toISOString(),
    });

    return {
      status: "failed",
      errorText: "Invalid phone number.",
      lastMessage: "Invalid phone skipped",
    };
  }

  const missingValues = getMissingTemplateValues(templateName, valueOverrides);
  if (missingValues.length) {
    const errorText = `Template values required: ${missingValues.join(", ")}.`;
    pushMessage(recipientPhoneNumber, {
      id: `bulk-failed-${Date.now()}-${Math.random()}`,
      direction: "outbound",
      type: "template",
      text: buildTemplateMessagePreview(templateName, valueOverrides),
      media: getTemplateMediaPreview(templateName, valueOverrides),
      templateName,
      status: "Failed",
      statusDetails: errorText,
      timestamp: new Date().toISOString(),
    });

    return {
      status: "failed",
      errorText,
      lastMessage: "Template value missing",
    };
  }

  if (attemptIndex > 0) {
    await sleep(BULK_SEND_DELAY_MS);
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

  return {
    status: "sent",
    providerMessageId: result.receipts?.[0]?.messageId || null,
    lastMessage: "Sending in progress",
  };
}

async function processEmailRecipient(campaign, recipientRow, attemptIndex, transporterContext) {
  const payload = campaign.payload_json && typeof campaign.payload_json === "object" ? campaign.payload_json : {};
  const subjectTemplate = String(payload.subjectTemplate || "").trim();
  const bodyTemplate = String(payload.bodyTemplate || "").trim();
  const bodyFormat = normalizeEmailBodyFormat(payload.bodyFormat);
  const smtpProvider = resolveSmtpProvider(payload.smtpProvider);
  const requestedFrom = String(payload.mailFrom || "").trim();
  const requestedReplyTo = String(payload.replyTo || "").trim();
  const sendRatePerMinute = normalizeSmtpSendRatePerMinute(payload.sendRatePerMinute);
  const sendDelayMs = getSmtpSendDelayMs(sendRatePerMinute);
  const trackingBaseUrl = String(payload.baseUrl || "").trim();
  const campaignId = String(campaign.id || "").trim();
  const rowIndex = Number.isFinite(Number(recipientRow?.row_index)) ? Number(recipientRow.row_index) : null;
  const rowData = sanitizeRowObject(recipientRow.row_data);
  const recipient = normalizeEmail(recipientRow.recipient);

  const preflight = await preflightEmailDeliverability(recipient);
  if (!preflight.ok && EMAIL_VERIFY_ENFORCE) {
    await logEmailRejection({
      campaignId,
      recipient,
      gate: String(preflight.gate || "preflight"),
      verdict: String(preflight.verdict || "rejected"),
      reason: preflight.reason,
      source: "preflight",
      rowIndex,
      rowData,
    });
    return {
      status: "failed",
      errorText: preflight.reason,
      lastMessage: `Precheck failed: ${preflight.gate}`,
    };
  }

  if (attemptIndex > 0) {
    await sleep(sendDelayMs);
  }

  const mergedRow = buildEmailTemplateContext(rowData, {
    recipient,
    campaignId,
  });
  const subject = interpolateTemplate(subjectTemplate, mergedRow);
  const emailBodies = buildEmailBodiesFromTemplate(bodyTemplate, mergedRow, bodyFormat);
  const trackedEmailBodies = applyEmailEngagementTracking(emailBodies, {
    campaignId,
    recipient,
    rowIndex,
    baseUrl: trackingBaseUrl,
  });
  const headers = buildListUnsubscribeHeaders(recipient, { campaignId });

  let info;
  try {
    const fromAddress = resolveSmtpFromAddress(smtpProvider, requestedFrom, transporterContext.fromAddress);
    const fromHeader = buildSmtpFromHeader(fromAddress, transporterContext.fromName || "");
    const replyToAddress = resolveSmtpReplyToAddress(requestedReplyTo, transporterContext.replyToAddress);
    info = await withTimeout(
      transporterContext.transporter.sendMail({
        from: fromHeader,
        to: recipient,
        replyTo: replyToAddress || undefined,
        subject: subject || "Notification",
        html: trackedEmailBodies.html,
        text: trackedEmailBodies.text,
        headers: Object.keys(headers).length ? headers : undefined,
      }),
      SMTP_SEND_TIMEOUT_MS,
      "SMTP send timeout",
    );
  } catch (error) {
    const errorText = String(error?.message || "Send failed.");
    const hardBounce = isLikelyHardBounceError(errorText);
    if (hardBounce) {
      rememberSuppressedRecipient(recipient, errorText, {
        source: "smtp_send",
      });
      await logEmailRejection({
        campaignId,
        recipient,
        gate: "smtp_send",
        verdict: "undeliverable",
        reason: errorText,
        source: "smtp_send",
        rowIndex,
        rowData,
      });
    }
    throw error;
  }

  return {
    status: "sent",
    providerMessageId: String(info.messageId || ""),
    lastMessage: "Sending in progress",
  };
}

async function runCampaign(campaign) {
  const channel = String(campaign.channel || "").toLowerCase();
  const campaignId = String(campaign.id || "").trim();
  if (!campaignId) {
    return;
  }

  const payload = campaign.payload_json && typeof campaign.payload_json === "object" ? campaign.payload_json : {};
  if (channel === CAMPAIGN_CHANNEL_WHATSAPP && !TEMPLATE_KEYS[String(payload.templateName || "").trim()]) {
    await finalizeCampaign(campaignId, "failed", "Invalid template configuration");
    return;
  }

  if (
    channel === CAMPAIGN_CHANNEL_EMAIL &&
    (!String(payload.subjectTemplate || "").trim() || !String(payload.bodyTemplate || "").trim())
  ) {
    await finalizeCampaign(campaignId, "failed", "Subject/body template missing");
    return;
  }

  let attemptIndex = 0;
  let transporterContext = null;

  if (channel === CAMPAIGN_CHANNEL_EMAIL) {
    const smtpProvider = resolveSmtpProvider(payload.smtpProvider);
    transporterContext = createSmtpTransporter(smtpProvider);
    if (!transporterContext.fromAddress) {
      await finalizeCampaign(campaignId, "failed", `SMTP from address missing for ${smtpProvider} provider.`);
      return;
    }
    await withTimeout(transporterContext.transporter.verify(), SMTP_VERIFY_TIMEOUT_MS, "SMTP verify timeout");
  }

  while (true) {
    if (await shouldStopCampaign(campaignId)) {
      await finalizeCampaign(campaignId, "stopped", "Stopped by user");
      return;
    }

    const recipientRow = await claimNextRecipient(campaignId);
    if (!recipientRow) {
      await finalizeCampaign(campaignId, "completed", "Campaign completed");
      return;
    }

    try {
      const result =
        channel === CAMPAIGN_CHANNEL_WHATSAPP
          ? await processWhatsappRecipient(campaign, recipientRow, attemptIndex)
          : await processEmailRecipient(campaign, recipientRow, attemptIndex, transporterContext);

      attemptIndex += 1;
      await completeRecipient(campaignId, recipientRow.id, result);
    } catch (error) {
      await completeRecipient(campaignId, recipientRow.id, {
        status: "failed",
        errorText: error.message || "Send failed.",
        lastMessage: error.message || "Send failed",
      });
    }
  }
}

async function processCampaignQueue(channel) {
  if (campaignWorkers.get(channel)) {
    return;
  }

  campaignWorkers.set(channel, true);
  try {
    while (true) {
      const campaign = await claimNextCampaign(channel);
      if (!campaign) {
        break;
      }

      try {
        await runCampaign(campaign);
      } catch (error) {
        await finalizeCampaign(campaign.id, "failed", error.message || "Campaign failed");
      }
    }
  } finally {
    campaignWorkers.delete(channel);
  }
}

async function resetProcessingRecipientsOnStartup() {
  ensureDbAvailable();
  await dbPool.query(
    `
      UPDATE campaign_recipients
      SET status = 'pending',
          updated_at = NOW()
      WHERE status = 'processing'
    `,
  );
}

module.exports = {
  processWhatsappRecipient,
  processEmailRecipient,
  runCampaign,
  processCampaignQueue,
  resetProcessingRecipientsOnStartup
};
