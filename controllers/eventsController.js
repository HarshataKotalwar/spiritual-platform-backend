import pool from '../db.js';
import {
  hasScheduleStarted,
  sameDate,
  sameNullableNumber,
  sameNullableText,
  sameTime,
} from '../utils/scheduleTime.js';
import {
  notifyEventCancelled,
  notifyEventPublished,
  notifyEventRegistration,
  notifyEventUpdated,
} from '../services/notifications/hooks.js';

export const getEvents = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        e.id,
        e.title,
        e.description,
        e.banner_url,
        e.event_type,
        e.event_date::text AS event_date,
        e.start_time::text AS start_time,
        e.duration_minutes,
        e.location,
        e.meeting_url,
        e.capacity,
        e.fee,
        e.status,
        e.created_by,
        u.name AS creator_name,
        COUNT(er.id)::integer AS registered_count
      FROM events e
      LEFT JOIN users u ON e.created_by = u.id
      LEFT JOIN event_registrations er ON e.id = er.event_id
      WHERE e.status = 'published'
      GROUP BY e.id, u.name
      ORDER BY e.event_date ASC, e.start_time ASC
    `);

    const publicEvents = result.rows.map((event) => ({
      ...event,
      meeting_url: null,
    }));

    res.status(200).json(publicEvents);
  } catch (error) {
    console.error('Get events error:', error);
    res.status(500).json({ error: 'Unable to fetch events.' });
  }
};

export const getEventById = async (req, res) => {
  try {
    const { id } = req.params;
    const requester = req.user;
    const isAdmin = requester?.role === 'admin';

    const result = await pool.query(
      `
      SELECT
        e.id,
        e.title,
        e.description,
        e.banner_url,
        e.event_type,
        e.event_date::text AS event_date,
        e.start_time::text AS start_time,
        e.duration_minutes,
        e.location,
        e.meeting_url,
        e.capacity,
        e.fee,
        e.status,
        e.created_by,
        u.name AS creator_name,
        COUNT(er.id)::integer AS registered_count
      FROM events e
      LEFT JOIN users u ON e.created_by = u.id
      LEFT JOIN event_registrations er ON e.id = er.event_id
      WHERE e.id = $1
      GROUP BY e.id, u.name
      `,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Event not found.' });
    }

    const event = result.rows[0];

    if (event.status === 'draft' && !isAdmin) {
      return res.status(404).json({ error: 'Event not found.' });
    }

    let isRegistered = false;

    if (requester?.userId) {
      const registration = await pool.query(
        `
        SELECT id
        FROM event_registrations
        WHERE event_id = $1 AND user_id = $2
        `,
        [id, requester.userId]
      );
      isRegistered = registration.rows.length > 0;
    }

    if (!isAdmin && (event.status === 'cancelled' || !isRegistered)) {
      event.meeting_url = null;
    }

    if (!isAdmin && isRegistered && event.status === 'published') {
      const [year, month, day] = String(event.event_date).slice(0, 10).split('-').map(Number);
      const [hours, minutes, seconds] = String(event.start_time)
        .split(':')
        .map((part) => Number(part || 0));
      const start = new Date(year, month - 1, day, hours || 0, minutes || 0, seconds || 0);
      const end = new Date(start.getTime() + Number(event.duration_minutes) * 60 * 1000);

      if (Date.now() > end.getTime()) {
        event.meeting_url = null;
      }
    }

    event.is_registered = isRegistered;
    event.attendance_status = null;
    event.certificate_status = null;
    event.certificate_number = null;
    event.certificate_issued_at = null;

    if (isRegistered && requester?.userId) {
      const attendanceResult = await pool.query(
        `
        SELECT status
        FROM event_attendance
        WHERE event_id = $1 AND user_id = $2
        `,
        [id, requester.userId]
      );

      event.attendance_status = attendanceResult.rows[0]?.status ?? null;

      const certificateResult = await pool.query(
        `
        SELECT certificate_number, issued_at
        FROM event_certificates
        WHERE event_id = $1 AND user_id = $2
        `,
        [id, requester.userId]
      );

      if (certificateResult.rows[0]) {
        event.certificate_number = certificateResult.rows[0].certificate_number;
        event.certificate_issued_at = certificateResult.rows[0].issued_at;
        event.certificate_status = 'available';
      } else if (event.attendance_status === 'present') {
        event.certificate_status = 'pending';
      } else {
        event.certificate_status = 'not_available';
      }
    }

    res.status(200).json(event);
  } catch (error) {
    console.error('Get event error:', error);
    res.status(500).json({ error: 'Unable to fetch event.' });
  }
};

/*
 * PARTICIPANT
 * Events the authenticated user or mentor has registered for.
 */
export const getMyEvents = async (req, res) => {
  try {
    const userId = req.user.userId;

    const result = await pool.query(
      `
      SELECT
        e.id,
        e.title,
        e.description,
        e.banner_url,
        e.event_type,
        e.event_date::text AS event_date,
        e.start_time::text AS start_time,
        e.duration_minutes,
        e.location,
        e.meeting_url,
        e.capacity,
        e.fee,
        e.status,
        e.created_by,
        u.name AS creator_name,
        er.registered_at,
        ea.status AS attendance_status,
        ec.certificate_number,
        ec.issued_at AS certificate_issued_at,
        COUNT(all_er.id)::integer AS registered_count
      FROM event_registrations er
      JOIN events e ON e.id = er.event_id
      LEFT JOIN users u ON e.created_by = u.id
      LEFT JOIN event_registrations all_er ON all_er.event_id = e.id
      LEFT JOIN event_attendance ea
        ON ea.event_id = e.id AND ea.user_id = er.user_id
      LEFT JOIN event_certificates ec
        ON ec.event_id = e.id AND ec.user_id = er.user_id
      WHERE er.user_id = $1
      GROUP BY
        e.id,
        u.name,
        er.registered_at,
        ea.status,
        ec.certificate_number,
        ec.issued_at
      ORDER BY e.event_date ASC, e.start_time ASC
      `,
      [userId]
    );

    const myEvents = result.rows.map((event) => {
      let meetingUrl =
        event.status === 'published' ? event.meeting_url : null;

      if (meetingUrl) {
        const [year, month, day] = String(event.event_date).slice(0, 10).split('-').map(Number);
        const [hours, minutes, seconds] = String(event.start_time)
          .split(':')
          .map((part) => Number(part || 0));
        const start = new Date(year, month - 1, day, hours || 0, minutes || 0, seconds || 0);
        const end = new Date(start.getTime() + Number(event.duration_minutes) * 60 * 1000);

        if (Date.now() > end.getTime()) {
          meetingUrl = null;
        }
      }

      let certificateStatus = 'not_available';

      if (event.certificate_number) {
        certificateStatus = 'available';
      } else if (event.attendance_status === 'present') {
        certificateStatus = 'pending';
      }

      return {
        ...event,
        meeting_url: meetingUrl,
        is_registered: true,
        certificate_status: certificateStatus,
      };
    });

    res.status(200).json(myEvents);
  } catch (error) {
    console.error('Get my events error:', error);
    res.status(500).json({ error: 'Unable to fetch your events.' });
  }
};

/*
 * ADMIN
 * Get all events including draft, published and cancelled events.
 */
export const getAdminEvents = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        e.id,
        e.title,
        e.description,
        e.banner_url,
        e.event_type,
        e.event_date::text AS event_date,
        e.start_time::text AS start_time,
        e.duration_minutes,
        e.location,
        e.meeting_url,
        e.capacity,
        e.fee,
        e.status,
        e.created_by,
        u.name AS creator_name,
        COUNT(er.id)::integer AS registered_count
      FROM events e
      LEFT JOIN users u ON e.created_by = u.id
      LEFT JOIN event_registrations er ON e.id = er.event_id
      GROUP BY e.id, u.name
      ORDER BY e.event_date ASC, e.start_time ASC
    `);

    res.status(200).json(result.rows);
  } catch (error) {
    console.error('Get admin events error:', error);
    res.status(500).json({ error: 'Unable to fetch admin events.' });
  }
};

