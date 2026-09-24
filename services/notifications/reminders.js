import pool from '../../db.js';
import { localDateTime } from '../../utils/scheduleTime.js';
import { NOTIFICATION_TYPES } from './constants.js';
import {
  createBulkNotifications,
  formatTimingLabel,
  getEnabledRules,
  interpolate,
  resolveAudienceUserIds,
} from './notificationService.js';

const LOOKAHEAD_DAYS = 14;
const ADVISORY_LOCK_KEY = 87236401;

const reminderMessage = (title, timingMinutes, fallback) => {
  const label = formatTimingLabel(timingMinutes);
  if (label) {
    return `${title} starts in ${label.replace(' before', '')}.`;
  }
  return interpolate(fallback, { title });
};

const dueReminder = (eventDate, startTime, timingMinutes, now) => {
  const start = localDateTime(eventDate, startTime);
  const triggerAt = new Date(start.getTime() - Number(timingMinutes) * 60 * 1000);
  return now.getTime() >= triggerAt.getTime() && now.getTime() < start.getTime();
};

const processEventReminders = async (rules, now) => {
  const reminderRules = rules.filter(
    (rule) => rule.notification_type === NOTIFICATION_TYPES.EVENT_REMINDER
  );

  if (reminderRules.length === 0) {
    return 0;
  }

  const events = await pool.query(
    `
    SELECT
      id,
      title,
      event_date::text AS event_date,
      start_time::text AS start_time,
      status
    FROM events
    WHERE status = 'published'
      AND event_date >= (CURRENT_DATE - INTERVAL '1 day')
      AND event_date <= CURRENT_DATE + $1::integer
    `,
    [LOOKAHEAD_DAYS]
  );

  let created = 0;

  for (const event of events.rows) {
    for (const rule of reminderRules) {
      if (!dueReminder(event.event_date, event.start_time, rule.timing_minutes, now)) {
        continue;
      }

      const userIds = await resolveAudienceUserIds(rule.audience, {
        entityId: event.id,
        entityType: 'event',
      });

      const rows = await createBulkNotifications({
        userIds,
        type: rule.notification_type,
        title: interpolate(rule.title_template || 'Event reminder', { title: event.title }),
        message: reminderMessage(
          event.title,
          rule.timing_minutes,
          rule.message_template
        ),
        entityType: 'event',
        entityId: event.id,
        ruleId: rule.id,
        occurrenceKey: `rule:${rule.id}`,
      });
      created += rows.length;
    }
  }

  return created;
};

const processVolunteeringReminders = async (rules, now) => {
  const reminderRules = rules.filter(
    (rule) => rule.notification_type === NOTIFICATION_TYPES.VOLUNTEERING_REMINDER
  );

  if (reminderRules.length === 0) {
    return 0;
  }

  const opportunities = await pool.query(
    `
    SELECT
      id,
      title,
      event_date::text AS event_date,
      start_time::text AS start_time,
      status
    FROM volunteer_opportunities
    WHERE status IN ('published', 'closed')
      AND event_date >= (CURRENT_DATE - INTERVAL '1 day')
      AND event_date <= CURRENT_DATE + $1::integer
    `,
    [LOOKAHEAD_DAYS]
  );

  let created = 0;

  for (const opportunity of opportunities.rows) {
    for (const rule of reminderRules) {
      if (!dueReminder(opportunity.event_date, opportunity.start_time, rule.timing_minutes, now)) {
        continue;
      }

      const userIds = await resolveAudienceUserIds(rule.audience, {
        entityId: opportunity.id,
        entityType: 'volunteering',
      });

      const rows = await createBulkNotifications({
        userIds,
        type: rule.notification_type,
        title: interpolate(rule.title_template || 'Volunteering reminder', {
          title: opportunity.title,
        }),
        message: reminderMessage(
          opportunity.title,
          rule.timing_minutes,
          rule.message_template
        ),
        entityType: 'volunteering',
        entityId: opportunity.id,
        ruleId: rule.id,
        occurrenceKey: `rule:${rule.id}`,
      });
      created += rows.length;
    }
  }

  return created;
};

export const processScheduledReminders = async (now = new Date()) => {
  const client = await pool.connect();

  try {
    const lock = await client.query('SELECT pg_try_advisory_lock($1) AS locked', [
      ADVISORY_LOCK_KEY,
    ]);

    if (!lock.rows[0]?.locked) {
      return { skipped: true, created: 0 };
    }

    try {
      const rules = await getEnabledRules();
      const eventsCreated = await processEventReminders(rules, now);
      const volunteeringCreated = await processVolunteeringReminders(rules, now);
      return { skipped: false, created: eventsCreated + volunteeringCreated };
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY]);
    }
  } finally {
    client.release();
  }
};
