/**
 * Azure Queue Service
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
const { SQSClient, SendMessageBatchCommand, GetQueueAttributesCommand, ReceiveMessageCommand, DeleteMessageCommand } = require("@aws-sdk/client-sqs");
const nodemailer = require("nodemailer");
// using built-in fetch
const net = require("net");
const dns = require("dns").promises;
const crypto = require("crypto");
let emailQueueLastSentAt = 0;


function getSqsEmailQueueConfig() {
  const queueUrl = String(process.env.AWS_SQS_QUEUE_URL || "").trim();
  const region = String(process.env.AWS_SQS_REGION || process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "ap-south-1").trim();

  return {
    enabled: Boolean(queueUrl),
    queueUrl,
    region,
  };
}

async function initSqsEmailQueue() {
  const config = getSqsEmailQueueConfig();
  if (!config.enabled) {
    console.log(
      "AWS SQS Email Queue disabled. Set AWS_SQS_QUEUE_URL to enable queue-based SMTP campaigns.",
    );
    emailQueueRuntime.enabled = false;
    emailQueueRuntime.queueClient = null;
    emailQueueRuntime.queueUrl = "";
    return;
  }

  // Create configuration object for SQSClient
  const clientConfig = { region: config.region };

  // Use custom non-reserved env keys if provided (useful to avoid AWS Lambda Reserved Keys conflict)
  const accessKeyId = process.env.AWS_SQS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SQS_SECRET_ACCESS_KEY;
  if (accessKeyId && secretAccessKey) {
    clientConfig.credentials = {
      accessKeyId: String(accessKeyId).trim(),
      secretAccessKey: String(secretAccessKey).trim(),
    };
  }

  const sqsClient = new SQSClient(clientConfig);

  // Validate the SQS Queue URL actually exists and is accessible
  try {
    const testCommand = new GetQueueAttributesCommand({
      QueueUrl: config.queueUrl,
      AttributeNames: ["QueueArn"]
    });
    await sqsClient.send(testCommand);
  } catch (err) {
    console.error(`FATAL: Failed to validate AWS SQS Queue "${config.queueUrl}" on startup:`, err.message);
    throw new Error(`Invalid AWS SQS Configuration: ${err.message}`);
  }

  emailQueueRuntime.enabled = true;
  emailQueueRuntime.queueClient = sqsClient;
  emailQueueRuntime.queueUrl = config.queueUrl;
  console.log(`AWS SQS Email Queue verified and enabled: ${config.queueUrl}`);

  if (process.env.IS_LAMBDA !== "true") {
    startSqsLocalConsumer();
  }
}

async function startSqsLocalConsumer() {
  console.log("[Local SQS Consumer] Starting polling loop...");

  while (emailQueueRuntime.enabled && emailQueueRuntime.queueClient) {
    try {
      const receiveParams = {
        QueueUrl: emailQueueRuntime.queueUrl,
        MaxNumberOfMessages: 5,
        WaitTimeSeconds: 10,
        AttributeNames: ["ApproximateReceiveCount"]
      };

      const response = await emailQueueRuntime.queueClient.send(new ReceiveMessageCommand(receiveParams));
      const messages = response.Messages || [];

      for (const message of messages) {
        try {
          const payload = JSON.parse(message.Body || "{}");
          const dequeueCount = Number(message.Attributes?.ApproximateReceiveCount || 1);

          const result = await processQueuedEmailTask(payload, { dequeueCount });

          if (result && result.action !== "retry") {
            await emailQueueRuntime.queueClient.send(new DeleteMessageCommand({
              QueueUrl: emailQueueRuntime.queueUrl,
              ReceiptHandle: message.ReceiptHandle
            }));
          }
        } catch (msgErr) {
          console.error("[Local SQS Consumer] Error processing message:", msgErr.message);
        }
      }
    } catch (pollErr) {
      console.error("[Local SQS Consumer] Polling error:", pollErr.message);
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
}

async function getEmailQueueSmtpContext(provider) {
  const selectedProvider = resolveSmtpProvider(provider);
  const cached = emailQueueSmtpContexts.get(selectedProvider);
  if (cached) {
    return cached;
  }

  const context = createSmtpTransporter(selectedProvider);
  if (!context.fromAddress) {
    throw new Error(`From address is required for active ${selectedProvider} SMTP profile.`);
  }

  await withTimeout(context.transporter.verify(), SMTP_VERIFY_TIMEOUT_MS, "SMTP verify timeout");
  emailQueueSmtpContexts.set(selectedProvider, context);
  return context;
}

async function applyEmailQueueThrottle(sendDelayMs = DEFAULT_SMTP_SEND_DELAY_MS) {
  const delayMs = Math.max(0, Number(sendDelayMs) || 0);
  if (delayMs <= 0 || !emailQueueLastSentAt) {
    return;
  }

  const elapsed = Date.now() - emailQueueLastSentAt;
  if (elapsed < delayMs) {
    await sleep(delayMs - elapsed);
  }
}

async function batchEnqueueEmailTaskMessagesSqs(taskPayloads) {
  if (!emailQueueRuntime.enabled || !emailQueueRuntime.queueClient) {
    throw new Error("AWS SQS Queue is disabled or not initialized. Campaign cannot start without active queue.");
  }
  if (!taskPayloads.length) {
    return true;
  }

  const batchSize = 10;
  const batches = [];
  for (let i = 0; i < taskPayloads.length; i += batchSize) {
    batches.push(taskPayloads.slice(i, i + batchSize));
  }

  const MAX_CONCURRENCY = 10;
  for (let i = 0; i < batches.length; i += MAX_CONCURRENCY) {
    const concurrentBatches = batches.slice(i, i + MAX_CONCURRENCY);
    await Promise.all(
      concurrentBatches.map(async (batch) => {
        const command = new SendMessageBatchCommand({
          QueueUrl: emailQueueRuntime.queueUrl,
          Entries: batch.map((task, idx) => ({
            Id: `msg-${Date.now()}-${idx}-${crypto.randomUUID()}`,
            MessageBody: JSON.stringify(task)
          }))
        });
        await emailQueueRuntime.queueClient.send(command);
      })
    );
  }
  return true;
}

async function processQueuedEmailTask(payload, options = {}) {
  const dequeueCount = Math.max(1, Number(options.dequeueCount || 1));
  const campaignId = String(payload?.campaignId || "").trim();
  const rowIndex = Number.isFinite(Number(payload?.rowIndex)) ? Number(payload.rowIndex) : null;
  const recipient = normalizeEmail(payload?.recipient);
  const rowData = sanitizeRowObject(payload?.rowData);
  const subjectTemplate = String(payload?.subjectTemplate || "").trim();
  const bodyTemplate = String(payload?.bodyTemplate || "").trim();
  const bodyFormat = normalizeEmailBodyFormat(payload?.bodyFormat);
  const smtpProvider = resolveSmtpProvider(payload?.smtpProvider);
  const requestedFrom = String(payload?.mailFrom || "").trim();
  const requestedReplyTo = String(payload?.replyTo || "").trim();
  const trackingBaseUrl = String(payload?.baseUrl || "").trim();
  const sendRatePerMinute = normalizeSmtpSendRatePerMinute(payload?.sendRatePerMinute);
  const sendDelayMs = getSmtpSendDelayMs(sendRatePerMinute);

  if (!campaignId || !subjectTemplate || !bodyTemplate || !recipient) {
    return { action: "delete", reason: "invalid_payload" };
  }

  const campaign = await getCampaignById(campaignId);
  if (!campaign) {
    return { action: "delete", reason: "campaign_missing" };
  }

  const campaignStatus = String(campaign.status || "").toLowerCase();
  if (CAMPAIGN_STATUS_TERMINAL.has(campaignStatus) || campaign.stop_requested) {
    return { action: "delete", reason: "campaign_stopped" };
  }

  let resultPatch;
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
    resultPatch = {
      status: "failed",
      errorText: preflight.reason,
      lastMessage: `Precheck failed: ${preflight.gate}`,
    };
  } else {
    await applyEmailQueueThrottle(sendDelayMs);
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

    try {
      const context = await getEmailQueueSmtpContext(smtpProvider);
      const fromAddress = resolveSmtpFromAddress(smtpProvider, requestedFrom, context.fromAddress);
      const fromHeader = buildSmtpFromHeader(fromAddress, context.fromName || "");
      const replyToAddress = resolveSmtpReplyToAddress(requestedReplyTo, context.replyToAddress);
      const info = await withTimeout(
        context.transporter.sendMail({
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
      emailQueueLastSentAt = Date.now();
      resultPatch = {
        status: "sent",
        providerMessageId: String(info.messageId || ""),
        lastMessage: "Sending in progress",
      };
    } catch (error) {
      const errorText = String(error?.message || "Send failed.");
      const hardBounce = isLikelyHardBounceError(errorText);
      emailQueueSmtpContexts.delete(smtpProvider);
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
      if (!hardBounce && canRetrySoftQueueFailure(dequeueCount)) {
        return {
          action: "retry",
          reason: "soft_fail",
          errorText,
        };
      }
      resultPatch = {
        status: "failed",
        errorText,
        lastMessage: hardBounce ? "Hard bounce: recipient marked invalid" : errorText,
      };
    }
  }

  const status = String(resultPatch.status || "failed").toLowerCase();
  const isSuccess = status === "sent";

  if (Number.isFinite(rowIndex)) {
    await dbPool.query(
      `
        UPDATE campaign_recipients
        SET status = $3,
            provider_message_id = $4,
            error_text = $5,
            processed_at = NOW(),
            updated_at = NOW()
        WHERE campaign_id = $1
          AND row_index = $2
      `,
      [
        campaignId,
        Number(rowIndex),
        status,
        resultPatch.providerMessageId ? String(resultPatch.providerMessageId) : null,
        resultPatch.errorText ? String(resultPatch.errorText) : null,
      ],
    );
  }

  const updated = await dbPool.query(
    `
      UPDATE campaigns
      SET status = CASE
            WHEN stop_requested THEN 'stopped'
            WHEN processed + 1 >= total THEN 'completed'
            ELSE 'running'
          END,
          started_at = COALESCE(started_at, NOW()),
          completed_at = CASE
            WHEN stop_requested OR processed + 1 >= total THEN NOW()
            ELSE completed_at
          END,
          processed = LEAST(total, processed + 1),
          sent = sent + $2,
          failed = failed + $3,
          last_message = $4,
          updated_at = NOW()
      WHERE id = $1
      RETURNING id, status
    `,
    [campaignId, isSuccess ? 1 : 0, isSuccess ? 0 : 1, String(resultPatch.lastMessage || "Sending in progress")],
  );

  if (!updated.rows?.length) {
    return { action: "delete", reason: "campaign_update_missing" };
  }

  const nextStatus = String(updated.rows[0].status || "").toLowerCase();
  if (nextStatus === "completed") {
    await finalizeCampaign(campaignId, "completed", "Campaign completed");
  }
  if (nextStatus === "stopped") {
    await finalizeCampaign(campaignId, "stopped", "Stopped by user");
  }

  return {
    action: "delete",
    reason: String(resultPatch.status || "failed").toLowerCase(),
  };
}

module.exports = {
  getSqsEmailQueueConfig,
  initSqsEmailQueue,
  getEmailQueueSmtpContext,
  applyEmailQueueThrottle,
  batchEnqueueEmailTaskMessagesSqs,
  processQueuedEmailTask
};
