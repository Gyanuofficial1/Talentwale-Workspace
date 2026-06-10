/**
 * Email Model
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


async function loadEmailUnsubscribesFromDb() {
  unsubscribedEmailRecipients.clear();
  console.log("Email unsubscribes are now dynamically loaded on demand.");
}

async function loadEmailSuppressionsFromDb() {
  suppressedEmailRecipients.clear();
  console.log("Email suppressions are now dynamically loaded on demand.");
}

async function upsertEmailSuppression(email, options = {}) {
  const recipient = normalizeEmail(email);
  if (!isValidEmail(recipient)) {
    return;
  }
  if (!dbPool) {
    return;
  }

  try {
    await dbPool.query(
      `
        INSERT INTO email_suppressions (
          email, source, reason, first_seen_at, last_seen_at, updated_at
        )
        VALUES ($1, $2, $3, NOW(), NOW(), NOW())
        ON CONFLICT (email)
        DO UPDATE SET
          source = EXCLUDED.source,
          reason = EXCLUDED.reason,
          last_seen_at = NOW(),
          updated_at = NOW()
      `,
      [
        recipient,
        String(options.source || "hard_bounce").trim() || "hard_bounce",
        String(options.reason || "").trim() || null,
      ],
    );
  } catch (error) {
    console.error("Failed to upsert email suppression.", error.message || error);
  }
}

async function logEmailRejection(entry = {}) {
  if (!dbPool) {
    return;
  }

  const recipient = normalizeEmail(entry.recipient);
  if (!recipient) {
    return;
  }

  const gate = String(entry.gate || "preflight").trim().toLowerCase();
  const reason = String(entry.reason || "Email rejected").trim();

  try {
    await dbPool.query(
      `
        INSERT INTO email_rejections (
          campaign_id, recipient, gate, verdict, reason, source, row_index, row_data
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
      `,
      [
        String(entry.campaignId || "").trim() || null,
        recipient,
        gate || "preflight",
        String(entry.verdict || "rejected").trim().toLowerCase() || "rejected",
        reason,
        String(entry.source || "preflight").trim().toLowerCase() || "preflight",
        Number.isFinite(entry.rowIndex) ? Number(entry.rowIndex) : null,
        JSON.stringify(sanitizeRowObject(entry.rowData)),
      ],
    );
  } catch (error) {
    console.error("Failed to save email rejection.", error.message || error);
  }
}

async function getEmailRejectionList(options = {}) {
  ensureDbAvailable();

  const limit = Number.isFinite(options.limit)
    ? Math.max(1, Math.min(2000, Math.floor(options.limit)))
    : 200;
  const offset = Number.isFinite(options.offset) ? Math.max(0, Math.floor(options.offset)) : 0;
  const campaignId = String(options.campaignId || "").trim();
  const recipient = normalizeEmail(options.recipient || "");

  const whereParts = [];
  const params = [];

  if (campaignId) {
    params.push(campaignId);
    whereParts.push(`campaign_id = $${params.length}`);
  }

  if (recipient) {
    params.push(recipient);
    whereParts.push(`recipient = $${params.length}`);
  }

  const whereSql = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";

  params.push(limit);
  const limitParam = `$${params.length}`;
  params.push(offset);
  const offsetParam = `$${params.length}`;

  const result = await dbPool.query(
    `
      SELECT
        id,
        campaign_id,
        recipient,
        gate,
        verdict,
        reason,
        source,
        row_index,
        row_data,
        created_at,
        COUNT(*) OVER()::int AS total_count
      FROM email_rejections
      ${whereSql}
      ORDER BY created_at DESC
      LIMIT ${limitParam}
      OFFSET ${offsetParam}
    `,
    params,
  );

  const rows = Array.isArray(result.rows) ? result.rows : [];
  const total = Number(rows[0]?.total_count || 0);

  return {
    total,
    items: rows.map((row) => ({
      id: Number(row.id || 0),
      campaignId: String(row.campaign_id || ""),
      recipient: String(row.recipient || ""),
      gate: String(row.gate || ""),
      verdict: String(row.verdict || "rejected"),
      reason: String(row.reason || ""),
      source: String(row.source || ""),
      rowIndex: Number.isFinite(Number(row.row_index)) ? Number(row.row_index) : null,
      rowData: row.row_data && typeof row.row_data === "object" ? row.row_data : {},
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : "",
    })),
    hasMore: offset + rows.length < total,
    nextOffset: offset + rows.length < total ? offset + rows.length : null,
  };
}

async function isEmailUnsubscribed(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) {
    return false;
  }
  if (unsubscribedEmailRecipients.has(normalized)) {
    return true;
  }

  if (!dbPool) {
    return false;
  }

  try {
    const result = await dbPool.query(
      `SELECT 1 FROM email_unsubscribes WHERE email = $1 LIMIT 1`,
      [normalized]
    );
    if (result.rows && result.rows.length > 0) {
      unsubscribedEmailRecipients.add(normalized);
      return true;
    }
  } catch (error) {
    console.error("Failed to check email unsubscribe status.", error.message || error);
  }
  return false;
}

async function isEmailSuppressed(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) {
    return false;
  }
  if (suppressedEmailRecipients.has(normalized)) {
    return true;
  }

  if (!dbPool) {
    return false;
  }

  try {
    const result = await dbPool.query(
      `SELECT 1 FROM email_suppressions WHERE email = $1 LIMIT 1`,
      [normalized]
    );
    if (result.rows && result.rows.length > 0) {
      suppressedEmailRecipients.add(normalized);
      return true;
    }
  } catch (error) {
    console.error("Failed to check email suppression status.", error.message || error);
  }
  return false;
}

async function getSuppressedCount() {
  if (!dbPool) return suppressedEmailRecipients.size;
  try {
    const result = await dbPool.query('SELECT COUNT(*)::int AS count FROM email_suppressions');
    return result.rows[0].count;
  } catch (e) {
    return suppressedEmailRecipients.size;
  }
}

async function markRecipientUnsubscribed(email, options = {}) {
  const recipient = normalizeEmail(email);
  if (!isValidEmail(recipient)) {
    throw new Error("Valid email is required to unsubscribe.");
  }

  unsubscribedEmailRecipients.add(recipient);

  await dbPool.query(
    `
      INSERT INTO email_unsubscribes (
        email, source, campaign_id, token_hash, updated_at
      )
      VALUES ($1, $2, $3, $4, NOW())
      ON CONFLICT (email)
      DO UPDATE SET
        source = EXCLUDED.source,
        campaign_id = COALESCE(EXCLUDED.campaign_id, email_unsubscribes.campaign_id),
        token_hash = COALESCE(EXCLUDED.token_hash, email_unsubscribes.token_hash),
        updated_at = NOW()
    `,
    [
      recipient,
      String(options.source || "footer_link").trim() || "footer_link",
      String(options.campaignId || "").trim() || null,
      String(options.tokenHash || "").trim() || null,
    ],
  );
}

async function logEmailEngagementEvent(entry = {}) {
  if (!dbPool) {
    return;
  }

  const eventType = String(entry.eventType || "").trim().toLowerCase();
  if (!["open", "click"].includes(eventType)) {
    return;
  }

  const campaignId = String(entry.campaignId || "").trim() || null;
  const recipient = normalizeEmail(entry.recipient || "") || null;
  const targetUrl =
    eventType === "click" ? normalizeTrackableTargetUrl(entry.targetUrl || "") || String(entry.targetUrl || "") : null;

  try {
    await dbPool.query(
      `
        INSERT INTO email_engagement_events (
          campaign_id,
          recipient,
          event_type,
          target_url,
          row_index,
          provider_message_id,
          token_hash,
          user_agent,
          referer,
          ip_address,
          created_at
        )
        SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW()
        WHERE NOT EXISTS (
          SELECT 1 FROM email_engagement_events
          WHERE campaign_id = $1
            AND recipient = $2
            AND event_type = $3
            AND COALESCE(target_url, '') = COALESCE($4, '')
            AND created_at > NOW() - INTERVAL '10 seconds'
        )
      `,
      [
        campaignId,
        recipient,
        eventType,
        targetUrl,
        Number.isFinite(Number(entry.rowIndex)) ? Number(entry.rowIndex) : null,
        String(entry.providerMessageId || "").trim() || null,
        String(entry.tokenHash || "").trim() || null,
        String(entry.userAgent || "").slice(0, 1000) || null,
        String(entry.referer || "").slice(0, 1000) || null,
        String(entry.ipAddress || "").slice(0, 128) || null,
      ],
    );
  } catch (error) {
    console.error("Failed to save email engagement event.", error.message || error);
  }
}

async function getEmailAnalyticsPayload(options = {}) {
  ensureDbAvailable();

  const campaignId = String(options.campaignId || "").trim();
  const range = String(options.range || "").trim().toLowerCase();
  const days = Number.isFinite(Number(options.days))
    ? Math.max(1, Math.min(90, Math.floor(Number(options.days))))
    : 14;
  const recipientLimit = Number.isFinite(Number(options.recipientLimit))
    ? Math.max(1, Math.min(500, Math.floor(Number(options.recipientLimit))))
    : 100;
  const topLinksLimit = Number.isFinite(Number(options.topLinksLimit))
    ? Math.max(1, Math.min(100, Math.floor(Number(options.topLinksLimit))))
    : 10;
  const detailLimit = Number.isFinite(Number(options.detailLimit))
    ? Math.max(1, Math.min(5000, Math.floor(Number(options.detailLimit))))
    : 10;
  const detailOffset = Number.isFinite(Number(options.detailOffset))
    ? Math.max(0, Math.floor(Number(options.detailOffset)))
    : 0;
  const includeEmptyTimeline = parseTruthyValue(options.includeEmptyTimeline, false);

  const campaignParams = [CAMPAIGN_CHANNEL_EMAIL];
  let campaignWhere = `channel = $1`;
  if (campaignId) {
    campaignParams.push(campaignId);
    campaignWhere += ` AND id = $${campaignParams.length}`;
  }

  const campaignTotalsResult = await dbPool.query(
    `
      SELECT
        COALESCE(SUM(total), 0)::int AS audience,
        COALESCE(SUM(processed), 0)::int AS processed,
        COALESCE(SUM(sent), 0)::int AS sent,
        COALESCE(SUM(failed), 0)::int AS failed
      FROM campaigns
      WHERE ${campaignWhere}
    `,
    campaignParams,
  );
  const campaignTotals = campaignTotalsResult.rows?.[0] || {};

  const eventsParams = [];
  const eventsWhere = [];
  if (campaignId) {
    eventsParams.push(campaignId);
    eventsWhere.push(`campaign_id = $${eventsParams.length}`);
  }
  const eventsWhereSql = eventsWhere.length ? `WHERE ${eventsWhere.join(" AND ")}` : "";

  const eventsSummaryResult = await dbPool.query(
    `
      SELECT
        COALESCE(COUNT(*) FILTER (WHERE event_type = 'open'), 0)::int AS opens,
        COALESCE(COUNT(*) FILTER (WHERE event_type = 'click'), 0)::int AS clicks,
        COALESCE(COUNT(DISTINCT CASE WHEN event_type = 'open' THEN recipient END), 0)::int AS unique_opens,
        COALESCE(COUNT(DISTINCT CASE WHEN event_type = 'click' THEN recipient END), 0)::int AS unique_clicks,
        COALESCE(COUNT(DISTINCT CASE WHEN COALESCE(recipient, '') <> '' THEN recipient END), 0)::int AS engaged_recipients
      FROM email_engagement_events
      ${eventsWhereSql}
    `,
    eventsParams,
  );
  const eventsSummary = eventsSummaryResult.rows?.[0] || {};

  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);

  let resolvedRange = range;
  let timelineGranularity = "day";
  let timelineStart = new Date(now.getTime() - (days - 1) * 24 * 60 * 60 * 1000);
  timelineStart.setHours(0, 0, 0, 0);
  let timelineEndExclusive = new Date(now);

  if (resolvedRange === "today") {
    timelineGranularity = "hour";
    timelineStart = new Date(startOfToday);
    timelineEndExclusive = new Date(now);
  } else if (resolvedRange === "yesterday") {
    timelineGranularity = "hour";
    timelineEndExclusive = new Date(startOfToday);
    timelineStart = new Date(startOfToday);
    timelineStart.setDate(timelineStart.getDate() - 1);
  } else {
    const rangeMatch = resolvedRange.match(/^(\d{1,2})d$/i);
    if (rangeMatch) {
      const rangeDays = Math.max(1, Math.min(90, Number(rangeMatch[1])));
      timelineStart = new Date(now);
      timelineStart.setHours(0, 0, 0, 0);
      timelineStart.setDate(timelineStart.getDate() - (rangeDays - 1));
    } else {
      resolvedRange = `${days}d`;
      timelineStart = new Date(now);
      timelineStart.setHours(0, 0, 0, 0);
      timelineStart.setDate(timelineStart.getDate() - (days - 1));
    }
  }

  const timelineBucketSql = timelineGranularity === "hour" ? "DATE_TRUNC('hour', created_at)" : "DATE_TRUNC('day', created_at)";
  const timelineParams = [timelineStart.toISOString(), timelineEndExclusive.toISOString()];
  const timelineWhere = [`created_at >= $1`, `created_at < $2`];
  if (campaignId) {
    timelineParams.push(campaignId);
    timelineWhere.push(`campaign_id = $${timelineParams.length}`);
  }

  const timelineResult = await dbPool.query(
    `
      SELECT
        ${timelineBucketSql} AS bucket,
        COALESCE(COUNT(*) FILTER (WHERE event_type = 'open'), 0)::int AS opens,
        COALESCE(COUNT(*) FILTER (WHERE event_type = 'click'), 0)::int AS clicks
      FROM email_engagement_events
      WHERE ${timelineWhere.join(" AND ")}
      GROUP BY ${timelineBucketSql}
      ORDER BY bucket ASC
    `,
    timelineParams,
  );

  const timelineRows = (timelineResult.rows || []).map((row) => {
    const bucketDate = new Date(row.bucket);
    const dayKey = bucketDate.toISOString().slice(0, 10);
    const hourLabel = `${String(bucketDate.getHours()).padStart(2, "0")}:00`;
    return {
      bucket: bucketDate.toISOString(),
      bucketKey:
        timelineGranularity === "hour"
          ? Math.floor(bucketDate.getTime() / (60 * 60 * 1000))
          : Math.floor(bucketDate.getTime() / (24 * 60 * 60 * 1000)),
      day: dayKey,
      label: timelineGranularity === "hour" ? hourLabel : dayKey.slice(5),
      opens: Number(row.opens || 0),
      clicks: Number(row.clicks || 0),
    };
  });

  const timeline = [];
  if (includeEmptyTimeline) {
    const bucketSizeMs = timelineGranularity === "hour" ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
    const timelineMap = new Map(
      timelineRows.map((row) => [row.bucketKey, { opens: row.opens, clicks: row.clicks }]),
    );
    const cursor = new Date(timelineStart);
    while (cursor < timelineEndExclusive) {
      const bucketDate = new Date(cursor);
      const bucket = bucketDate.toISOString();
      const bucketKey = Math.floor(bucketDate.getTime() / bucketSizeMs);
      const existing = timelineMap.get(bucketKey);
      const dayKey = bucketDate.toISOString().slice(0, 10);
      const label = timelineGranularity === "hour"
        ? `${String(bucketDate.getHours()).padStart(2, "0")}:00`
        : dayKey.slice(5);

      if (existing) {
        timeline.push({
          bucket,
          day: dayKey,
          label,
          opens: Number(existing.opens || 0),
          clicks: Number(existing.clicks || 0),
        });
      } else {
        timeline.push({
          bucket,
          day: dayKey,
          label,
          opens: 0,
          clicks: 0,
        });
      }

      if (timelineGranularity === "hour") {
        cursor.setHours(cursor.getHours() + 1, 0, 0, 0);
      } else {
        cursor.setDate(cursor.getDate() + 1);
        cursor.setHours(0, 0, 0, 0);
      }
    }
  } else {
    timeline.push(...timelineRows);
  }

  const topLinksParams = [];
  const topLinksWhere = [`event_type = 'click'`, `COALESCE(target_url, '') <> ''`];
  if (campaignId) {
    topLinksParams.push(campaignId);
    topLinksWhere.push(`campaign_id = $${topLinksParams.length}`);
  }
  topLinksParams.push(topLinksLimit);
  const topLinksResult = await dbPool.query(
    `
      SELECT
        target_url,
        COUNT(*)::int AS clicks,
        COUNT(DISTINCT recipient)::int AS unique_clicks
      FROM email_engagement_events
      WHERE ${topLinksWhere.join(" AND ")}
      GROUP BY target_url
      ORDER BY clicks DESC, unique_clicks DESC
      LIMIT $${topLinksParams.length}
    `,
    topLinksParams,
  );

  const detailWhere = [];
  const detailParams = [];
  if (campaignId) {
    detailParams.push(campaignId);
    detailWhere.push(`campaign_id = $${detailParams.length}`);
  }
  const detailWhereSql = detailWhere.length ? `WHERE ${detailWhere.join(" AND ")}` : "";

  const detailCountResult = await dbPool.query(
    `
      SELECT COUNT(*)::int AS total_records
      FROM email_engagement_events
      ${detailWhereSql}
    `,
    detailParams,
  );

  const detailRowsParams = [...detailParams, detailLimit, detailOffset];
  const detailRowsResult = await dbPool.query(
    `
      WITH filtered AS (
        SELECT
          id,
          campaign_id,
          recipient,
          event_type,
          target_url,
          created_at,
          COUNT(*) OVER (
            PARTITION BY LOWER(COALESCE(recipient, '')), event_type, COALESCE(target_url, '')
          )::int AS total_count_for_signature,
          ROW_NUMBER() OVER (
            PARTITION BY LOWER(COALESCE(recipient, '')), event_type, COALESCE(target_url, '')
            ORDER BY created_at ASC, id ASC
          )::int AS occurrence_count
        FROM email_engagement_events
        ${detailWhereSql}
      )
      SELECT
        id,
        campaign_id,
        recipient,
        event_type,
        target_url,
        created_at,
        total_count_for_signature,
        occurrence_count
      FROM filtered
      ORDER BY created_at DESC, id DESC
      LIMIT $${detailParams.length + 1}
      OFFSET $${detailParams.length + 2}
    `,
    detailRowsParams,
  );

  const statusParams = [CAMPAIGN_CHANNEL_EMAIL];
  let statusWhere = `c.channel = $1`;
  if (campaignId) {
    statusParams.push(campaignId);
    statusWhere += ` AND c.id = $${statusParams.length}`;
  }
  const recipientStatusResult = await dbPool.query(
    `
      SELECT
        LOWER(COALESCE(cr.recipient, '')) AS recipient_key,
        MIN(COALESCE(cr.recipient, '')) AS recipient,
        COALESCE(COUNT(*) FILTER (WHERE cr.status = 'sent'), 0)::int AS sent_count,
        COALESCE(COUNT(*) FILTER (WHERE cr.status = 'failed'), 0)::int AS failed_count
      FROM campaign_recipients cr
      INNER JOIN campaigns c ON c.id = cr.campaign_id
      WHERE ${statusWhere}
      GROUP BY LOWER(COALESCE(cr.recipient, ''))
    `,
    statusParams,
  );

  const recipientEventsParams = [];
  const recipientEventsWhere = [`COALESCE(recipient, '') <> ''`];
  if (campaignId) {
    recipientEventsParams.push(campaignId);
    recipientEventsWhere.push(`campaign_id = $${recipientEventsParams.length}`);
  }
  const recipientEventsResult = await dbPool.query(
    `
      SELECT
        LOWER(COALESCE(recipient, '')) AS recipient_key,
        MIN(COALESCE(recipient, '')) AS recipient,
        COALESCE(COUNT(*) FILTER (WHERE event_type = 'open'), 0)::int AS opens,
        COALESCE(COUNT(*) FILTER (WHERE event_type = 'click'), 0)::int AS clicks,
        MAX(created_at) AS last_event_at
      FROM email_engagement_events
      WHERE ${recipientEventsWhere.join(" AND ")}
      GROUP BY LOWER(COALESCE(recipient, ''))
    `,
    recipientEventsParams,
  );

  const recipientMap = new Map();
  for (const row of recipientStatusResult.rows || []) {
    const key = String(row.recipient_key || "").trim();
    if (!key) {
      continue;
    }
    recipientMap.set(key, {
      recipient: String(row.recipient || key),
      sent: Number(row.sent_count || 0),
      failed: Number(row.failed_count || 0),
      opens: 0,
      clicks: 0,
      lastEventAt: "",
    });
  }

  for (const row of recipientEventsResult.rows || []) {
    const key = String(row.recipient_key || "").trim();
    if (!key) {
      continue;
    }
    const existing = recipientMap.get(key) || {
      recipient: String(row.recipient || key),
      sent: 0,
      failed: 0,
      opens: 0,
      clicks: 0,
      lastEventAt: "",
    };
    existing.opens = Number(row.opens || 0);
    existing.clicks = Number(row.clicks || 0);
    existing.lastEventAt = row.last_event_at ? new Date(row.last_event_at).toISOString() : existing.lastEventAt;
    recipientMap.set(key, existing);
  }

  const recipients = Array.from(recipientMap.values())
    .map((item) => ({
      ...item,
      openRate: toPercent(item.opens, item.sent),
      clickRate: toPercent(item.clicks, item.sent),
    }))
    .sort((a, b) => {
      if (b.clicks !== a.clicks) {
        return b.clicks - a.clicks;
      }
      if (b.opens !== a.opens) {
        return b.opens - a.opens;
      }
      return b.sent - a.sent;
    })
    .slice(0, recipientLimit);

  const sent = Number(campaignTotals.sent || 0);
  const processed = Number(campaignTotals.processed || 0);
  const failed = Number(campaignTotals.failed || 0);
  const audience = Number(campaignTotals.audience || 0);
  const opens = Number(eventsSummary.opens || 0);
  const clicks = Number(eventsSummary.clicks || 0);
  const uniqueOpens = Number(eventsSummary.unique_opens || 0);
  const uniqueClicks = Number(eventsSummary.unique_clicks || 0);
  const engagedRecipients = Number(eventsSummary.engaged_recipients || 0);
  const effectiveRateBase = sent > 0
    ? sent
    : Math.max(engagedRecipients, uniqueOpens, uniqueClicks, processed, audience);
  const detailTotalRecords = Number(detailCountResult.rows?.[0]?.total_records || 0);
  const detailRecords = (detailRowsResult.rows || []).map((row) => ({
    id: Number(row.id || 0),
    campaignId: String(row.campaign_id || ""),
    recipient: String(row.recipient || ""),
    eventType: String(row.event_type || "").toLowerCase(),
    targetUrl: String(row.target_url || ""),
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : "",
    occurrenceCount: Number(row.occurrence_count || 0),
    totalCountForSignature: Number(row.total_count_for_signature || 0),
  }));

  return {
    campaignId,
    days,
    range: resolvedRange,
    timelineGranularity,
    timelineStart: timelineStart.toISOString(),
    timelineEnd: timelineEndExclusive.toISOString(),
    summary: {
      audience,
      processed,
      sent,
      failed,
      opens,
      clicks,
      uniqueOpens,
      uniqueClicks,
      openRate: toPercent(uniqueOpens, effectiveRateBase),
      clickRate: toPercent(uniqueClicks, effectiveRateBase),
      ctor: toPercent(uniqueClicks, uniqueOpens),
    },
    timeline,
    topLinks: (topLinksResult.rows || []).map((row) => ({
      url: String(row.target_url || ""),
      clicks: Number(row.clicks || 0),
      uniqueClicks: Number(row.unique_clicks || 0),
    })),
    recipients,
    details: {
      campaignId,
      limit: detailLimit,
      offset: detailOffset,
      fetchedCount: detailRecords.length,
      totalRecords: detailTotalRecords,
      hasMore: detailOffset + detailRecords.length < detailTotalRecords,
      records: detailRecords,
    },
    generatedAt: new Date().toISOString(),
  };
}

module.exports = {
  loadEmailUnsubscribesFromDb,
  loadEmailSuppressionsFromDb,
  upsertEmailSuppression,
  logEmailRejection,
  getEmailRejectionList,
  isEmailUnsubscribed,
  isEmailSuppressed,
  getSuppressedCount,
  markRecipientUnsubscribed,
  logEmailEngagementEvent,
  getEmailAnalyticsPayload
};
