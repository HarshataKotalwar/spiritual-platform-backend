import pool from '../../db.js';
import {
  AUDIENCES,
  CATEGORY_COLUMNS,
  CHANNEL_IN_APP,
  DEFAULT_PREFERENCES,
  PREFERENCE_FIELDS,
  REMINDER_TYPES,
  SOURCE_AUTOMATIC,
  TRANSACTIONAL_TYPES,
} from './constants.js';

const BATCH_SIZE = 500;

export const parsePositiveInt = (value) => {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    return null;
  }
  return id;
};

export const interpolate = (template, vars = {}) => {
  const source = String(template || '');
  return source.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => {
    const value = vars[key];
    return value === undefined || value === null ? '' : String(value);
  });
};

export const formatTimingLabel = (minutes) => {
  const value = Number(minutes);
  if (!Number.isInteger(value) || value <= 0) {
    return '';
  }
  if (value % 1440 === 0) {
    const days = value / 1440;
    return days === 1 ? '24 hours before' : `${days} days before`;
  }
  if (value % 60 === 0) {
    const hours = value / 60;
    return hours === 1 ? '1 hour before' : `${hours} hours before`;
  }
  return `${value} minutes before`;
};

const uniqueIds = (ids) => {
  const seen = new Set();
  const result = [];
  for (const value of ids) {
    const id = Number(value);
    if (!Number.isInteger(id) || id <= 0 || seen.has(id)) {
      continue;
    }
    seen.add(id);
    result.push(id);
  }
  return result;
};

export const getOrCreatePreferences = async (userId, client = pool) => {
  const existing = await client.query(
    `
    SELECT
      event_notifications,
      volunteering_notifications,
      camp_notifications,
      course_notifications,
      meditation_notifications,
      community_notifications,
      reminder_notifications,
      updated_at
    FROM notification_preferences
    WHERE user_id = $1
    `,
    [userId]
  );

  if (existing.rows[0]) {
    return existing.rows[0];
  }

  const inserted = await client.query(
    `
    INSERT INTO notification_preferences (user_id)
    VALUES ($1)
    ON CONFLICT (user_id) DO UPDATE SET user_id = EXCLUDED.user_id
    RETURNING
      event_notifications,
      volunteering_notifications,
      camp_notifications,
      course_notifications,
      meditation_notifications,
      community_notifications,
      reminder_notifications,
      updated_at
    `,
    [userId]
  );

  return inserted.rows[0] || DEFAULT_PREFERENCES;
};

const loadPreferenceMap = async (userIds, client = pool) => {
  if (userIds.length === 0) {
    return new Map();
  }

  const result = await client.query(
    `
    SELECT
      user_id,
      event_notifications,
      volunteering_notifications,
      camp_notifications,
      course_notifications,
      meditation_notifications,
      community_notifications,
      reminder_notifications
    FROM notification_preferences
    WHERE user_id = ANY($1::int[])
    `,
    [userIds]
  );

  const map = new Map();
  for (const row of result.rows) {
    map.set(Number(row.user_id), row);
  }
  return map;
};

const allowsNotification = (prefs, type, entityType) => {
  if (TRANSACTIONAL_TYPES.has(type)) {
    return true;
  }

  const settings = prefs || DEFAULT_PREFERENCES;
  const categoryColumn = CATEGORY_COLUMNS[entityType];

  if (categoryColumn && settings[categoryColumn] === false) {
    return false;
  }

  if (REMINDER_TYPES.has(type) && settings.reminder_notifications === false) {
    return false;
  }

  return true;
};

const filterByPreferences = async (userIds, type, entityType, client = pool) => {
  const ids = uniqueIds(userIds);
  if (ids.length === 0) {
    return [];
  }

  if (TRANSACTIONAL_TYPES.has(type)) {
    return ids;
  }

  const prefs = await loadPreferenceMap(ids, client);
  return ids.filter((userId) =>
    allowsNotification(prefs.get(userId) || DEFAULT_PREFERENCES, type, entityType)
  );
};