export const createEvent = async (req, res) => {
  try {
    const {
      title,
      description,
      banner_url,
      event_type,
      event_date,
      start_time,
      duration_minutes,
      location,
      meeting_url,
      capacity,
      fee,
      status,
    } = req.body;

    if (
      !title ||
      !event_type ||
      !event_date ||
      !start_time ||
      !duration_minutes
    ) {
      return res.status(400).json({
        error: 'Title, event type, date, start time, and duration are required.',
      });
    }

    if (!['online', 'offline'].includes(event_type)) {
      return res.status(400).json({
        error: 'Event type must be online or offline.',
      });
    }

    if (event_type === 'online' && !meeting_url) {
      return res.status(400).json({
        error: 'Meeting URL is required for online events.',
      });
    }

    if (event_type === 'offline' && !location) {
      return res.status(400).json({
        error: 'Location is required for offline events.',
      });
    }

    const result = await pool.query(
      `
      INSERT INTO events (
        title,
        description,
        banner_url,
        event_type,
        event_date,
        start_time,
        duration_minutes,
        location,
        meeting_url,
        capacity,
        fee,
        status,
        created_by
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        $8, $9, $10, $11, $12, $13
      )
      RETURNING *
      `,
      [
        title,
        description || null,
        banner_url || null,
        event_type,
        event_date,
        start_time,
        Number(duration_minutes),
        location || null,
        meeting_url || null,
        capacity ? Number(capacity) : null,
        fee ? Number(fee) : 0,
        status || 'draft',
        req.user.userId,
      ]
    );

    const event = result.rows[0];

    if (event.status === 'published') {
      await notifyEventPublished({ id: event.id, title: event.title });
    }

    res.status(201).json({
      message: 'Event created successfully.',
      event,
    });
  } catch (error) {
    console.error('Create event error:', error);
    res.status(500).json({ error: 'Unable to create event.' });
  }
};

