/**
 * Conversation Model
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


function getOrCreateConversation(participant) {
  const id = getConversationId(participant);
  if (!id) {
    return null;
  }

  if (!conversations.has(id)) {
    conversations.set(id, {
      id,
      participant,
      replyTo: "",
      unread: 0,
      lastTimestamp: new Date().toISOString(),
      messages: [],
    });
  }

  return conversations.get(id);
}

function pushMessage(participant, message, options = {}) {
  const conversation = getOrCreateConversation(participant);
  if (!conversation) {
    return null;
  }

  conversation.messages.push(message);
  if (conversation.messages.length > MAX_MESSAGES_PER_CONVERSATION) {
    conversation.messages = conversation.messages.slice(-MAX_MESSAGES_PER_CONVERSATION);
  }

  if (message.direction === "inbound") {
    conversation.unread += 1;
  }

  conversation.lastTimestamp = message.timestamp;
  if (conversation.participant !== participant && participant) {
    conversation.participant = participant;
  }
  if (message.replyTo) {
    conversation.replyTo = String(message.replyTo).trim();
  }

  while (conversations.size > MAX_CONVERSATIONS) {
    const oldest = Array.from(conversations.values()).sort(
      (a, b) => new Date(a.lastTimestamp).getTime() - new Date(b.lastTimestamp).getTime(),
    )[0];
    if (!oldest) {
      break;
    }
    conversations.delete(oldest.id);
  }

  if (options.persist !== false) {
    void saveMessageToDb(participant, message);
  }
  if (options.broadcast !== false) {
    broadcastInboxEvent({
      type: "message",
      conversationId: conversation.id,
      direction: message.direction || "unknown",
      messageId: message.id || "",
    });
  }

  return conversation;
}

function ingestInboundEvent(event) {
  const data = event?.data || {};
  const senderRaw = String(data.from || "").trim();
  const senderBsuId = String(data.fromBSUID || "").trim();
  const senderNormalized = normalizePhone(senderRaw);
  const participant = senderRaw || senderBsuId;
  if (!participant) {
    return;
  }

  const body =
    data.content ||
    data.button?.text ||
    data.interactive?.buttonReply?.title ||
    data.interactive?.listReply?.title ||
    data.reaction?.emoji ||
    `[${data.messageType || "message"}]`;

  const media = data.media
    ? {
        id: String(data.media.id || "").trim(),
        mimeType: String(data.media.mimeType || "").trim(),
        caption: String(data.media.caption || "").trim(),
        fileName: String(data.media.fileName || "").trim(),
      }
    : null;

  pushMessage(participant, {
    id: String(data.messageId || event.id || `${Date.now()}-${Math.random()}`),
    direction: "inbound",
    type: data.messageType || "unknown",
    text: String(body || "").trim(),
    media,
    replyTo: /^\d{10,15}$/.test(senderNormalized) ? senderNormalized : "",
    timestamp: data.receivedTimestamp || event.eventTime || new Date().toISOString(),
  });
}

function ingestDeliveryStatusEvent(event) {
  const data = event?.data || {};
  const messageId = String(data.messageId || "").trim();
  if (!messageId || !outboundIndex.has(messageId)) {
    pushWebhookLog({
      kind: "delivery_status_unmatched",
      messageId: messageId || null,
      status: data.status || null,
      data,
    });
    return;
  }

  const conversationId = outboundIndex.get(messageId);
  const conversation = conversations.get(conversationId);
  if (!conversation) {
    return;
  }

  const targetMessage = conversation.messages.find((message) => message.id === messageId);
  if (targetMessage) {
    targetMessage.status = formatDeliveryStatusLabel(data.status || "Sent");
    targetMessage.statusDetails =
      data.error?.message ||
      data.error?.code ||
      data.reason ||
      data.deliveryStatusDetails ||
      data.channelStatusMessage ||
      "";
  }
  broadcastInboxEvent({
    type: "status",
    conversationId,
    messageId,
    status: data.status || "Sent",
  });
  void updateMessageStatusInDb(
    messageId,
    formatDeliveryStatusLabel(data.status || "Sent"),
    data.error?.message ||
      data.error?.code ||
      data.reason ||
      data.deliveryStatusDetails ||
      data.channelStatusMessage ||
      "",
  );

  pushWebhookLog({
    kind: "delivery_status",
    conversationId,
    messageId,
    status: data.status || null,
    details:
      data.error?.message ||
      data.error?.code ||
      data.reason ||
      data.deliveryStatusDetails ||
      data.channelStatusMessage ||
      null,
    data,
  });
}

function markConversationRead(conversationId) {
  const conversation = conversations.get(conversationId);
  if (conversation && conversation.unread > 0) {
    conversation.unread = 0;
    broadcastInboxEvent({
      type: "read",
      conversationId: conversation.id,
    });
  }
  return conversation;
}

function buildReportSummary(messages) {
  return messages.reduce(
    (summary, message) => {
      const normalized = normalizeDeliveryStatus(message.status);
      summary.sent += 1;
      if (normalized === "delivered") {
        summary.delivered += 1;
      }
      if (normalized === "failed") {
        summary.failed += 1;
      }
      return summary;
    },
    { sent: 0, delivered: 0, failed: 0 },
  );
}

async function getReportSummaryCounts() {
  const now = Date.now();
  if (reportSummaryCache.expiresAt > now) {
    return reportSummaryCache.value;
  }

  ensureDbAvailable();

  const result = await dbPool.query(`
    SELECT
      COUNT(*)::int AS sent,
      COALESCE(
        SUM(
          CASE
            WHEN LOWER(COALESCE(status, '')) IN ('delivered', 'deliverysuccess', 'success', 'read', 'seen')
            THEN 1 ELSE 0
          END
        ),
        0
      )::int AS delivered,
      COALESCE(
        SUM(
          CASE
            WHEN LOWER(COALESCE(status, '')) IN ('failed', 'deliveryfailed', 'error', 'undelivered')
            THEN 1 ELSE 0
          END
        ),
        0
      )::int AS failed
    FROM whatsapp_messages
    WHERE direction = 'outbound'
  `);

  const row = result.rows?.[0] || {};
  const summary = {
    sent: Number(row.sent || 0),
    delivered: Number(row.delivered || 0),
    failed: Number(row.failed || 0),
  };
  reportSummaryCache = {
    value: summary,
    expiresAt: now + REPORT_SUMMARY_CACHE_TTL_MS,
  };
  return summary;
}

async function getReportRows(limit = 200, options = {}) {
  const includeMessageText = options.includeMessageText === true;
  ensureDbAvailable();

  const selectMessageText = includeMessageText ? ", message_text" : "";
  const result = await dbPool.query(
    `
      SELECT
        id,
        participant,
        reply_to,
        direction,
        message_type,
        template_name,
        status,
        status_details,
        message_timestamp
        ${selectMessageText}
      FROM whatsapp_messages
      WHERE direction = 'outbound'
      ORDER BY message_timestamp DESC
      LIMIT $1
    `,
    [Math.max(1, Math.min(2000, limit))],
  );

  return (result.rows || []).map((row) => ({
    id: row.id || "",
    participant: row.participant || "",
    replyTo: row.reply_to || "",
    type: row.message_type || "",
    templateName: row.template_name || "",
    text: includeMessageText ? row.message_text || "" : "",
    status: formatDeliveryStatusLabel(row.status || "Sent"),
    statusDetails: String(row.status_details || "").trim(),
    timestamp: new Date(row.message_timestamp).toISOString(),
  }));
}

async function getReportPayload(limit = 200, options = {}) {
  const summaryOnly = options.summaryOnly === true;
  if (summaryOnly) {
    return {
      summary: await getReportSummaryCounts(),
      rows: [],
    };
  }

  const includeMessageText = options.includeMessageText === true;
  const rows = await getReportRows(limit, { includeMessageText });
  return {
    summary: buildReportSummary(rows),
    rows,
  };
}

async function getDashboardSummaryPayload(options = {}) {
  const reportPayload = await getReportPayload(1, {
    summaryOnly: true,
    includeMessageText: false,
  });
  return {
    inbox: getInboxCountSummary(),
    report: reportPayload.summary,
  };
}

function getInboxSummary(limit = 10, offset = 0, options = {}) {
  const recentFullLimit = Number.isFinite(options.recentFullLimit)
    ? Math.max(20, Math.min(MAX_MESSAGES_PER_CONVERSATION, Math.floor(options.recentFullLimit)))
    : 80;
  const includeRecentConversation = options.includeRecentConversation !== false;
  const query = String(options.query || "").trim();

  const sorted = Array.from(conversations.values())
    .filter((conversation) => conversationMatchesQuery(conversation, query))
    .sort((a, b) => new Date(b.lastTimestamp).getTime() - new Date(a.lastTimestamp).getTime())
    .map((conversation) => {
      const lastMessage = conversation.messages[conversation.messages.length - 1] || null;
      return {
        id: conversation.id,
        participant: conversation.participant,
        replyTo: conversation.replyTo || "",
        unread: conversation.unread,
        lastTimestamp: conversation.lastTimestamp,
        lastMessage: lastMessage
          ? {
              direction: lastMessage.direction,
              text: truncateText(lastMessage.text, 140),
              status: lastMessage.status || null,
              timestamp: lastMessage.timestamp,
            }
          : null,
      };
    });

  const pageConversations = sorted.slice(offset, offset + limit);
  const recentConversationId = includeRecentConversation && offset === 0 ? pageConversations[0]?.id || "" : "";
  const recentConversationSource = recentConversationId ? conversations.get(recentConversationId) : null;

  return {
    total: sorted.length,
    conversations: pageConversations,
    recentConversation: recentConversationSource
      ? getConversationPayload(recentConversationSource, { limit: recentFullLimit })
      : null,
    hasMore: offset + limit < sorted.length,
    nextOffset: offset + limit < sorted.length ? offset + limit : null,
  };
}

function getInboxCountSummary() {
  const list = Array.from(conversations.values());
  return {
    total: list.length,
    unread: list.reduce((sum, conversation) => sum + Number(conversation.unread || 0), 0),
  };
}

function getConversationPayload(conversation, options = {}) {
  const limit = Number.isFinite(options.limit)
    ? Math.max(20, Math.min(MAX_MESSAGES_PER_CONVERSATION, Math.floor(options.limit)))
    : MAX_MESSAGES_PER_CONVERSATION;
  const messages = conversation.messages.slice(-limit);

  return {
    id: conversation.id,
    participant: conversation.participant,
    replyTo: conversation.replyTo || "",
    unread: conversation.unread,
    totalMessages: conversation.messages.length,
    messages,
  };
}

function conversationMatchesQuery(conversation, query) {
  const text = String(query || "").trim().toLowerCase();
  if (!text) {
    return true;
  }

  const digits = normalizeSearchDigits(text);
  const participant = String(conversation.participant || "");
  const replyTo = String(conversation.replyTo || "");
  const id = String(conversation.id || "");
  const haystack = `${participant} ${replyTo} ${id}`.toLowerCase();
  if (haystack.includes(text)) {
    return true;
  }

  if (!digits) {
    return false;
  }

  const digitHaystack = `${normalizeSearchDigits(participant)} ${normalizeSearchDigits(replyTo)} ${normalizeSearchDigits(id)}`;
  return digitHaystack.includes(digits);
}

async function getConversationPayloadById(conversationId, options = {}) {
  const limit = Number.isFinite(options.limit)
    ? Math.max(20, Math.min(MAX_MESSAGES_PER_CONVERSATION, Math.floor(options.limit)))
    : MAX_MESSAGES_PER_CONVERSATION;

  const inMemoryConversation = conversations.get(conversationId);
  if (inMemoryConversation) {
    return getConversationPayload(inMemoryConversation, { limit });
  }

  ensureDbAvailable();

  const rowsResult = await dbPool.query(
    `
      SELECT
        id,
        conversation_id,
        participant,
        reply_to,
        direction,
        message_type,
        message_text,
        media_json,
        template_name,
        status,
        status_details,
        message_timestamp
      FROM whatsapp_messages
      WHERE conversation_id = $1
      ORDER BY message_timestamp DESC
      LIMIT $2
    `,
    [conversationId, limit],
  );

  const rows = Array.isArray(rowsResult.rows) ? rowsResult.rows : [];
  if (!rows.length) {
    return null;
  }

  const latestRow = rows[0];
  const messages = rows
    .slice()
    .reverse()
    .map((row) => ({
      id: row.id || "",
      direction: row.direction || "unknown",
      type: row.message_type || "unknown",
      text: row.message_text || "",
      media: row.media_json && typeof row.media_json === "object" ? row.media_json : null,
      templateName: row.template_name || "",
      status: row.status ? formatDeliveryStatusLabel(row.status) : undefined,
      statusDetails: row.status_details ? String(row.status_details) : undefined,
      replyTo: row.reply_to || "",
      timestamp: new Date(row.message_timestamp).toISOString(),
    }));

  return {
    id: latestRow.conversation_id || conversationId,
    participant: latestRow.participant || latestRow.reply_to || latestRow.conversation_id || "Unknown",
    replyTo: latestRow.reply_to || "",
    unread: 0,
    totalMessages: messages.length,
    messages,
  };
}

async function getInboxSummaryFromDb(limit = 10, offset = 0, options = {}) {
  const recentFullLimit = Number.isFinite(options.recentFullLimit)
    ? Math.max(20, Math.min(MAX_MESSAGES_PER_CONVERSATION, Math.floor(options.recentFullLimit)))
    : 80;
  const includeRecentConversation = options.includeRecentConversation !== false;
  const query = String(options.query || "").trim();
  const digitsQuery = normalizeSearchDigits(query);

  ensureDbAvailable();

  const params = [];
  const whereClauses = [];

  if (query) {
    params.push(`%${query.toLowerCase()}%`);
    const textParam = `$${params.length}`;
    whereClauses.push(`(
      LOWER(COALESCE(participant, '')) LIKE ${textParam}
      OR LOWER(COALESCE(reply_to, '')) LIKE ${textParam}
      OR LOWER(COALESCE(conversation_id, '')) LIKE ${textParam}
    )`);

    if (digitsQuery) {
      params.push(`%${digitsQuery}%`);
      const digitsParam = `$${params.length}`;
      whereClauses.push(`(
        REGEXP_REPLACE(COALESCE(participant, ''), '\\D', '', 'g') LIKE ${digitsParam}
        OR REGEXP_REPLACE(COALESCE(reply_to, ''), '\\D', '', 'g') LIKE ${digitsParam}
        OR REGEXP_REPLACE(COALESCE(conversation_id, ''), '\\D', '', 'g') LIKE ${digitsParam}
      )`);
    }
  }

  const whereSql = whereClauses.length ? `WHERE ${whereClauses.join(" OR ")}` : "";

  params.push(limit);
  const limitParam = `$${params.length}`;
  params.push(offset);
  const offsetParam = `$${params.length}`;

  const result = await dbPool.query(
    `
      WITH ranked AS (
        SELECT
          conversation_id,
          participant,
          reply_to,
          direction,
          message_text,
          status,
          message_timestamp,
          ROW_NUMBER() OVER (PARTITION BY conversation_id ORDER BY message_timestamp DESC) AS rn
        FROM whatsapp_messages
        ${whereSql}
      ),
      latest AS (
        SELECT
          conversation_id,
          participant,
          reply_to,
          direction,
          message_text,
          status,
          message_timestamp
        FROM ranked
        WHERE rn = 1
      )
      SELECT
        conversation_id,
        participant,
        reply_to,
        direction,
        message_text,
        status,
        message_timestamp,
        COUNT(*) OVER()::int AS total_count
      FROM latest
      ORDER BY message_timestamp DESC
      LIMIT ${limitParam}
      OFFSET ${offsetParam}
    `,
    params,
  );

  const rows = Array.isArray(result.rows) ? result.rows : [];
  const total = rows[0]?.total_count ? Number(rows[0].total_count) : 0;
  const pageConversations = rows.map((row) => {
    const id = String(row.conversation_id || "");
    const memoryConversation = conversations.get(id);
    const unread = Number(memoryConversation?.unread || 0);

    return {
      id,
      participant: row.participant || row.reply_to || id || "Unknown",
      replyTo: row.reply_to || "",
      unread,
      lastTimestamp: new Date(row.message_timestamp).toISOString(),
      lastMessage: {
        direction: row.direction || "unknown",
        text: truncateText(row.message_text || "", 140),
        status: row.status ? formatDeliveryStatusLabel(row.status) : null,
        timestamp: new Date(row.message_timestamp).toISOString(),
      },
    };
  });

  const recentConversationId =
    includeRecentConversation && offset === 0 ? pageConversations[0]?.id || "" : "";
  const recentConversation = recentConversationId
    ? await getConversationPayloadById(recentConversationId, { limit: recentFullLimit })
    : null;

  return {
    total,
    conversations: pageConversations,
    recentConversation,
    hasMore: offset + limit < total,
    nextOffset: offset + limit < total ? offset + limit : null,
  };
}

function pushWebhookLog(entry) {
  webhookEventLog.push({
    timestamp: new Date().toISOString(),
    ...entry,
  });
  if (webhookEventLog.length > MAX_EVENT_LOGS) {
    webhookEventLog.splice(0, webhookEventLog.length - MAX_EVENT_LOGS);
  }
}

module.exports = {
  getOrCreateConversation,
  pushMessage,
  ingestInboundEvent,
  ingestDeliveryStatusEvent,
  markConversationRead,
  buildReportSummary,
  getReportSummaryCounts,
  getReportRows,
  getReportPayload,
  getDashboardSummaryPayload,
  getInboxSummary,
  getInboxCountSummary,
  getConversationPayload,
  conversationMatchesQuery,
  getConversationPayloadById,
  getInboxSummaryFromDb,
  pushWebhookLog
};
