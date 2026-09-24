import pool from '../db.js';
import {
  AUDIENCES,
  ENTITY_TYPES,
  NOTIFICATION_TYPES,
  SOURCE_MANUAL,
} from '../services/notifications/constants.js';
import {
  createBulkNotifications,
  formatTimingLabel,
  getOrCreatePreferences,
  getUnreadCount,
  interpolate,
  listUserNotifications,
  markAllRead,
  markNotificationRead,
  dismissNotification,
  parsePositiveInt,
  resolveAudienceUserIds,
  updatePreferences,
} from '../services/notifications/notificationService.js';

const RULE_AUDIENCES = AUDIENCES.filter(
  (value) => value !== 'specific_user' && value !== 'question_author'
);

const sendAudiences = ['all', 'users', 'mentors', 'admins', 'specific_user'];

const parseBoolean = (value, fallback) => {
  if (typeof value === 'boolean') {
    return value;
  }
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  return fallback;
};

const validateEntity = async (entityType, entityId) => {
  if (!entityType) {
    return { entityType: null, entityId: null };
  }

  if (!ENTITY_TYPES.includes(entityType)) {
    const error = new Error('Invalid related feature.');
    error.status = 400;
    throw error;
  }

  const id = parsePositiveInt(entityId);
  if (!id) {
    const error = new Error('A valid related item is required.');
    error.status = 400;
    throw error;
  }

  const queries = {
    event: 'SELECT id FROM events WHERE id = $1',
    volunteering: 'SELECT id FROM volunteer_opportunities WHERE id = $1',
    community_question:
      'SELECT id FROM community_questions WHERE id = $1 AND status = \'active\'',
    community_reply: 'SELECT id FROM community_replies WHERE id = $1',
    meditation: 'SELECT id FROM meditations WHERE id = $1',
  };

  const sql = queries[entityType];
  if (!sql) {
    const error = new Error('That feature is not available yet.');
    error.status = 400;
    throw error;
  }

  const result = await pool.query(sql, [id]);
  if (result.rows.length === 0) {
    const error = new Error('The related item could not be found.');
    error.status = 400;
    throw error;
  }

  return { entityType, entityId: id };
};

export const getMyNotifications = async (req, res) => {
  try {
    const unread =
      req.query.unread === 'true' ? true : req.query.unread === 'false' ? false : undefined;
    const result = await listUserNotifications(req.user.userId, {
      page: req.query.page,
      limit: req.query.limit,
      unread,
    });
    res.status(200).json(result);
  } catch (error) {
    console.error('Get notifications error:', error);
    res.status(500).json({ error: 'Unable to load notifications.' });
  }
};

export const getMyUnreadCount = async (req, res) => {
  try {
    const unreadCount = await getUnreadCount(req.user.userId);
    res.status(200).json({ unread_count: unreadCount });
  } catch (error) {
    console.error('Get unread count error:', error);
    res.status(500).json({ error: 'Unable to load unread count.' });
  }
};

export const markMyNotificationRead = async (req, res) => {
  try {
    const notification = await markNotificationRead(req.user.userId, req.params.id);
    res.status(200).json({ message: 'Notification marked as read.', notification });
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ error: error.message });
    }
    console.error('Mark notification read error:', error);
    res.status(500).json({ error: 'Unable to update this notification.' });
  }
};

export const markMyNotificationsReadAll = async (req, res) => {
  try {
    const updated = await markAllRead(req.user.userId);
    res.status(200).json({ message: 'All notifications marked as read.', updated });
  } catch (error) {
    console.error('Mark all notifications read error:', error);
    res.status(500).json({ error: 'Unable to update notifications.' });
  }
};

export const dismissMyNotification = async (req, res) => {
  try {
    const notification = await dismissNotification(req.user.userId, req.params.id);
    res.status(200).json({
      message: notification.already_dismissed
        ? 'Notification was already dismissed.'
        : 'Notification dismissed.',
      notification,
    });
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ error: error.message });
    }
    console.error('Dismiss notification error:', error);
    res.status(500).json({ error: 'Unable to dismiss this notification.' });
  }
};