/*
 * ADMIN
 * Update an existing event.
 */
export const updateEvent = async (req, res) => {
  try {
    const { id } = req.params;

    const {
      title,
      description,
      banner_url,
      event_type,
      event_date,
      start_time,
      duration_minutes,
      location,
      meeting_url,
      capacity,
      fee,
      status,
    } = req.body;

    if (
      !title ||
      !event_type ||
      !event_date ||
      !start_time ||
      !duration_minutes
    ) {
      return res.status(400).json({
        error: 'Title, event type, date, start time, and duration are required.',
      });
    }

    if (!['online', 'offline'].includes(event_type)) {
      return res.status(400).json({
        error: 'Event type must be online or offline.',
      });
    }

    if (!['draft', 'published', 'cancelled'].includes(status)) {
      return res.status(400).json({
        error: 'Invalid event status.',
      });
    }

    if (event_type === 'online' && !meeting_url) {
      return res.status(400).json({
        error: 'Meeting URL is required for online events.',
      });
    }

    if (event_type === 'offline' && !location) {
      return res.status(400).json({
        error: 'Location is required for offline events.',
      });
    }

    const existingEvent = await pool.query(
      `
      SELECT
        id,
        title,
        description,
        banner_url,
        event_type,
        event_date::text AS event_date,
        start_time::text AS start_time,
        duration_minutes,
        location,
        meeting_url,
        capacity,
        fee,
        status
      FROM events
      WHERE id = $1
      `,
      [id]
    );

    if (existingEvent.rows.length === 0) {
      return res.status(404).json({
        error: 'Event not found.',
      });
    }

    const current = existingEvent.rows[0];
    const coreLocked =
      current.status === 'cancelled' ||
      (current.status !== 'draft' &&
        hasScheduleStarted(current.event_date, current.start_time));

    if (coreLocked) {
      const coreUnchanged =
        current.event_type === event_type &&
        sameDate(current.event_date, event_date) &&
        sameTime(current.start_time, start_time) &&
        Number(current.duration_minutes) === Number(duration_minutes) &&
        sameNullableText(current.location, location) &&
        sameNullableText(current.meeting_url, meeting_url) &&
        sameNullableNumber(current.capacity, capacity ? Number(capacity) : null) &&
        Number(current.fee || 0) === Number(fee ? Number(fee) : 0);

      if (!coreUnchanged) {
        return res.status(409).json({
          error: 'Core event details cannot be edited after the event has started.',
        });
      }
    }

    const nextCapacity = capacity ? Number(capacity) : null;

    if (nextCapacity !== null) {
      const registered = await pool.query(
        `SELECT COUNT(*)::integer AS registered FROM event_registrations WHERE event_id = $1`,
        [id]
      );

      if (registered.rows[0].registered > nextCapacity) {
        return res.status(409).json({
          error: 'Capacity cannot be lower than the number of existing registrations.',
        });
      }
    }

    const meaningfulUpdate =
      current.status === 'published' &&
      status === 'published' &&
      (
        current.title !== title ||
        !sameNullableText(current.description, description) ||
        current.event_type !== event_type ||
        !sameDate(current.event_date, event_date) ||
        !sameTime(current.start_time, start_time) ||
        Number(current.duration_minutes) !== Number(duration_minutes) ||
        !sameNullableText(current.location, location) ||
        !sameNullableText(current.meeting_url, meeting_url)
      );

    const result = await pool.query(
      `
      UPDATE events
      SET
        title = $1,
        description = $2,
        banner_url = $3,
        event_type = $4,
        event_date = $5,
        start_time = $6,
        duration_minutes = $7,
        location = $8,
        meeting_url = $9,
        capacity = $10,
        fee = $11,
        status = $12,
        updated_at = NOW()
      WHERE id = $13
      RETURNING *
      `,
      [
        title,
        description || null,
        banner_url || null,
        event_type,
        event_date,
        start_time,
        Number(duration_minutes),
        location || null,
        meeting_url || null,
        capacity ? Number(capacity) : null,
        fee ? Number(fee) : 0,
        status,
        id,
      ]
    );

    const event = result.rows[0];

    if (current.status !== 'published' && event.status === 'published') {
      await notifyEventPublished({ id: event.id, title: event.title });
    } else if (current.status !== 'cancelled' && event.status === 'cancelled') {
      await notifyEventCancelled({ id: event.id, title: event.title });
    } else if (meaningfulUpdate) {
      await notifyEventUpdated({ id: event.id, title: event.title });
    }

    res.status(200).json({
      message: 'Event updated successfully.',
      event,
    });
  } catch (error) {
    console.error('Update event error:', error);
    res.status(500).json({
      error: 'Unable to update event.',
    });
  }
};

