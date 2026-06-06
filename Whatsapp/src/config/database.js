/**
 * Database Configuration & Initialization
 * PostgreSQL pool management and table creation.
 */

const { Pool } = require("pg");

let dbPool = null;

function getSupabaseDbConfig() {
  const connectionString = String(process.env.SUPABASE_DB_URL || "").trim();
  if (connectionString) {
    return { connectionString };
  }

  const host = String(process.env.SUPABASE_DB_HOST || "").trim();
  const port = Number(process.env.SUPABASE_DB_PORT || 6543);
  const database = String(process.env.SUPABASE_DB_NAME || "postgres").trim();
  const user = String(process.env.SUPABASE_DB_USER || "").trim();
  const password = String(process.env.SUPABASE_DB_PASSWORD || "").trim();
  const sslMode = String(process.env.SUPABASE_DB_SSLMODE || "require").trim().toLowerCase();

  if (!host || !database || !user || !password) {
    return null;
  }

  return {
    host,
    port,
    database,
    user,
    password,
    ssl: sslMode === "disable" ? false : { rejectUnauthorized: false },
  };
}

async function initDatabase() {
  const config = getSupabaseDbConfig();
  if (!config) {
    throw new Error("Supabase DB config not found. Configure SUPABASE_DB_* or SUPABASE_DB_URL.");
  }

  try {
    dbPool = config.connectionString
      ? new Pool({ connectionString: config.connectionString, ssl: { rejectUnauthorized: false } })
      : new Pool(config);
    global.dbPool = dbPool;

    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS whatsapp_messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        participant TEXT NOT NULL,
        reply_to TEXT NULL,
        direction TEXT NOT NULL,
        message_type TEXT NOT NULL,
        message_text TEXT NULL,
        media_json JSONB NULL,
        template_name TEXT NULL,
        status TEXT NULL,
        status_details TEXT NULL,
        message_timestamp TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await dbPool.query(`
      CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_conversation_timestamp
      ON whatsapp_messages (conversation_id, message_timestamp)
    `);

    await dbPool.query(`
      CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_direction_timestamp
      ON whatsapp_messages (direction, message_timestamp DESC)
    `);

    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS campaigns (
        id TEXT PRIMARY KEY,
        channel TEXT NOT NULL,
        status TEXT NOT NULL,
        stop_requested BOOLEAN NOT NULL DEFAULT FALSE,
        total INTEGER NOT NULL DEFAULT 0,
        processed INTEGER NOT NULL DEFAULT 0,
        sent INTEGER NOT NULL DEFAULT 0,
        failed INTEGER NOT NULL DEFAULT 0,
        payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        last_message TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        started_at TIMESTAMPTZ NULL,
        completed_at TIMESTAMPTZ NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await dbPool.query(`
      CREATE INDEX IF NOT EXISTS idx_campaigns_channel_created
      ON campaigns (channel, created_at DESC)
    `);

    await dbPool.query(`
      CREATE INDEX IF NOT EXISTS idx_campaigns_channel_status
      ON campaigns (channel, status, created_at ASC)
    `);

    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS campaign_recipients (
        id BIGSERIAL PRIMARY KEY,
        campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
        row_index INTEGER NOT NULL,
        recipient TEXT NOT NULL,
        row_data JSONB NOT NULL DEFAULT '{}'::jsonb,
        status TEXT NOT NULL DEFAULT 'pending',
        provider_message_id TEXT NULL,
        error_text TEXT NULL,
        processed_at TIMESTAMPTZ NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await dbPool.query(`
      CREATE INDEX IF NOT EXISTS idx_campaign_recipients_campaign_status
      ON campaign_recipients (campaign_id, status, row_index)
    `);

    await dbPool.query(`
      CREATE INDEX IF NOT EXISTS idx_campaign_recipients_campaign_row
      ON campaign_recipients (campaign_id, row_index)
    `);

    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS smtp_credentials (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        profile_name TEXT NOT NULL,
        host TEXT NOT NULL,
        port INTEGER NOT NULL,
        secure BOOLEAN NOT NULL DEFAULT FALSE,
        user_name TEXT NOT NULL,
        pass_encrypted TEXT NOT NULL,
        from_address TEXT NOT NULL,
        from_name TEXT NOT NULL DEFAULT '',
        reply_to_address TEXT NULL,
        from_options TEXT NOT NULL DEFAULT '',
        is_active BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await dbPool.query(`
      ALTER TABLE smtp_credentials
      ADD COLUMN IF NOT EXISTS from_name TEXT NOT NULL DEFAULT ''
    `);

    await dbPool.query(`
      ALTER TABLE smtp_credentials
      ADD COLUMN IF NOT EXISTS reply_to_address TEXT NULL
    `);

    await dbPool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_smtp_credentials_provider_active
      ON smtp_credentials (provider)
      WHERE is_active = TRUE
    `);

    await dbPool.query(`
      CREATE INDEX IF NOT EXISTS idx_smtp_credentials_provider_updated
      ON smtp_credentials (provider, updated_at DESC)
    `);

    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS email_unsubscribes (
        email TEXT PRIMARY KEY,
        source TEXT NOT NULL DEFAULT 'footer_link',
        campaign_id TEXT NULL,
        token_hash TEXT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await dbPool.query(`
      CREATE INDEX IF NOT EXISTS idx_email_unsubscribes_updated
      ON email_unsubscribes (updated_at DESC)
    `);

    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS email_suppressions (
        email TEXT PRIMARY KEY,
        source TEXT NOT NULL DEFAULT 'hard_bounce',
        reason TEXT NULL,
        first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await dbPool.query(`
      CREATE INDEX IF NOT EXISTS idx_email_suppressions_updated
      ON email_suppressions (updated_at DESC)
    `);

    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS email_rejections (
        id BIGSERIAL PRIMARY KEY,
        campaign_id TEXT NULL,
        recipient TEXT NOT NULL,
        gate TEXT NOT NULL,
        verdict TEXT NOT NULL DEFAULT 'rejected',
        reason TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'preflight',
        row_index INTEGER NULL,
        row_data JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await dbPool.query(`
      CREATE INDEX IF NOT EXISTS idx_email_rejections_campaign_created
      ON email_rejections (campaign_id, created_at DESC)
    `);

    await dbPool.query(`
      CREATE INDEX IF NOT EXISTS idx_email_rejections_recipient_created
      ON email_rejections (recipient, created_at DESC)
    `);

    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS email_engagement_events (
        id BIGSERIAL PRIMARY KEY,
        campaign_id TEXT NULL,
        recipient TEXT NULL,
        event_type TEXT NOT NULL,
        target_url TEXT NULL,
        row_index INTEGER NULL,
        provider_message_id TEXT NULL,
        token_hash TEXT NULL,
        user_agent TEXT NULL,
        referer TEXT NULL,
        ip_address TEXT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await dbPool.query(`
      CREATE INDEX IF NOT EXISTS idx_email_engagement_campaign_event_created
      ON email_engagement_events (campaign_id, event_type, created_at DESC)
    `);

    await dbPool.query(`
      CREATE INDEX IF NOT EXISTS idx_email_engagement_campaign_recipient
      ON email_engagement_events (campaign_id, recipient)
    `);

    console.log("Supabase Postgres connected. Inbox persistence enabled.");
  } catch (error) {
    dbPool = null;
    throw new Error(`Supabase DB init failed: ${error.message || error}`);
  }
}

function ensureDbAvailable() {
  if (!dbPool) {
    throw new Error("Supabase DB connection is required.");
  }
}

function getPool() {
  return dbPool;
}

module.exports = {
  initDatabase,
  ensureDbAvailable,
  getPool,
};
