import pool from '../db.js';
import { getStoredImageUrl } from '../utils/storage.js';
import { localDateTime } from '../utils/scheduleTime.js';

const parsePositiveInt = (value) => {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
};

const getEventWindow = (event) => {
  const start = localDateTime(event.event_date, event.start_time);
  const end = new Date(start.getTime() + Number(event.duration_minutes) * 60 * 1000);
  return { start, end };
};

const sessionSeconds = (session, eventDurationSeconds) => {
  const joined = new Date(session.joined_at).getTime();
  const endValue = session.left_at || session.last_heartbeat_at || session.joined_at;
  const ended = new Date(endValue).getTime();
  const raw = Math.max(0, Math.floor((ended - joined) / 1000));
  return Math.min(raw, eventDurationSeconds);
};

export const totalParticipationSeconds = (sessions, eventDurationSeconds) => {
  const total = sessions.reduce(
    (sum, session) => sum + sessionSeconds(session, eventDurationSeconds),
    0
  );
  return Math.min(total, eventDurationSeconds);
};

export const applyAutoAttendance = async (client, eventId, userId, durationMinutes) => {
  const eventDurationSeconds = Number(durationMinutes) * 60;
  const existing = await client.query(
    `
    SELECT status, source
    FROM event_attendance
    WHERE event_id = $1 AND user_id = $2
    `,
    [eventId, userId]
  );

  if (existing.rows[0]?.source === 'admin') {
    return existing.rows[0];
  }

  const sessions = await client.query(
    `
    SELECT joined_at, left_at, last_heartbeat_at, duration_seconds
    FROM event_attendance_sessions
    WHERE event_id = $1 AND user_id = $2
    `,
    [eventId, userId]
  );

  if (sessions.rows.length === 0) {
    return existing.rows[0] || null;
  }

  const seconds = totalParticipationSeconds(sessions.rows, eventDurationSeconds);
  const required = Math.ceil(eventDurationSeconds * 0.5);
  const status = seconds >= required ? 'present' : 'absent';

  const result = await client.query(
    `
    INSERT INTO event_attendance (
      event_id,
      user_id,
      status,
      marked_at,
      marked_by,
      source,
      updated_at
    )
    VALUES ($1, $2, $3, NOW(), NULL, 'auto', NOW())
    ON CONFLICT (event_id, user_id)
    DO UPDATE SET
      status = EXCLUDED.status,
      marked_at = NOW(),
      marked_by = NULL,
      source = 'auto',
      updated_at = NOW()
    WHERE event_attendance.source IS DISTINCT FROM 'admin'
    RETURNING *
    `,
    [eventId, userId, status]
  );

  return result.rows[0] || existing.rows[0] || null;
};

const loadJoinableEvent = async (client, eventId) => {
  const result = await client.query(
    `
    SELECT
      id,
      title,
      status,
      event_type,
      event_date::text AS event_date,
      start_time::text AS start_time,
      duration_minutes,
      meeting_url
    FROM events
    WHERE id = $1
    FOR UPDATE
    `,
    [eventId]
  );

  return result.rows[0] || null;
};

const assertRegistered = async (client, eventId, userId) => {
  const registration = await client.query(
    `
    SELECT id
    FROM event_registrations
    WHERE event_id = $1 AND user_id = $2
    `,
    [eventId, userId]
  );

  return registration.rows.length > 0;
};

