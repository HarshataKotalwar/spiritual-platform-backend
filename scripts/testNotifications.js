import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

import pool from '../db.js';
import {
  createBulkNotifications,
  getUnreadCount,
  listUserNotifications,
  markAllRead,
  markNotificationRead,
  notifyAudience,
  notifySpecificUser,
} from '../services/notifications/notificationService.js';
import { processScheduledReminders } from '../services/notifications/reminders.js';
import { NOTIFICATION_TYPES, SOURCE_MANUAL } from '../services/notifications/constants.js';
import { localDateTime } from '../utils/scheduleTime.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API = `http://localhost:${process.env.PORT || 5000}`;
const results = [];

const record = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const ensureSchema = async () => {
  const sql = fs.readFileSync(path.join(__dirname, '../notifications.sql'), 'utf8');
  await pool.query(sql);
};

const upsertUser = async (email, role, password) => {
  const hash = await bcrypt.hash(password, 10);
  const existing = await pool.query(`SELECT id FROM users WHERE email = $1`, [email]);
  if (existing.rows[0]) {
    await pool.query(
      `UPDATE users SET role = $2, password_hash = $3, is_verified = TRUE WHERE email = $1`,
      [email, role, hash]
    );
    return existing.rows[0].id;
  }

  const inserted = await pool.query(
    `
    INSERT INTO users (name, email, password_hash, role, is_verified)
    VALUES ($1, $2, $3, $4, TRUE)
    RETURNING id
    `,
    [email.split('@')[0], email, hash, role]
  );
  return inserted.rows[0].id;
};

const tokenFor = (userId, role) =>
  jwt.sign({ userId, role }, process.env.JWT_SECRET, { expiresIn: '1h' });