export const getMyPreferences = async (req, res) => {
  try {
    const preferences = await getOrCreatePreferences(req.user.userId);
    res.status(200).json(preferences);
  } catch (error) {
    console.error('Get notification preferences error:', error);
    res.status(500).json({ error: 'Unable to load notification preferences.' });
  }
};

export const updateMyPreferences = async (req, res) => {
  try {
    const preferences = await updatePreferences(req.user.userId, req.body || {});
    res.status(200).json({
      message: 'Notification preferences updated.',
      preferences,
    });
  } catch (error) {
    console.error('Update notification preferences error:', error);
    res.status(500).json({ error: 'Unable to update notification preferences.' });
  }
};

export const adminGetOverview = async (_req, res) => {
  try {
    const stats = await pool.query(
      `
      SELECT
        COUNT(*)::integer AS total_notifications,
        COUNT(*) FILTER (WHERE source = 'automatic')::integer AS automatic_notifications,
        COUNT(*) FILTER (WHERE source = 'manual')::integer AS manual_notifications,
        COUNT(*) FILTER (WHERE is_read = FALSE)::integer AS unread_notifications
      FROM notifications
      `
    );
    const rules = await pool.query(
      `
      SELECT
        COUNT(*)::integer AS total_rules,
        COUNT(*) FILTER (WHERE enabled = TRUE)::integer AS active_rules
      FROM notification_rules
      `
    );

    res.status(200).json({
      ...stats.rows[0],
      ...rules.rows[0],
    });
  } catch (error) {
    console.error('Admin notification overview error:', error);
    res.status(500).json({ error: 'Unable to load notification overview.' });
  }
};

export const adminListActivity = async (req, res) => {
  try {
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const type = typeof req.query.type === 'string' ? req.query.type.trim() : '';
    const source = typeof req.query.source === 'string' ? req.query.source.trim() : '';
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), 100);
    const offset = (page - 1) * limit;

    const result = await pool.query(
      `
      SELECT
        n.id,
        n.user_id,
        u.name AS user_name,
        u.role AS user_role,
        n.type,
        n.title,
        n.message,
        n.entity_type,
        n.entity_id,
        n.is_read,
        n.source,
        n.created_at
      FROM notifications n
      JOIN users u ON u.id = n.user_id
      WHERE ($1 = '' OR n.title ILIKE '%' || $1 || '%' OR n.message ILIKE '%' || $1 || '%' OR u.name ILIKE '%' || $1 || '%')
        AND ($2 = '' OR n.type = $2)
        AND ($3 = '' OR n.source = $3)
      ORDER BY n.created_at DESC, n.id DESC
      LIMIT $4 OFFSET $5
      `,
      [search, type, source, limit, offset]
    );

    const count = await pool.query(
      `
      SELECT COUNT(*)::integer AS total
      FROM notifications n
      JOIN users u ON u.id = n.user_id
      WHERE ($1 = '' OR n.title ILIKE '%' || $1 || '%' OR n.message ILIKE '%' || $1 || '%' OR u.name ILIKE '%' || $1 || '%')
        AND ($2 = '' OR n.type = $2)
        AND ($3 = '' OR n.source = $3)
      `,
      [search, type, source]
    );

    res.status(200).json({
      notifications: result.rows,
      page,
      limit,
      total: count.rows[0].total,
    });
  } catch (error) {
    console.error('Admin notification activity error:', error);
    res.status(500).json({ error: 'Unable to load notification activity.' });
  }
};