/*
 * ADMIN
 * Cancel an event without deleting its registration history.
 */
export const cancelEvent = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `
      UPDATE events
      SET
        status = 'cancelled',
        updated_at = NOW()
      WHERE id = $1
      RETURNING id, title, status
      `,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'Event not found.',
      });
    }

    await notifyEventCancelled(result.rows[0]);

    res.status(200).json({
      message: 'Event cancelled successfully.',
      event: result.rows[0],
    });
  } catch (error) {
    console.error('Cancel event error:', error);
    res.status(500).json({
      error: 'Unable to cancel event.',
    });
  }
};

/*
 * ADMIN
 * Delete an event permanently.
 */
export const deleteEvent = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `
      DELETE FROM events
      WHERE id = $1
      RETURNING id, title
      `,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'Event not found.',
      });
    }

    res.status(200).json({
      message: 'Event deleted successfully.',
      event: result.rows[0],
    });
  } catch (error) {
    console.error('Delete event error:', error);
    res.status(500).json({
      error: 'Unable to delete event.',
    });
  }
};

export const registerForEvent = async (req, res) => {
  const client = await pool.connect();

  try {
    const { id } = req.params;
    const userId = req.user.userId;

    await client.query('BEGIN');

    const eventResult = await client.query(
      `
      SELECT id, title, capacity, status
      FROM events
      WHERE id = $1
      FOR UPDATE
      `,
      [id]
    );

    if (eventResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        error: 'Event not found.',
      });
    }

    const event = eventResult.rows[0];

    if (event.status !== 'published') {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'This event is not available for registration.',
      });
    }

    const existingRegistration = await client.query(
      `
      SELECT id
      FROM event_registrations
      WHERE event_id = $1 AND user_id = $2
      `,
      [id, userId]
    );

    if (existingRegistration.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'You are already registered for this event.',
      });
    }

    const countResult = await client.query(
      `
      SELECT COUNT(*)::integer AS registered_count
      FROM event_registrations
      WHERE event_id = $1
      `,
      [id]
    );

    const registeredCount = countResult.rows[0].registered_count;

    if (event.capacity !== null && registeredCount >= event.capacity) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'Event is full.',
      });
    }

    const result = await client.query(
      `
      INSERT INTO event_registrations (event_id, user_id)
      VALUES ($1, $2)
      RETURNING *
      `,
      [id, userId]
    );

    await client.query('COMMIT');

    await notifyEventRegistration(event, userId);

    res.status(201).json({
      message: 'Successfully registered for the event.',
      registration: result.rows[0],
    });
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // ignore rollback errors
    }

    if (error?.code === '23505') {
      return res.status(409).json({
        error: 'You are already registered for this event.',
      });
    }

    console.error('Register event error:', error);

    res.status(500).json({
      error: 'Unable to register for the event.',
    });
  } finally {
    client.release();
  }
};