export const resolveAudienceUserIds = async (audience, context = {}, client = pool) => {
  const kind = String(audience || '').trim();

  if (!AUDIENCES.includes(kind)) {
    throw Object.assign(new Error('Invalid audience.'), { status: 400 });
  }

  if (kind === 'specific_user' || kind === 'question_author') {
    return uniqueIds(context.userIds || (context.userId ? [context.userId] : []));
  }

  if (kind === 'registered_participants') {
    const entityId = parsePositiveInt(context.entityId);
    if (!entityId) {
      return [];
    }
    const result = await client.query(
      `SELECT user_id FROM event_registrations WHERE event_id = $1`,
      [entityId]
    );
    return uniqueIds(result.rows.map((row) => row.user_id));
  }

  if (kind === 'approved_volunteers') {
    const entityId = parsePositiveInt(context.entityId);
    if (!entityId) {
      return [];
    }
    const result = await client.query(
      `
      SELECT user_id
      FROM volunteer_applications
      WHERE opportunity_id = $1 AND status = 'approved'
      `,
      [entityId]
    );
    return uniqueIds(result.rows.map((row) => row.user_id));
  }

  if (kind === 'affected_volunteers') {
    const entityId = parsePositiveInt(context.entityId);
    if (!entityId) {
      return [];
    }
    const result = await client.query(
      `
      SELECT user_id
      FROM volunteer_applications
      WHERE opportunity_id = $1
        AND status IN ('applied', 'approved', 'completed')
      `,
      [entityId]
    );
    return uniqueIds(result.rows.map((row) => row.user_id));
  }

  const roleMap = {
    users: ['user'],
    mentors: ['mentor'],
    admins: ['admin'],
    all: ['user', 'mentor', 'admin'],
  };

  const roles = roleMap[kind];
  const result = await client.query(
    `SELECT id FROM users WHERE role = ANY($1::varchar[])`,
    [roles]
  );
  return uniqueIds(result.rows.map((row) => row.id));
};

const claimDeliveries = async (userIds, payload, client = pool) => {
  const ids = uniqueIds(userIds);
  if (ids.length === 0) {
    return [];
  }

  const claimed = [];

  for (let index = 0; index < ids.length; index += BATCH_SIZE) {
    const batch = ids.slice(index, index + BATCH_SIZE);
    const result = await client.query(
      `
      INSERT INTO notification_deliveries (
        user_id,
        notification_type,
        rule_id,
        entity_type,
        entity_id,
        occurrence_key,
        channel
      )
      SELECT
        user_id,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7
      FROM UNNEST($1::int[]) AS user_id
      ON CONFLICT (user_id, notification_type, entity_type, entity_id, occurrence_key, channel)
      DO NOTHING
      RETURNING user_id
      `,
      [
        batch,
        payload.type,
        payload.ruleId || null,
        payload.entityType,
        payload.entityId,
        payload.occurrenceKey,
        payload.channel || CHANNEL_IN_APP,
      ]
    );
    claimed.push(...result.rows.map((row) => Number(row.user_id)));
  }

  return uniqueIds(claimed);
};

const insertNotifications = async (userIds, payload, client = pool) => {
  const ids = uniqueIds(userIds);
  if (ids.length === 0) {
    return [];
  }

  const created = [];

  for (let index = 0; index < ids.length; index += BATCH_SIZE) {
    const batch = ids.slice(index, index + BATCH_SIZE);
    const result = await client.query(
      `
      INSERT INTO notifications (
        user_id,
        type,
        title,
        message,
        entity_type,
        entity_id,
        source,
        channel,
        rule_id
      )
      SELECT
        user_id,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8,
        $9
      FROM UNNEST($1::int[]) AS user_id
      RETURNING id, user_id
      `,
      [
        batch,
        payload.type,
        payload.title,
        payload.message,
        payload.entityType || null,
        payload.entityId || null,
        payload.source || SOURCE_AUTOMATIC,
        payload.channel || CHANNEL_IN_APP,
        payload.ruleId || null,
      ]
    );
    created.push(...result.rows);
  }

  return created;
};

export const createNotification = async (input) => {
  const userId = parsePositiveInt(input.userId);
  if (!userId) {
    return null;
  }

  const created = await createBulkNotifications({
    ...input,
    userIds: [userId],
  });
  return created[0] || null;
};