export const adminListRules = async (_req, res) => {
  try {
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
        message_template,
        created_at,
        updated_at
      FROM notification_rules
      ORDER BY entity_type ASC, notification_type ASC, timing_minutes DESC NULLS LAST, id ASC
      `
    );

    res.status(200).json(
      result.rows.map((row) => ({
        ...row,
        timing_label: formatTimingLabel(row.timing_minutes),
      }))
    );
  } catch (error) {
    console.error('Admin list notification rules error:', error);
    res.status(500).json({ error: 'Unable to load automation rules.' });
  }
};

const parseRuleBody = (body, { partial = false } = {}) => {
  const notificationType =
    typeof body.notification_type === 'string' ? body.notification_type.trim() : '';
  const entityType = typeof body.entity_type === 'string' ? body.entity_type.trim() : '';
  const audience = typeof body.audience === 'string' ? body.audience.trim() : '';
  const titleTemplate =
    typeof body.title_template === 'string' ? body.title_template.trim() : '';
  const messageTemplate =
    typeof body.message_template === 'string' ? body.message_template.trim() : '';
  const enabled = body.enabled === undefined ? undefined : parseBoolean(body.enabled);
  let timingMinutes = body.timing_minutes;

  if (timingMinutes === '' || timingMinutes === null) {
    timingMinutes = null;
  } else if (timingMinutes !== undefined) {
    timingMinutes = Number(timingMinutes);
    if (!Number.isInteger(timingMinutes) || timingMinutes <= 0) {
      const error = new Error('Reminder timing must be greater than 0 minutes.');
      error.status = 400;
      throw error;
    }
  }

  if (!partial) {
    if (!notificationType || !entityType || !audience || !titleTemplate || !messageTemplate) {
      const error = new Error('Type, feature, audience, title, and message are required.');
      error.status = 400;
      throw error;
    }
  }

  if (audience && !RULE_AUDIENCES.includes(audience)) {
    const error = new Error('Invalid audience.');
    error.status = 400;
    throw error;
  }

  const typeToCheck = notificationType;
  if (typeToCheck && typeToCheck.includes('REMINDER') && timingMinutes === null && !partial) {
    const error = new Error('Reminder rules require a timing greater than 0 minutes.');
    error.status = 400;
    throw error;
  }

  return {
    notification_type: notificationType || undefined,
    entity_type: entityType || undefined,
    audience: audience || undefined,
    title_template: titleTemplate || undefined,
    message_template: messageTemplate || undefined,
    enabled,
    timing_minutes: timingMinutes,
  };
};

export const adminCreateRule = async (req, res) => {
  try {
    const data = parseRuleBody(req.body || {});
    const result = await pool.query(
      `
      INSERT INTO notification_rules (
        notification_type,
        entity_type,
        enabled,
        timing_minutes,
        audience,
        title_template,
        message_template
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      RETURNING *
      `,
      [
        data.notification_type,
        data.entity_type,
        data.enabled !== false,
        data.timing_minutes,
        data.audience,
        data.title_template,
        data.message_template,
      ]
    );

    res.status(201).json({
      message: 'Automation rule created.',
      rule: {
        ...result.rows[0],
        timing_label: formatTimingLabel(result.rows[0].timing_minutes),
      },
    });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'A matching automation rule already exists.' });
    }
    if (error.status) {
      return res.status(error.status).json({ error: error.message });
    }
    console.error('Admin create notification rule error:', error);
    res.status(500).json({ error: 'Unable to create this rule.' });
  }
};

export const adminUpdateRule = async (req, res) => {
  try {
    const ruleId = parsePositiveInt(req.params.id);
    if (!ruleId) {
      return res.status(400).json({ error: 'Invalid rule.' });
    }

    const existing = await pool.query(
      `SELECT * FROM notification_rules WHERE id = $1`,
      [ruleId]
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Rule not found.' });
    }

    const patch = parseRuleBody(req.body || {}, { partial: true });
    const current = existing.rows[0];
    const next = {
      notification_type: patch.notification_type ?? current.notification_type,
      entity_type: patch.entity_type ?? current.entity_type,
      enabled: patch.enabled ?? current.enabled,
      timing_minutes:
        patch.timing_minutes === undefined ? current.timing_minutes : patch.timing_minutes,
      audience: patch.audience ?? current.audience,
      title_template: patch.title_template ?? current.title_template,
      message_template: patch.message_template ?? current.message_template,
    };

    if (String(next.notification_type).includes('REMINDER')) {
      if (!Number.isInteger(Number(next.timing_minutes)) || Number(next.timing_minutes) <= 0) {
        return res.status(400).json({
          error: 'Reminder timing must be greater than 0 minutes.',
        });
      }
    }

    const result = await pool.query(
      `
      UPDATE notification_rules
      SET
        notification_type = $1,
        entity_type = $2,
        enabled = $3,
        timing_minutes = $4,
        audience = $5,
        title_template = $6,
        message_template = $7,
        updated_at = NOW()
      WHERE id = $8
      RETURNING *
      `,
      [
        next.notification_type,
        next.entity_type,
        next.enabled,
        next.timing_minutes,
        next.audience,
        next.title_template,
        next.message_template,
        ruleId,
      ]
    );

    res.status(200).json({
      message: 'Automation rule updated.',
      rule: {
        ...result.rows[0],
        timing_label: formatTimingLabel(result.rows[0].timing_minutes),
      },
    });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'A matching automation rule already exists.' });
    }
    if (error.status) {
      return res.status(error.status).json({ error: error.message });
    }
    console.error('Admin update notification rule error:', error);
    res.status(500).json({ error: 'Unable to update this rule.' });
  }
};

export const adminDeleteRule = async (req, res) => {
  try {
    const ruleId = parsePositiveInt(req.params.id);
    if (!ruleId) {
      return res.status(400).json({ error: 'Invalid rule.' });
    }

    const result = await pool.query(
      `DELETE FROM notification_rules WHERE id = $1 RETURNING id`,
      [ruleId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Rule not found.' });
    }

    res.status(200).json({ message: 'Automation rule removed.' });
  } catch (error) {
    console.error('Admin delete notification rule error:', error);
    res.status(500).json({ error: 'Unable to remove this rule.' });
  }
};

export const adminSendNotification = async (req, res) => {
  try {
    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
    const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
    const audience = typeof req.body?.audience === 'string' ? req.body.audience.trim() : '';
    const entityType =
      typeof req.body?.entity_type === 'string' && req.body.entity_type.trim()
        ? req.body.entity_type.trim()
        : null;

    if (!title || !message || !audience) {
      return res.status(400).json({ error: 'Title, message, and audience are required.' });
    }

    if (!sendAudiences.includes(audience)) {
      return res.status(400).json({ error: 'Invalid audience.' });
    }

    const related = await validateEntity(entityType, req.body?.entity_id);
    const userId = parsePositiveInt(req.body?.user_id);
    const userIds =
      audience === 'specific_user'
        ? userId
          ? [userId]
          : []
        : await resolveAudienceUserIds(audience, {
            entityId: related.entityId,
            entityType: related.entityType,
            userId,
          });

    if (audience === 'specific_user' && !userId) {
      return res.status(400).json({ error: 'A participant is required.' });
    }

    if (audience === 'specific_user') {
      const user = await pool.query(`SELECT id FROM users WHERE id = $1`, [userId]);
      if (user.rows.length === 0) {
        return res.status(400).json({ error: 'That participant could not be found.' });
      }
    }

    const created = await createBulkNotifications({
      userIds,
      type: NOTIFICATION_TYPES.ADMIN_ANNOUNCEMENT,
      title: interpolate(title, { title }),
      message,
      entityType: related.entityType,
      entityId: related.entityId,
      source: SOURCE_MANUAL,
      skipDedupe: true,
      occurrenceKey: `manual:${Date.now()}`,
    });

    res.status(201).json({
      message: 'Notification sent.',
      delivered: created.length,
    });
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ error: error.message });
    }
    console.error('Admin send notification error:', error);
    res.status(500).json({ error: 'Unable to send this notification.' });
  }
};
