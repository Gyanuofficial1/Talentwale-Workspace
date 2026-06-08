/**
 * Campaign Model
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


function buildCampaignId(channel) {
  return `${channel}-${Date.now()}-${crypto.randomUUID()}`;
}

function sanitizeRowObject(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    return {};
  }
  return row;
}

function buildValueOverridesFromMapping(row, valueMappings = {}) {
  const valueOverrides = {};

  Object.entries(valueMappings).forEach(([templateKey, mapping]) => {
    if (!templateKey || !mapping) {
      return;
    }

    if (typeof mapping === "string") {
      valueOverrides[templateKey] = String(getCell(row, mapping)).trim();
      return;
    }

    const source = String(mapping.source || "column").trim();
    if (source === "static") {
      valueOverrides[templateKey] = String(mapping.value || "").trim();
      return;
    }

    valueOverrides[templateKey] = String(getCell(row, mapping.column)).trim();
  });

  return valueOverrides;
}

function buildCampaignSummary(campaign) {
  if (!campaign) {
    return {
      runId: "",
      channel: "",
      status: "idle",
      loaded: 0,
      total: 0,
      processed: 0,
      sent: 0,
      failed: 0,
      inProgress: false,
      stopRequested: false,
      lastMessage: "Idle",
      lastUpdatedAt: "",
      createdAt: "",
      startedAt: "",
      completedAt: "",
    };
  }

  return {
    runId: String(campaign.id || ""),
    channel: String(campaign.channel || ""),
    status: String(campaign.status || "idle"),
    loaded: Number(campaign.total || 0),
    total: Number(campaign.total || 0),
    processed: Number(campaign.processed || 0),
    sent: Number(campaign.sent || 0),
    failed: Number(campaign.failed || 0),
    inProgress: !CAMPAIGN_STATUS_TERMINAL.has(String(campaign.status || "").toLowerCase()),
    stopRequested: Boolean(campaign.stop_requested),
    lastMessage: String(campaign.last_message || ""),
    lastUpdatedAt: campaign.updated_at ? new Date(campaign.updated_at).toISOString() : "",
    createdAt: campaign.created_at ? new Date(campaign.created_at).toISOString() : "",
    startedAt: campaign.started_at ? new Date(campaign.started_at).toISOString() : "",
    completedAt: campaign.completed_at ? new Date(campaign.completed_at).toISOString() : "",
  };
}

async function getCampaignById(campaignId) {
  ensureDbAvailable();
  const result = await dbPool.query(
    `
      SELECT *
      FROM campaigns
      WHERE id = $1
      LIMIT 1
    `,
    [String(campaignId || "")],
  );

  return result.rows?.[0] || null;
}

async function getLatestCampaign(channel) {
  ensureDbAvailable();
  const result = await dbPool.query(
    `
      SELECT *
      FROM campaigns
      WHERE channel = $1
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [channel],
  );

  return result.rows?.[0] || null;
}

async function getLiveCampaignSummary(channel, campaignId = "") {
  const campaign = campaignId ? await getCampaignById(campaignId) : await getLatestCampaign(channel);
  const summary = buildCampaignSummary(campaign);

  if (channel === CAMPAIGN_CHANNEL_EMAIL) {
    return {
      ...summary,
      lastTestRecipient: smtpTestState.lastTestRecipient || "",
      lastTestAt: smtpTestState.lastTestAt || "",
      testInProgress: Boolean(smtpTestState.inProgress),
      testMessage: String(smtpTestState.lastMessage || ""),
    };
  }

  return summary;
}

function broadcastCampaignSummaryEvent(campaign) {
  if (!campaign) {
    return;
  }

  broadcastInboxEvent({
    type: "campaign",
    channel: String(campaign.channel || "").toLowerCase(),
    summary: buildCampaignSummary(campaign),
  });
}

async function createEmailCampaignRecord(payload, total, rows = [], recipientColumn = "") {
  ensureDbAvailable();
  const campaignId = buildCampaignId(CAMPAIGN_CHANNEL_EMAIL);
  const sanitizedRows = Array.isArray(rows) ? rows.map((row) => sanitizeRowObject(row)) : [];
  const client = await dbPool.connect();

  try {
    await client.query("BEGIN");
    await client.query(
      `
        INSERT INTO campaigns (
          id, channel, status, total, processed, sent, failed, payload_json, last_message
        )
        VALUES ($1, $2, 'queued', $3, 0, 0, 0, $4::jsonb, 'Queued')
      `,
      [campaignId, CAMPAIGN_CHANNEL_EMAIL, Number(total || 0), JSON.stringify(payload || {})],
    );

    if (sanitizedRows.length > 0) {
      const campaignIds = Array(sanitizedRows.length).fill(campaignId);
      const rowIndexes = sanitizedRows.map((_, i) => i);
      const recipients = sanitizedRows.map((row) => String(normalizeEmail(getCell(row, recipientColumn)) || ""));
      const rowDatas = sanitizedRows.map((row) => JSON.stringify(row));
      const statuses = Array(sanitizedRows.length).fill('pending');

      await client.query(
        `
          INSERT INTO campaign_recipients (
            campaign_id, row_index, recipient, row_data, status
          )
          SELECT * FROM UNNEST($1::text[], $2::int[], $3::text[], $4::jsonb[], $5::text[])
        `,
        [campaignIds, rowIndexes, recipients, rowDatas, statuses]
      );
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  const campaign = await getCampaignById(campaignId);
  broadcastCampaignSummaryEvent(campaign);
  return campaignId;
}

async function enqueueEmailCampaignTasks(campaignId, campaignPayload, rows, recipientColumn) {
  if (!emailQueueRuntime.enabled || !emailQueueRuntime.queueClient) {
    return false;
  }

  const subjectTemplate = String(campaignPayload.subjectTemplate || "").trim();
  const bodyTemplate = String(campaignPayload.bodyTemplate || "").trim();
  const bodyFormat = normalizeEmailBodyFormat(campaignPayload.bodyFormat);
  const smtpProvider = resolveSmtpProvider(campaignPayload.smtpProvider);
  const sendRatePerMinute = normalizeSmtpSendRatePerMinute(campaignPayload.sendRatePerMinute);
  const mailFrom = String(campaignPayload.mailFrom || "").trim();
  const replyTo = String(campaignPayload.replyTo || "").trim();
  const baseUrl = String(campaignPayload.baseUrl || "").trim();
  const sanitizedRows = rows.map((row) => sanitizeRowObject(row));

  const taskPayloads = [];
  for (let rowIndex = 0; rowIndex < sanitizedRows.length; rowIndex += 1) {
    const rowData = sanitizedRows[rowIndex];
    const recipient = normalizeEmail(getCell(rowData, recipientColumn));
    taskPayloads.push({
      type: "smtp_email_task",
      campaignId: String(campaignId || ""),
      rowIndex,
      recipient,
      rowData,
      subjectTemplate,
      bodyTemplate,
      bodyFormat,
      smtpProvider,
      sendRatePerMinute,
      mailFrom,
      replyTo,
      baseUrl,
      enqueuedAt: new Date().toISOString(),
    });
  }

  await batchEnqueueEmailTaskMessagesSqs(taskPayloads);

  await dbPool.query(
    `
      UPDATE campaigns
      SET status = 'running',
          started_at = COALESCE(started_at, NOW()),
          updated_at = NOW(),
          last_message = 'Queued in AWS SQS'

      WHERE id = $1
    `,
    [campaignId],
  );

  const campaign = await getCampaignById(campaignId);
  broadcastCampaignSummaryEvent(campaign);

  return true;
}

async function createCampaignWithRecipients(channel, payload, rows, recipientColumn) {
  ensureDbAvailable();

  const campaignId = buildCampaignId(channel);
  const sanitizedRows = rows.map((row) => sanitizeRowObject(row));
  const client = await dbPool.connect();

  try {
    await client.query("BEGIN");
    await client.query(
      `
        INSERT INTO campaigns (
          id, channel, status, total, processed, sent, failed, payload_json, last_message
        )
        VALUES ($1, $2, 'queued', $3, 0, 0, 0, $4::jsonb, 'Queued')
      `,
      [campaignId, channel, sanitizedRows.length, JSON.stringify(payload || {})],
    );

    if (sanitizedRows.length > 0) {
      const campaignIds = Array(sanitizedRows.length).fill(campaignId);
      const rowIndexes = sanitizedRows.map((_, i) => i);
      const recipients = sanitizedRows.map((row) => {
        const recipientRaw = getCell(row, recipientColumn);
        return String((channel === CAMPAIGN_CHANNEL_WHATSAPP ? normalizePhone(recipientRaw) : normalizeEmail(recipientRaw)) || "");
      });
      const rowDatas = sanitizedRows.map((row) => JSON.stringify(row));
      const statuses = Array(sanitizedRows.length).fill('pending');

      await client.query(
        `
          INSERT INTO campaign_recipients (
            campaign_id, row_index, recipient, row_data, status
          )
          SELECT * FROM UNNEST($1::text[], $2::int[], $3::text[], $4::jsonb[], $5::text[])
        `,
        [campaignIds, rowIndexes, recipients, rowDatas, statuses]
      );
    }

    await client.query("COMMIT");
    return campaignId;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function claimNextCampaign(channel) {
  ensureDbAvailable();
  const client = await dbPool.connect();

  try {
    await client.query("BEGIN");
    const result = await client.query(
      `
        SELECT *
        FROM campaigns
        WHERE channel = $1
          AND status IN ('queued', 'running')
        ORDER BY CASE WHEN status = 'running' THEN 0 ELSE 1 END, created_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      `,
      [channel],
    );

    const campaign = result.rows?.[0] || null;
    if (!campaign) {
      await client.query("COMMIT");
      return null;
    }

    if (campaign.stop_requested) {
      await client.query(
        `
          UPDATE campaigns
          SET status = 'stopped',
              completed_at = NOW(),
              updated_at = NOW(),
              last_message = 'Stopped'
          WHERE id = $1
        `,
        [campaign.id],
      );
      await client.query("COMMIT");
      return null;
    }

    await client.query(
      `
        UPDATE campaigns
        SET status = 'running',
            started_at = COALESCE(started_at, NOW()),
            updated_at = NOW(),
            last_message = CASE WHEN status = 'queued' THEN 'Campaign started' ELSE last_message END
        WHERE id = $1
      `,
      [campaign.id],
    );

    await client.query("COMMIT");
    const startedCampaign = {
      ...campaign,
      status: "running",
      updated_at: new Date().toISOString(),
      started_at: campaign.started_at || new Date().toISOString(),
      last_message: campaign.status === "queued" ? "Campaign started" : campaign.last_message,
    };
    broadcastCampaignSummaryEvent(startedCampaign);
    return {
      ...campaign,
      status: "running",
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function claimNextRecipient(campaignId) {
  ensureDbAvailable();
  const client = await dbPool.connect();

  try {
    await client.query("BEGIN");
    const result = await client.query(
      `
        SELECT id, row_index, recipient, row_data
        FROM campaign_recipients
        WHERE campaign_id = $1
          AND status = 'pending'
        ORDER BY row_index ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      `,
      [campaignId],
    );
    const row = result.rows?.[0] || null;
    if (!row) {
      await client.query("COMMIT");
      return null;
    }

    await client.query(
      `
        UPDATE campaign_recipients
        SET status = 'processing',
            updated_at = NOW()
        WHERE id = $1
      `,
      [row.id],
    );

    await client.query("COMMIT");
    return row;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function completeRecipient(campaignId, recipientId, resultPatch = {}) {
  const status = String(resultPatch.status || "failed").toLowerCase();
  const isSuccess = status === "sent";

  await dbPool.query(
    `
      UPDATE campaign_recipients
      SET status = $2,
          provider_message_id = $3,
          error_text = $4,
          processed_at = NOW(),
          updated_at = NOW()
      WHERE id = $1
    `,
    [
      recipientId,
      status,
      resultPatch.providerMessageId ? String(resultPatch.providerMessageId) : null,
      resultPatch.errorText ? String(resultPatch.errorText) : null,
    ],
  );

  const campaignResult = await dbPool.query(
    `
      UPDATE campaigns
      SET processed = processed + 1,
          sent = sent + $2,
          failed = failed + $3,
          last_message = $4,
          updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `,
    [campaignId, isSuccess ? 1 : 0, isSuccess ? 0 : 1, String(resultPatch.lastMessage || "Sending in progress")],
  );

  broadcastCampaignSummaryEvent(campaignResult.rows?.[0] || null);
}

async function finalizeCampaign(campaignId, status, lastMessage) {
  const normalized = String(status || "completed").toLowerCase();
  const result = await dbPool.query(
    `
      UPDATE campaigns
      SET status = $2,
          completed_at = CASE WHEN $2 IN ('completed', 'failed', 'stopped') THEN NOW() ELSE completed_at END,
          updated_at = NOW(),
          last_message = $3
      WHERE id = $1
      RETURNING *
    `,
    [campaignId, normalized, String(lastMessage || "")],
  );

  broadcastCampaignSummaryEvent(result.rows?.[0] || null);
}

async function requestCampaignStop(channel, campaignId = "") {
  ensureDbAvailable();

  const params = [channel];
  let whereSql = `channel = $1`;
  if (campaignId) {
    params.push(String(campaignId));
    whereSql += ` AND id = $2`;
  }

  const target = await dbPool.query(
    `
      SELECT id, status
      FROM campaigns
      WHERE ${whereSql}
      ORDER BY created_at DESC
      LIMIT 1
    `,
    params,
  );

  const found = target.rows?.[0] || null;
  if (!found) {
    return null;
  }

  const status = String(found.status || "").toLowerCase();
  if (CAMPAIGN_STATUS_TERMINAL.has(status)) {
    return await getCampaignById(found.id);
  }

  await dbPool.query(
    `
      UPDATE campaigns
      SET stop_requested = TRUE,
          status = CASE WHEN status = 'queued' THEN 'stopped' ELSE status END,
          completed_at = CASE WHEN status = 'queued' THEN NOW() ELSE completed_at END,
          updated_at = NOW(),
          last_message = CASE WHEN status = 'queued' THEN 'Stopped' ELSE 'Stop requested' END
      WHERE id = $1
    `,
    [found.id],
  );

  const campaign = await getCampaignById(found.id);
  broadcastCampaignSummaryEvent(campaign);
  return campaign;
}

async function shouldStopCampaign(campaignId) {
  const current = await getCampaignById(campaignId);
  if (!current) {
    return true;
  }
  return Boolean(current.stop_requested);
}

module.exports = {
  buildCampaignId,
  sanitizeRowObject,
  buildValueOverridesFromMapping,
  buildCampaignSummary,
  getCampaignById,
  getLatestCampaign,
  getLiveCampaignSummary,
  broadcastCampaignSummaryEvent,
  createEmailCampaignRecord,
  enqueueEmailCampaignTasks,
  createCampaignWithRecipients,
  claimNextCampaign,
  claimNextRecipient,
  completeRecipient,
  finalizeCampaign,
  requestCampaignStop,
  shouldStopCampaign
};