export const createBulkNotifications = async (input) => {
  const type = String(input.type || '').trim();
  const title = String(input.title || '').trim();
  const message = String(input.message || '').trim();
  const entityType = input.entityType ? String(input.entityType).trim() : null;
  const entityId = parsePositiveInt(input.entityId);
  const skipDedupe = Boolean(input.skipDedupe);
  const occurrenceKey = String(input.occurrenceKey || 'default').slice(0, 120);

  if (!type || !title || !message) {
    return [];
  }

  let userIds = uniqueIds(input.userIds || []);
  userIds = await filterByPreferences(userIds, type, entityType, pool);

  if (userIds.length === 0) {
    return [];
  }

  const payload = {
    type,
    title: title.slice(0, 255),
    message,
    entityType,
    entityId,
    source: input.source || SOURCE_AUTOMATIC,
    channel: input.channel || CHANNEL_IN_APP,
    ruleId: parsePositiveInt(input.ruleId),
    occurrenceKey,
  };

  if (skipDedupe || !entityType || !entityId) {
    return insertNotifications(userIds, payload);
  }

  const claimed = await claimDeliveries(userIds, payload);
  if (claimed.length === 0) {
    return [];
  }

  try {
    return await insertNotifications(claimed, payload);
  } catch (error) {
    console.error('Create notifications insert error:', error);
    await pool.query(
      `
      DELETE FROM notification_deliveries
      WHERE user_id = ANY($1::int[])
        AND notification_type = $2
        AND entity_type = $3
        AND entity_id = $4
        AND occurrence_key = $5
        AND channel = $6
      `,
      [
        claimed,
        payload.type,
        payload.entityType,
        payload.entityId,
        payload.occurrenceKey,
        payload.channel,
      ]
    );
    return [];
  }
};

export const notifySpecificUser = async (userId, input) => {
  return createNotification({ ...input, userId });
};

export const notifyAudience = async (audience, input) => {
  const userIds = await resolveAudienceUserIds(audience, input);
  return createBulkNotifications({ ...input, userIds });
};

export const getEnabledRules = async ({ notificationType, entityType } = {}) => {
  const result = await pool.query(
    `
    SELECT
      id,
      notification_type,
      entity_type,
      enabled,
      timing_minutes,
      audience,
      title_template,
      message_template
    FROM notification_rules
    WHERE enabled = TRUE
      AND ($1::varchar IS NULL OR notification_type = $1)
      AND ($2::varchar IS NULL OR entity_type = $2)
    ORDER BY id ASC
    `,
    [notificationType || null, entityType || null]
  );
  return result.rows;
};

export const processNotificationRules = async ({
  notificationType,
  entityType,
  entityId,
  vars = {},
  audienceOverride,
  userIds,
  occurrenceKey,
  source = SOURCE_AUTOMATIC,
}) => {
  const rules = await getEnabledRules({ notificationType, entityType });
  const created = [];

  for (const rule of rules) {
    const title = interpolate(rule.title_template || notificationType, vars);
    const message = interpolate(rule.message_template || vars.title || '', vars);
    const audience = audienceOverride || rule.audience;
    const resolvedUserIds =
      userIds ||
      (await resolveAudienceUserIds(audience, {
        entityId,
        entityType,
        userIds,
        userId: vars.userId,
      }));

    const rows = await createBulkNotifications({
      userIds: resolvedUserIds,
      type: rule.notification_type,
      title,
      message,
      entityType: rule.entity_type,
      entityId,
      ruleId: rule.id,
      occurrenceKey: occurrenceKey || `rule:${rule.id}`,
      source,
    });
    created.push(...rows);
  }

  return created;
};

export const updatePreferences = async (userId, patch) => {
  await getOrCreatePreferences(userId);

  const updates = [];
  const values = [userId];

  for (const field of PREFERENCE_FIELDS) {
    if (typeof patch[field] === 'boolean') {
      values.push(patch[field]);
      updates.push(`${field} = $${values.length}`);
    }
  }

  if (updates.length === 0) {
    return getOrCreatePreferences(userId);
  }

  const result = await pool.query(
    `
    UPDATE notification_preferences
    SET ${updates.join(', ')}, updated_at = NOW()
    WHERE user_id = $1
    RETURNING
      event_notifications,
      volunteering_notifications,
      camp_notifications,
      course_notifications,
      meditation_notifications,
      community_notifications,
      reminder_notifications,
      updated_at
    `,
    values
  );

  return result.rows[0];
};