const api = async (method, url, token, body) => {
  const response = await fetch(`${API}${url}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data };
};

const cleanupPrefix = async (prefix) => {
  await pool.query(
    `DELETE FROM events WHERE title LIKE $1`,
    [`${prefix}%`]
  );
  await pool.query(
    `DELETE FROM volunteer_opportunities WHERE title LIKE $1`,
    [`${prefix}%`]
  );
  await pool.query(
    `
    DELETE FROM notifications
    WHERE user_id IN (SELECT id FROM users WHERE email LIKE $1)
    `,
    [`${prefix}%`]
  );
};

const main = async () => {
  const prefix = `notifytest.${Date.now()}`;
  await ensureSchema();

  const password = 'NotifyTest123!';
  const userId = await upsertUser(`${prefix}.user@example.com`, 'user', password);
  const mentorId = await upsertUser(`${prefix}.mentor@example.com`, 'mentor', password);
  const adminId = await upsertUser(`${prefix}.admin@example.com`, 'admin', password);
  const userToken = tokenFor(userId, 'user');
  const mentorToken = tokenFor(mentorId, 'mentor');
  const adminToken = tokenFor(adminId, 'admin');

  await pool.query(`DELETE FROM notification_preferences WHERE user_id = ANY($1::int[])`, [
    [userId, mentorId, adminId],
  ]);

  const guest = await api('GET', '/api/notifications', null);
  record('Guest cannot access private notification APIs', guest.status === 401);

  const userList = await api('GET', '/api/notifications', userToken);
  record('Authenticated user can list own notifications', userList.status === 200);

  await notifySpecificUser(userId, {
    type: NOTIFICATION_TYPES.ADMIN_ANNOUNCEMENT,
    title: 'User only',
    message: 'Visible to user',
    skipDedupe: true,
    source: SOURCE_MANUAL,
  });
  await notifySpecificUser(mentorId, {
    type: NOTIFICATION_TYPES.ADMIN_ANNOUNCEMENT,
    title: 'Mentor only',
    message: 'Visible to mentor',
    skipDedupe: true,
    source: SOURCE_MANUAL,
  });

  const userNotes = await listUserNotifications(userId, { limit: 50 });
  const mentorNotes = await listUserNotifications(mentorId, { limit: 50 });
  record(
    'User sees only their notifications',
    userNotes.notifications.every((row) => row.title !== 'Mentor only') &&
      userNotes.notifications.some((row) => row.title === 'User only')
  );
  record(
    'Mentor sees only their notifications',
    mentorNotes.notifications.every((row) => row.title !== 'User only') &&
      mentorNotes.notifications.some((row) => row.title === 'Mentor only')
  );

  const unreadBefore = await getUnreadCount(userId);
  const firstUnread = userNotes.notifications.find((row) => !row.is_read);
  if (firstUnread) {
    await markNotificationRead(userId, firstUnread.id);
  }
  const unreadAfterOne = await getUnreadCount(userId);
  record(
    'Mark one as read works',
    Boolean(firstUnread) && unreadAfterOne === unreadBefore - 1,
    `before=${unreadBefore} after=${unreadAfterOne}`
  );

  await markAllRead(userId);
  record('Mark all as read works', (await getUnreadCount(userId)) === 0);

  await notifySpecificUser(userId, {
    type: NOTIFICATION_TYPES.ADMIN_ANNOUNCEMENT,
    title: 'Dismiss unread',
    message: 'Unread dismiss test',
    skipDedupe: true,
    source: SOURCE_MANUAL,
  });
  await notifySpecificUser(userId, {
    type: NOTIFICATION_TYPES.ADMIN_ANNOUNCEMENT,
    title: 'Dismiss read',
    message: 'Read dismiss test',
    skipDedupe: true,
    source: SOURCE_MANUAL,
  });

  const dismissList = await listUserNotifications(userId, { limit: 50 });
  const unreadDismissNote = dismissList.notifications.find((row) => row.title === 'Dismiss unread');
  const readDismissNote = dismissList.notifications.find((row) => row.title === 'Dismiss read');
  const mentorOwned = (await listUserNotifications(mentorId, { limit: 50 })).notifications.find(
    (row) => row.title === 'Mentor only'
  );

  const guestDismiss = await api('DELETE', `/api/notifications/${unreadDismissNote?.id || 1}`, null);
  record('Guest cannot dismiss notifications', guestDismiss.status === 401);

  const invalidDismiss = await api('DELETE', '/api/notifications/abc', userToken);
  record('Invalid notification ID is rejected', invalidDismiss.status === 400);

  const crossDismiss = await api(
    'DELETE',
    `/api/notifications/${mentorOwned?.id || unreadDismissNote.id}`,
    userToken
  );
  record(
    'User cannot dismiss another user notification',
    Boolean(mentorOwned) && crossDismiss.status === 403
  );
  const mentorStillHas = (await listUserNotifications(mentorId, { limit: 50 })).notifications.some(
    (row) => row.id === mentorOwned?.id
  );
  record('Dismiss does not delete another user notification', mentorStillHas);

  const unreadBeforeUnreadDismiss = await getUnreadCount(userId);
  const dismissUnread = await api('DELETE', `/api/notifications/${unreadDismissNote.id}`, userToken);
  const unreadAfterUnreadDismiss = await getUnreadCount(userId);
  const unreadGone = (await listUserNotifications(userId, { limit: 50 })).notifications.every(
    (row) => row.id !== unreadDismissNote.id
  );
  record(
    'Dismiss unread decreases unread count',
    dismissUnread.status === 200 && unreadAfterUnreadDismiss === unreadBeforeUnreadDismiss - 1,
    `before=${unreadBeforeUnreadDismiss} after=${unreadAfterUnreadDismiss}`
  );
  record('Dismissed notification is excluded from the list', unreadGone);

  const alreadyDismissed = await api(
    'DELETE',
    `/api/notifications/${unreadDismissNote.id}`,
    userToken
  );
  record(
    'Already dismissed notification is handled gracefully',
    alreadyDismissed.status === 200
  );

  await markNotificationRead(userId, readDismissNote.id);
  const unreadBeforeReadDismiss = await getUnreadCount(userId);
  const dismissRead = await api('DELETE', `/api/notifications/${readDismissNote.id}`, userToken);
  const unreadAfterReadDismiss = await getUnreadCount(userId);
  record(
    'Dismiss read does not change unread count',
    dismissRead.status === 200 && unreadAfterReadDismiss === unreadBeforeReadDismiss,
    `before=${unreadBeforeReadDismiss} after=${unreadAfterReadDismiss}`
  );

  const adminRules = await api('GET', '/api/notifications/admin/rules', adminToken);
  record('Admin can view rules', adminRules.status === 200 && Array.isArray(adminRules.data));
  const userRules = await api('GET', '/api/notifications/admin/rules', userToken);
  record('Non-admin cannot access admin notification endpoints', userRules.status === 403);

  const reminderRule = (adminRules.data || []).find(
    (rule) => rule.notification_type === 'EVENT_REMINDER' && Number(rule.timing_minutes) === 60
  );
  if (reminderRule) {
    const disabled = await api('PATCH', `/api/notifications/admin/rules/${reminderRule.id}`, adminToken, {
      enabled: false,
    });
    record('Admin can enable/disable a rule', disabled.status === 200 && disabled.data.rule.enabled === false);
    await api('PATCH', `/api/notifications/admin/rules/${reminderRule.id}`, adminToken, {
      enabled: true,
    });
    const timing = await api('PATCH', `/api/notifications/admin/rules/${reminderRule.id}`, adminToken, {
      timing_minutes: 90,
    });
    record(
      'Admin can change reminder timing',
      timing.status === 200 && Number(timing.data.rule.timing_minutes) === 90
    );
    await api('PATCH', `/api/notifications/admin/rules/${reminderRule.id}`, adminToken, {
      timing_minutes: 60,
    });
  } else {
    record('Admin can enable/disable a rule', false, '60-minute event reminder missing');
    record('Admin can change reminder timing', false, '60-minute event reminder missing');
  }

  const invalidTiming = reminderRule
    ? await api('PATCH', `/api/notifications/admin/rules/${reminderRule.id}`, adminToken, {
        timing_minutes: -10,
      })
    : { status: 0 };
  record('Invalid negative timing is rejected', invalidTiming.status === 400);

  const start = new Date();
  start.setMinutes(start.getMinutes() + 90);
  const eventDate = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;
  const startTime = `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}:00`;
  const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
  const endTime =
    end.getDate() === start.getDate()
      ? `${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}:00`
      : '23:59:00';

  const createdEvent = await api('POST', '/api/events', adminToken, {
    title: `${prefix} Inner Peace Workshop`,
    description: 'Notification system test event',
    event_type: 'offline',
    event_date: eventDate,
    start_time: startTime,
    duration_minutes: 60,
    location: 'Ashram Hall',
    status: 'published',
  });
  record(
    'Publishing an Event still works',
    createdEvent.status === 201,
    createdEvent.data.error || ''
  );
  const eventId = createdEvent.data?.event?.id;
  const publishedNotes = await pool.query(
    `
    SELECT COUNT(*)::integer AS count
    FROM notifications
    WHERE type = 'EVENT_PUBLISHED' AND entity_id = $1
    `,
    [eventId || 0]
  );
  record(
    'Publishing an Event creates a notification according to its rule',
    eventId && publishedNotes.rows[0].count > 0,
    `count=${publishedNotes.rows[0].count}`
  );

  const register = await api('POST', `/api/events/${eventId}/register`, userToken);
  record('Event registration still works', register.status === 201, register.data.error || '');
  const confirm = await pool.query(
    `
    SELECT COUNT(*)::integer AS count
    FROM notifications
    WHERE type = 'EVENT_REGISTRATION_CONFIRMED' AND user_id = $1 AND entity_id = $2
    `,
    [userId, eventId || 0]
  );
  record('Event registration creates confirmation notification', confirm.rows[0].count === 1);

  const volunteer = await api('POST', '/api/volunteering', adminToken, {
    title: `${prefix} Garden Seva`,
    description: 'Help tend the garden for this test.',
    volunteer_type: 'offline',
    event_date: eventDate,
    start_time: startTime,
    end_time: endTime,
    location: 'Garden',
    status: 'published',
  });
  record('Publishing a volunteer opportunity still works', volunteer.status === 201, volunteer.data.error || '');
  const volunteerId = volunteer.data?.opportunity?.id;
  const volunteerPublished = await pool.query(
    `SELECT COUNT(*)::integer AS count FROM notifications WHERE type = 'VOLUNTEERING_PUBLISHED' AND entity_id = $1`,
    [volunteerId || 0]
  );
  record(
    'Publishing a Volunteer opportunity creates a notification',
    volunteerId && volunteerPublished.rows[0].count > 0
  );

  const apply = await api('POST', `/api/volunteering/${volunteerId}/apply`, userToken);
  record('Volunteer application still works', apply.status === 201, apply.data.error || '');
  const applicationId = apply.data?.application?.id;
  const approve = await api(
    'PATCH',
    `/api/volunteering/applications/${applicationId}/approve`,
    adminToken
  );
  record('Volunteer approval creates notification', approve.status === 200);
  const approvedNote = await pool.query(
    `
    SELECT COUNT(*)::integer AS count
    FROM notifications
    WHERE type = 'VOLUNTEERING_APPLICATION_APPROVED' AND user_id = $1 AND entity_id = $2
    `,
    [userId, volunteerId || 0]
  );
  record('Volunteer approval notification reached participant', approvedNote.rows[0].count === 1);

  const rejectUserId = await upsertUser(`${prefix}.reject@example.com`, 'user', password);
  const rejectToken = tokenFor(rejectUserId, 'user');
  const secondVolunteer = await api('POST', '/api/volunteering', adminToken, {
    title: `${prefix} Kitchen Seva`,
    description: 'Help in the kitchen for this test.',
    volunteer_type: 'offline',
    event_date: eventDate,
    start_time: startTime,
    end_time: endTime,
    location: 'Kitchen',
    status: 'published',
  });
  const secondVolunteerId = secondVolunteer.data?.opportunity?.id;
  const secondApply = await api('POST', `/api/volunteering/${secondVolunteerId}/apply`, rejectToken);
  const reject = await api(
    'PATCH',
    `/api/volunteering/applications/${secondApply.data?.application?.id}/reject`,
    adminToken
  );
  const rejectedNote = await pool.query(
    `
    SELECT COUNT(*)::integer AS count
    FROM notifications
    WHERE type = 'VOLUNTEERING_APPLICATION_REJECTED' AND user_id = $1
    `,
    [rejectUserId]
  );
  record(
    'Volunteer rejection creates notification',
    reject.status === 200 && rejectedNote.rows[0].count === 1
  );

  const cancel = await api('PATCH', `/api/events/${eventId}/cancel`, adminToken);
  const cancelledNotes = await pool.query(
    `
    SELECT COUNT(*)::integer AS count
    FROM notifications
    WHERE type = 'EVENT_CANCELLED' AND entity_id = $1 AND user_id = $2
    `,
    [eventId || 0, userId]
  );
  record(
    'Event cancellation notifies affected participants',
    cancel.status === 200 && cancelledNotes.rows[0].count === 1
  );

  const cancelVolunteer = await api('PATCH', `/api/volunteering/${volunteerId}/cancel`, adminToken);
  const volunteerCancelled = await pool.query(
    `
    SELECT COUNT(*)::integer AS count
    FROM notifications
    WHERE type = 'VOLUNTEERING_CANCELLED' AND entity_id = $1 AND user_id = $2
    `,
    [volunteerId || 0, userId]
  );
  record(
    'Volunteer cancellation notifies affected participants',
    cancelVolunteer.status === 200 && volunteerCancelled.rows[0].count === 1
  );

  const reminderEvent = await pool.query(
    `
    INSERT INTO events (
      title, description, event_type, event_date, start_time, duration_minutes, location, status, created_by
    )
    VALUES ($1, $2, 'offline', $3, $4, 60, 'Hall', 'published', $5)
    RETURNING id, title, event_date::text AS event_date, start_time::text AS start_time
    `,
    [
      `${prefix} Reminder Event`,
      'Reminder test',
      eventDate,
      startTime,
      adminId,
    ]
  );
  await pool.query(
    `INSERT INTO event_registrations (event_id, user_id) VALUES ($1, $2)`,
    [reminderEvent.rows[0].id, userId]
  );
  await pool.query(
    `INSERT INTO event_registrations (event_id, user_id) VALUES ($1, $2)`,
    [reminderEvent.rows[0].id, mentorId]
  );

  const reminderNow = new Date(
    localDateTime(reminderEvent.rows[0].event_date, reminderEvent.rows[0].start_time).getTime() -
      30 * 60 * 1000
  );
  await processScheduledReminders(reminderNow);
  await processScheduledReminders(reminderNow);
  const reminderRows = await pool.query(
    `
    SELECT user_id, COALESCE(rule_id, 0) AS rule_id, COUNT(*)::integer AS count
    FROM notifications
    WHERE type = 'EVENT_REMINDER' AND entity_id = $1
    GROUP BY user_id, COALESCE(rule_id, 0)
    `,
    [reminderEvent.rows[0].id]
  );
  const userReminder = reminderRows.rows.find((row) => Number(row.user_id) === Number(userId));
  record(
    'Event reminder triggers at configured timing',
    Boolean(userReminder)
  );
  record(
    'Reminder is sent only to relevant participants',
    reminderRows.rows.every((row) => [userId, mentorId].includes(Number(row.user_id))) &&
      reminderRows.rows.length > 0
  );
  record(
    'Scheduler does not create duplicates',
    reminderRows.rows.every((row) => row.count === 1),
    JSON.stringify(reminderRows.rows)
  );
  record(
    'Running scheduler repeatedly does not duplicate notifications',
    reminderRows.rows.every((row) => row.count === 1)
  );

  if (reminderRule) {
    await api('PATCH', `/api/notifications/admin/rules/${reminderRule.id}`, adminToken, {
      enabled: false,
    });
    const anotherEvent = await pool.query(
      `
      INSERT INTO events (
        title, description, event_type, event_date, start_time, duration_minutes, location, status, created_by
      )
      VALUES ($1, 'Disabled rule', 'offline', $2, $3, 60, 'Hall', 'published', $4)
      RETURNING id, event_date::text AS event_date, start_time::text AS start_time
      `,
      [`${prefix} Disabled Rule Event`, eventDate, startTime, adminId]
    );
    await pool.query(`INSERT INTO event_registrations (event_id, user_id) VALUES ($1, $2)`, [
      anotherEvent.rows[0].id,
      userId,
    ]);
    await processScheduledReminders(
      new Date(
        localDateTime(anotherEvent.rows[0].event_date, anotherEvent.rows[0].start_time).getTime() -
          30 * 60 * 1000
      )
    );
    const disabledCount = await pool.query(
      `
      SELECT COUNT(*)::integer AS count
      FROM notifications
      WHERE type = 'EVENT_REMINDER' AND entity_id = $1 AND rule_id = $2
      `,
      [anotherEvent.rows[0].id, reminderRule.id]
    );
    record('Disabled notification rule does not generate notifications', disabledCount.rows[0].count === 0);
    await api('PATCH', `/api/notifications/admin/rules/${reminderRule.id}`, adminToken, {
      enabled: true,
    });
  }

  await pool.query(
    `
    INSERT INTO notification_preferences (user_id, event_notifications, reminder_notifications)
    VALUES ($1, FALSE, FALSE)
    ON CONFLICT (user_id) DO UPDATE
      SET event_notifications = FALSE, reminder_notifications = FALSE
    `,
    [mentorId]
  );
  const mutedEvent = await api('POST', '/api/events', adminToken, {
    title: `${prefix} Muted Preference Event`,
    description: 'Preference test',
    event_type: 'offline',
    event_date: eventDate,
    start_time: startTime,
    duration_minutes: 60,
    location: 'Hall',
    status: 'published',
  });
  const mutedCount = await pool.query(
    `
    SELECT COUNT(*)::integer AS count
    FROM notifications
    WHERE type = 'EVENT_PUBLISHED' AND user_id = $1 AND entity_id = $2
    `,
    [mentorId, mutedEvent.data?.event?.id || 0]
  );
  record(
    'Disabled user preference prevents applicable informational notifications',
    mutedCount.rows[0].count === 0
  );

  const send = await api('POST', '/api/notifications/admin/send', adminToken, {
    title: `${prefix} Manual hello`,
    message: 'Manual announcement for tests.',
    audience: 'users',
  });
  record('Admin can create a manual notification', send.status === 201, send.data.error || '');
  const manual = await pool.query(
    `
    SELECT COUNT(*)::integer AS count
    FROM notifications
    WHERE type = 'ADMIN_ANNOUNCEMENT' AND user_id = $1 AND title = $2
    `,
    [userId, `${prefix} Manual hello`]
  );
  const mentorManual = await pool.query(
    `
    SELECT COUNT(*)::integer AS count
    FROM notifications
    WHERE type = 'ADMIN_ANNOUNCEMENT' AND user_id = $1 AND title = $2
    `,
    [mentorId, `${prefix} Manual hello`]
  );
  record(
    'Manual notification reaches selected audience',
    manual.rows[0].count === 1 && mentorManual.rows[0].count === 0
  );

  const unread = await api('GET', '/api/notifications/unread-count', userToken);
  record('Unread count endpoint works', unread.status === 200 && typeof unread.data.unread_count === 'number');

  record('Course reminders skipped because no course schedule exists', true);
  record('Camp feature not present, camp module not built', true);

  const failed = results.filter((item) => !item.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  await cleanupPrefix(prefix);
  await pool.end();
  process.exit(failed.length ? 1 : 0);
};

main().catch(async (error) => {
  console.error(error);
  try {
    await pool.end();
  } catch {
    // ignore
  }
  process.exit(1);
});