export const joinEventSession = async (req, res) => {
  const client = await pool.connect();

  try {
    const eventId = parsePositiveInt(req.params.id);
    const userId = req.user.userId;

    if (!eventId) {
      return res.status(400).json({ error: 'Invalid event id.' });
    }

    await client.query('BEGIN');

    const event = await loadJoinableEvent(client, eventId);

    if (!event) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Event not found.' });
    }

    if (event.status !== 'published' || event.event_type !== 'online') {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'This session is not available to join.',
      });
    }

    const registered = await assertRegistered(client, eventId, userId);

    if (!registered) {
      await client.query('ROLLBACK');
      return res.status(403).json({
        error: 'You are not registered for this event.',
      });
    }

    const { start, end } = getEventWindow(event);
    const now = Date.now();
    const joinOpens = start.getTime() - 10 * 60 * 1000;
    const joinCloses = end.getTime() + 2 * 60 * 1000;

    if (now < joinOpens || now > joinCloses) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'This session is not open yet.',
      });
    }

    const openSession = await client.query(
      `
      SELECT *
      FROM event_attendance_sessions
      WHERE event_id = $1 AND user_id = $2 AND left_at IS NULL
      ORDER BY joined_at DESC
      LIMIT 1
      `,
      [eventId, userId]
    );

    let session = openSession.rows[0];

    if (!session) {
      const inserted = await client.query(
        `
        INSERT INTO event_attendance_sessions (
          event_id,
          user_id,
          joined_at,
          last_heartbeat_at
        )
        VALUES ($1, $2, NOW(), NOW())
        RETURNING *
        `,
        [eventId, userId]
      );
      session = inserted.rows[0];
    }

    await applyAutoAttendance(client, eventId, userId, event.duration_minutes);
    await client.query('COMMIT');

    res.status(200).json({
      message: 'Session joined.',
      session,
      meeting_url: event.meeting_url,
    });
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // ignore rollback errors
    }

    console.error('Join event session error:', error);
    res.status(500).json({ error: 'Unable to join this session.' });
  } finally {
    client.release();
  }
};

const updateOpenSession = async (req, res, { leave }) => {
  const client = await pool.connect();

  try {
    const eventId = parsePositiveInt(req.params.id);
    const userId = req.user.userId;

    if (!eventId) {
      return res.status(400).json({ error: 'Invalid event id.' });
    }

    await client.query('BEGIN');

    const event = await loadJoinableEvent(client, eventId);

    if (!event) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Event not found.' });
    }

    const registered = await assertRegistered(client, eventId, userId);

    if (!registered) {
      await client.query('ROLLBACK');
      return res.status(403).json({
        error: 'You are not registered for this event.',
      });
    }

    const openSession = await client.query(
      `
      SELECT *
      FROM event_attendance_sessions
      WHERE event_id = $1 AND user_id = $2 AND left_at IS NULL
      ORDER BY joined_at DESC
      LIMIT 1
      FOR UPDATE
      `,
      [eventId, userId]
    );

    if (openSession.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        error: leave
          ? 'No active session to leave.'
          : 'No active session to update.',
      });
    }

    const eventDurationSeconds = Number(event.duration_minutes) * 60;
    const current = {
      ...openSession.rows[0],
      last_heartbeat_at: new Date().toISOString(),
      left_at: leave ? new Date().toISOString() : openSession.rows[0].left_at,
    };
    const duration = sessionSeconds(current, eventDurationSeconds);

    const updated = await client.query(
      `
      UPDATE event_attendance_sessions
      SET
        last_heartbeat_at = NOW(),
        left_at = CASE WHEN $3 THEN NOW() ELSE left_at END,
        duration_seconds = $4,
        updated_at = NOW()
      WHERE id = $1 AND user_id = $2
      RETURNING *
      `,
      [openSession.rows[0].id, userId, leave, duration]
    );

    const attendance = await applyAutoAttendance(
      client,
      eventId,
      userId,
      event.duration_minutes
    );

    await client.query('COMMIT');

    res.status(200).json({
      message: leave ? 'Session ended.' : 'Session updated.',
      session: updated.rows[0],
      attendance,
    });
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // ignore rollback errors
    }

    console.error('Update event session error:', error);
    res.status(500).json({
      error: leave ? 'Unable to leave this session.' : 'Unable to update this session.',
    });
  } finally {
    client.release();
  }
};

export const heartbeatEventSession = async (req, res) => {
  return updateOpenSession(req, res, { leave: false });
};

export const leaveEventSession = async (req, res) => {
  return updateOpenSession(req, res, { leave: true });
};

export const uploadEventBanner = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Please choose an image to upload.' });
    }

    const bannerUrl = getStoredImageUrl('events', req.file.filename);

    res.status(201).json({
      banner_url: bannerUrl,
    });
  } catch (error) {
    console.error('Upload event banner error:', error);
    res.status(500).json({ error: 'Unable to upload event banner.' });
  }
};