export const listUserNotifications = async (userId, { page = 1, limit = 20, unread } = {}) => {
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 50);
  const safePage = Math.max(Number(page) || 1, 1);
  const offset = (safePage - 1) * safeLimit;
  const unreadOnly = unread === true || unread === 'true';

  const result = await pool.query(
    `
    SELECT
      id,
      type,
      title,
      message,
      entity_type,
      entity_id,
      is_read,
      source,
      created_at
    FROM notifications
    WHERE user_id = $1
      AND dismissed_at IS NULL
      AND ($2::boolean = FALSE OR is_read = FALSE)
    ORDER BY created_at DESC, id DESC
    LIMIT $3 OFFSET $4
    `,
    [userId, unreadOnly, safeLimit, offset]
  );

  const count = await pool.query(
    `
    SELECT COUNT(*)::integer AS total
    FROM notifications
    WHERE user_id = $1
      AND dismissed_at IS NULL
      AND ($2::boolean = FALSE OR is_read = FALSE)
    `,
    [userId, unreadOnly]
  );

  return {
    notifications: result.rows,
    page: safePage,
    limit: safeLimit,
    total: count.rows[0].total,
  };
};

export const getUnreadCount = async (userId) => {
  const result = await pool.query(
    `
    SELECT COUNT(*)::integer AS unread_count
    FROM notifications
    WHERE user_id = $1 AND is_read = FALSE AND dismissed_at IS NULL
    `,
    [userId]
  );
  return result.rows[0].unread_count;
};

export const markNotificationRead = async (userId, notificationId) => {
  const id = parsePositiveInt(notificationId);
  if (!id) {
    const error = new Error('Invalid notification ID.');
    error.status = 400;
    throw error;
  }

  const existing = await pool.query(
    `SELECT id, user_id, is_read, dismissed_at FROM notifications WHERE id = $1`,
    [id]
  );

  if (existing.rows.length === 0) {
    const error = new Error('Notification not found.');
    error.status = 404;
    throw error;
  }

  if (Number(existing.rows[0].user_id) !== Number(userId)) {
    const error = new Error('You do not have permission to update this notification.');
    error.status = 403;
    throw error;
  }

  if (existing.rows[0].dismissed_at) {
    const error = new Error('Notification not found.');
    error.status = 404;
    throw error;
  }

  const result = await pool.query(
    `
    UPDATE notifications
    SET is_read = TRUE
    WHERE id = $1 AND user_id = $2 AND dismissed_at IS NULL
    RETURNING id, is_read
    `,
    [id, userId]
  );

  return result.rows[0];
};

export const markAllRead = async (userId) => {
  const result = await pool.query(
    `
    UPDATE notifications
    SET is_read = TRUE
    WHERE user_id = $1 AND is_read = FALSE AND dismissed_at IS NULL
    RETURNING id
    `,
    [userId]
  );
  return result.rowCount;
};

export const dismissNotification = async (userId, notificationId) => {
  const id = parsePositiveInt(notificationId);
  if (!id) {
    const error = new Error('Invalid notification ID.');
    error.status = 400;
    throw error;
  }

  const existing = await pool.query(
    `SELECT id, user_id, is_read, dismissed_at FROM notifications WHERE id = $1`,
    [id]
  );

  if (existing.rows.length === 0) {
    const error = new Error('Notification not found.');
    error.status = 404;
    throw error;
  }

  if (Number(existing.rows[0].user_id) !== Number(userId)) {
    const error = new Error('You do not have permission to dismiss this notification.');
    error.status = 403;
    throw error;
  }

  if (existing.rows[0].dismissed_at) {
    return {
      id: existing.rows[0].id,
      dismissed: true,
      already_dismissed: true,
      was_unread: existing.rows[0].is_read === false,
    };
  }

  const result = await pool.query(
    `
    UPDATE notifications
    SET dismissed_at = NOW()
    WHERE id = $1 AND user_id = $2 AND dismissed_at IS NULL
    RETURNING id, is_read, dismissed_at
    `,
    [id, userId]
  );

  const row = result.rows[0] || existing.rows[0];
  return {
    id: row.id,
    dismissed: true,
    already_dismissed: false,
    was_unread: row.is_read === false,
    dismissed_at: row.dismissed_at || existing.rows[0].dismissed_at,
  };
};
