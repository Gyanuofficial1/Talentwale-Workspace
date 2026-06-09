/**
 * Message Model
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


async function saveMessageToDb(participant, message) {
  ensureDbAvailable();

  const conversationId = getConversationId(participant);
  if (!conversationId || !message?.id) {
    return;
  }

  try {
    await dbPool.query(
      `
        INSERT INTO whatsapp_messages (
          id, conversation_id, participant, reply_to, direction, message_type, message_text,
          media_json, template_name, status, status_details, message_timestamp
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12)
        ON CONFLICT (id) DO NOTHING
      `,
      [
        String(message.id),
        conversationId,
        String(participant || ""),
        String(message.replyTo || ""),
        String(message.direction || "unknown"),
        String(message.type || "unknown"),
        String(message.text || ""),
        message.media ? JSON.stringify(message.media) : null,
        String(message.templateName || ""),
        message.status ? String(message.status) : null,
        message.statusDetails ? String(message.statusDetails) : null,
        new Date(message.timestamp || Date.now()),
      ],
    );
    if (String(message.direction || "").toLowerCase() === "outbound") {
      reportSummaryCache.expiresAt = 0;
    }
  } catch (error) {
    pushWebhookLog({
      kind: "db_save_error",
      error: error.message || "DB save failed.",
      messageId: String(message?.id || ""),
    });
  }
}

async function loadMessagesFromDb() {
  ensureDbAvailable();

  try {
    const result = await dbPool.query(
      `
        SELECT
          id, conversation_id, participant, reply_to, direction, message_type, message_text,
          media_json, template_name, status, status_details, message_timestamp
        FROM whatsapp_messages
        ORDER BY message_timestamp ASC
        LIMIT $1
      `,
      [DB_LOAD_MESSAGE_LIMIT],
    );

    const rows = Array.isArray(result.rows) ? result.rows : [];
    for (const row of rows) {
      const media = row.media_json && typeof row.media_json === "object" ? row.media_json : null;
      pushMessage(
        row.participant || row.conversation_id,
        {
          id: row.id,
          direction: row.direction,
          type: row.message_type,
          text: row.message_text || "",
          media,
          templateName: row.template_name || "",
          status: row.status || undefined,
          statusDetails: row.status_details || undefined,
          replyTo: row.reply_to || "",
          timestamp: new Date(row.message_timestamp).toISOString(),
        },
        { persist: false },
      );
    }
    console.log(`Loaded ${rows.length} messages from Supabase DB.`);
  } catch (error) {
    console.error("Failed to load messages from Supabase DB.", error.message || error);
  }
}

async function updateMessageStatusInDb(messageId, status, statusDetails) {
  if (!messageId) {
    return;
  }
  ensureDbAvailable();

  try {
    await dbPool.query(
      `
        UPDATE whatsapp_messages
        SET status = $2, status_details = $3
        WHERE id = $1
      `,
      [String(messageId), status ? String(status) : null, statusDetails ? String(statusDetails) : null],
    );
    reportSummaryCache.expiresAt = 0;
  } catch (error) {
    pushWebhookLog({
      kind: "db_status_update_error",
      error: error.message || "DB status update failed.",
      messageId: String(messageId),
    });
  }
}

module.exports = {
  saveMessageToDb,
  loadMessagesFromDb,
  updateMessageStatusInDb
};
