import pool from '../db.js';

const parsePositiveInt = (value) => {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
};

const remainingSeats = (capacity, registered) => {
  if (capacity === null) {
    return null;
  }

  return Math.max(capacity - registered, 0);
};

const certificateStatusFor = (attendanceStatus, hasCertificate) => {
  if (hasCertificate) {
    return 'available';
  }

  if (attendanceStatus === 'present') {
    return 'pending';
  }

  return 'not_available';
};

const getEventById = async (eventId) => {
  const result = await pool.query(
    `
    SELECT
      id,
      title,
      status,
      capacity,
      event_type,
      event_date::text AS event_date,
      start_time::text AS start_time,
      duration_minutes
    FROM events
    WHERE id = $1
    `,
    [eventId]
  );

  return result.rows[0] || null;
};

export const getEventRegistrations = async (req, res) => {
  try {
    const eventId = parsePositiveInt(req.params.id);

    if (!eventId) {
      return res.status(400).json({ error: 'Invalid event id.' });
    }

    const event = await getEventById(eventId);

    if (!event) {
      return res.status(404).json({ error: 'Event not found.' });
    }

    const registrations = await pool.query(
      `
      SELECT
        er.id,
        er.event_id,
        er.user_id,
        er.registered_at,
        u.name AS participant_name,
        u.email AS participant_email
      FROM event_registrations er
      JOIN users u ON u.id = er.user_id
      WHERE er.event_id = $1
      ORDER BY er.registered_at ASC
      `,
      [eventId]
    );

    const registered = registrations.rows.length;
    const remaining = remainingSeats(event.capacity, registered);

    res.status(200).json({
      event_id: eventId,
      title: event.title,
      capacity: event.capacity,
      registered,
      remaining,
      is_full: event.capacity !== null && remaining === 0,
      participants: registrations.rows,
    });
  } catch (error) {
    console.error('Get event registrations error:', error);
    res.status(500).json({ error: 'Unable to load registrations.' });
  }
};

export const removeEventRegistration = async (req, res) => {
  const client = await pool.connect();

  try {
    const eventId = parsePositiveInt(req.params.id);
    const userId = parsePositiveInt(req.params.userId);

    if (!eventId || !userId) {
      return res.status(400).json({ error: 'Invalid event or participant.' });
    }

    await client.query('BEGIN');

    const eventResult = await client.query(
      `
      SELECT id
      FROM events
      WHERE id = $1
      FOR UPDATE
      `,
      [eventId]
    );

    if (eventResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Event not found.' });
    }

    const registration = await client.query(
      `
      SELECT id
      FROM event_registrations
      WHERE event_id = $1 AND user_id = $2
      `,
      [eventId, userId]
    );

    if (registration.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        error: 'This participant is not registered for this event.',
      });
    }

    await client.query(
      `
      DELETE FROM event_certificates
      WHERE event_id = $1 AND user_id = $2
      `,
      [eventId, userId]
    );

    await client.query(
      `
      DELETE FROM event_attendance
      WHERE event_id = $1 AND user_id = $2
      `,
      [eventId, userId]
    );

    await client.query(
      `
      DELETE FROM event_registrations
      WHERE event_id = $1 AND user_id = $2
      `,
      [eventId, userId]
    );

    await client.query('COMMIT');

    res.status(200).json({
      message: 'Registration removed.',
    });
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // ignore rollback errors
    }

    console.error('Remove event registration error:', error);
    res.status(500).json({ error: 'Unable to remove registration.' });
  } finally {
    client.release();
  }
};

export const getEventAttendance = async (req, res) => {
  try {
    const eventId = parsePositiveInt(req.params.id);

    if (!eventId) {
      return res.status(400).json({ error: 'Invalid event id.' });
    }

    const event = await getEventById(eventId);

    if (!event) {
      return res.status(404).json({ error: 'Event not found.' });
    }

    const result = await pool.query(
      `
      SELECT
        er.user_id,
        u.name AS participant_name,
        u.email AS participant_email,
        er.registered_at,
        ea.status AS attendance_status,
        ea.marked_at,
        ea.marked_by,
        ea.source,
        MIN(s.joined_at) AS joined_at,
        MAX(COALESCE(s.left_at, s.last_heartbeat_at)) AS last_seen_at,
        COALESCE(
          SUM(
            LEAST(
              GREATEST(
                EXTRACT(
                  EPOCH FROM (
                    COALESCE(s.left_at, s.last_heartbeat_at, s.joined_at) - s.joined_at
                  )
                )::integer,
                0
              ),
              e.duration_minutes * 60
            )
          ),
          0
        )::integer AS participation_seconds
      FROM event_registrations er
      JOIN users u ON u.id = er.user_id
      JOIN events e ON e.id = er.event_id
      LEFT JOIN event_attendance ea
        ON ea.event_id = er.event_id AND ea.user_id = er.user_id
      LEFT JOIN event_attendance_sessions s
        ON s.event_id = er.event_id AND s.user_id = er.user_id
      WHERE er.event_id = $1
      GROUP BY
        er.user_id,
        u.name,
        u.email,
        er.registered_at,
        ea.status,
        ea.marked_at,
        ea.marked_by,
        ea.source
      ORDER BY u.name ASC
      `,
      [eventId]
    );

    const registered = result.rows.length;
    const participants = result.rows.map((row) => ({
      ...row,
      participation_seconds: Math.min(
        row.participation_seconds || 0,
        Number(event.duration_minutes) * 60
      ),
      participation_minutes: Math.round(
        Math.min(row.participation_seconds || 0, Number(event.duration_minutes) * 60) / 60
      ),
    }));
    const present = participants.filter((row) => row.attendance_status === 'present').length;
    const absent = participants.filter((row) => row.attendance_status === 'absent').length;
    const unmarked = registered - present - absent;
    const rate = registered === 0 ? 0 : Math.round((present / registered) * 100);

    res.status(200).json({
      event_id: eventId,
      registered,
      present,
      absent,
      unmarked,
      attendance_rate: rate,
      participants,
    });
  } catch (error) {
    console.error('Get event attendance error:', error);
    res.status(500).json({ error: 'Unable to load attendance.' });
  }
};

export const upsertEventAttendance = async (req, res) => {
  const client = await pool.connect();

  try {
    const eventId = parsePositiveInt(req.params.id);
    const userId = parsePositiveInt(req.body?.user_id);
    const status = req.body?.status;
    const markedBy = req.user.userId;

    if (!eventId || !userId) {
      return res.status(400).json({ error: 'Invalid event or participant.' });
    }

    if (status !== 'present' && status !== 'absent') {
      return res.status(400).json({
        error: 'Attendance status must be present or absent.',
      });
    }

    await client.query('BEGIN');

    const eventResult = await client.query(
      `
      SELECT id
      FROM events
      WHERE id = $1
      FOR UPDATE
      `,
      [eventId]
    );

    if (eventResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Event not found.' });
    }

    const registration = await client.query(
      `
      SELECT id
      FROM event_registrations
      WHERE event_id = $1 AND user_id = $2
      `,
      [eventId, userId]
    );

    if (registration.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'Attendance can only be marked for registered participants.',
      });
    }

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
      VALUES ($1, $2, $3, NOW(), $4, 'admin', NOW())
      ON CONFLICT (event_id, user_id)
      DO UPDATE SET
        status = EXCLUDED.status,
        marked_at = NOW(),
        marked_by = EXCLUDED.marked_by,
        source = 'admin',
        updated_at = NOW()
      RETURNING *
      `,
      [eventId, userId, status, markedBy]
    );

    await client.query('COMMIT');

    res.status(200).json({
      message: 'Attendance updated.',
      attendance: result.rows[0],
    });
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // ignore rollback errors
    }

    console.error('Update event attendance error:', error);
    res.status(500).json({ error: 'Unable to update attendance.' });
  } finally {
    client.release();
  }
};

export const getEventCertificates = async (req, res) => {
  try {
    const eventId = parsePositiveInt(req.params.id);

    if (!eventId) {
      return res.status(400).json({ error: 'Invalid event id.' });
    }

    const event = await getEventById(eventId);

    if (!event) {
      return res.status(404).json({ error: 'Event not found.' });
    }

    const result = await pool.query(
      `
      SELECT
        er.user_id,
        u.name AS participant_name,
        u.email AS participant_email,
        ea.status AS attendance_status,
        ec.id AS certificate_id,
        ec.certificate_number,
        ec.issued_at
      FROM event_registrations er
      JOIN users u ON u.id = er.user_id
      LEFT JOIN event_attendance ea
        ON ea.event_id = er.event_id AND ea.user_id = er.user_id
      LEFT JOIN event_certificates ec
        ON ec.event_id = er.event_id AND ec.user_id = er.user_id
      WHERE er.event_id = $1
      ORDER BY u.name ASC
      `,
      [eventId]
    );

    const participants = result.rows.map((row) => ({
      ...row,
      certificate_status: certificateStatusFor(
        row.attendance_status,
        Boolean(row.certificate_id)
      ),
    }));

    const eligible = participants.filter(
      (row) => row.attendance_status === 'present'
    ).length;
    const issued = participants.filter((row) => row.certificate_id).length;
    const pending = participants.filter(
      (row) => row.certificate_status === 'pending'
    ).length;

    res.status(200).json({
      event_id: eventId,
      eligible,
      issued,
      pending,
      participants,
    });
  } catch (error) {
    console.error('Get event certificates error:', error);
    res.status(500).json({ error: 'Unable to load certificates.' });
  }
};

const issueCertificateForUser = async (client, eventId, userId) => {
  const registration = await client.query(
    `
    SELECT id
    FROM event_registrations
    WHERE event_id = $1 AND user_id = $2
    `,
    [eventId, userId]
  );

  if (registration.rows.length === 0) {
    return { error: 'Participant is not registered for this event.', status: 400 };
  }

  const attendance = await client.query(
    `
    SELECT status
    FROM event_attendance
    WHERE event_id = $1 AND user_id = $2
    `,
    [eventId, userId]
  );

  if (attendance.rows[0]?.status !== 'present') {
    return {
      error: 'Certificates can only be issued to participants marked present.',
      status: 400,
    };
  }

  const existing = await client.query(
    `
    SELECT *
    FROM event_certificates
    WHERE event_id = $1 AND user_id = $2
    `,
    [eventId, userId]
  );

  if (existing.rows[0]) {
    return { certificate: existing.rows[0], created: false };
  }

  const certificateNumber = `EVT-${eventId}-U${userId}-${Date.now()}`;

  const inserted = await client.query(
    `
    INSERT INTO event_certificates (
      event_id,
      user_id,
      certificate_number,
      issued_at,
      certificate_url
    )
    VALUES ($1, $2, $3, NOW(), NULL)
    RETURNING *
    `,
    [eventId, userId, certificateNumber]
  );

  return { certificate: inserted.rows[0], created: true };
};

export const issueEventCertificate = async (req, res) => {
  const client = await pool.connect();

  try {
    const eventId = parsePositiveInt(req.params.id);
    const userId = parsePositiveInt(req.body?.user_id);

    if (!eventId || !userId) {
      return res.status(400).json({ error: 'Invalid event or participant.' });
    }

    await client.query('BEGIN');

    const eventResult = await client.query(
      `
      SELECT id
      FROM events
      WHERE id = $1
      FOR UPDATE
      `,
      [eventId]
    );

    if (eventResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Event not found.' });
    }

    const issued = await issueCertificateForUser(client, eventId, userId);

    if (issued.error) {
      await client.query('ROLLBACK');
      return res.status(issued.status).json({ error: issued.error });
    }

    await client.query('COMMIT');

    res.status(issued.created ? 201 : 200).json({
      message: issued.created
        ? 'Certificate issued.'
        : 'Certificate was already issued.',
      certificate: issued.certificate,
    });
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // ignore rollback errors
    }

    if (error?.code === '23505') {
      return res.status(409).json({
        error: 'A certificate already exists for this participant.',
      });
    }

    console.error('Issue event certificate error:', error);
    res.status(500).json({ error: 'Unable to issue certificate.' });
  } finally {
    client.release();
  }
};

export const issueEligibleEventCertificates = async (req, res) => {
  const client = await pool.connect();

  try {
    const eventId = parsePositiveInt(req.params.id);

    if (!eventId) {
      return res.status(400).json({ error: 'Invalid event id.' });
    }

    await client.query('BEGIN');

    const eventResult = await client.query(
      `
      SELECT id
      FROM events
      WHERE id = $1
      FOR UPDATE
      `,
      [eventId]
    );

    if (eventResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Event not found.' });
    }

    const eligible = await client.query(
      `
      SELECT er.user_id
      FROM event_registrations er
      JOIN event_attendance ea
        ON ea.event_id = er.event_id AND ea.user_id = er.user_id
      LEFT JOIN event_certificates ec
        ON ec.event_id = er.event_id AND ec.user_id = er.user_id
      WHERE er.event_id = $1
        AND ea.status = 'present'
        AND ec.id IS NULL
      `,
      [eventId]
    );

    const issued = [];

    for (const row of eligible.rows) {
      const result = await issueCertificateForUser(client, eventId, row.user_id);

      if (result.certificate) {
        issued.push(result.certificate);
      }
    }

    await client.query('COMMIT');

    res.status(200).json({
      message: issued.length
        ? `Issued ${issued.length} certificate(s).`
        : 'No pending eligible certificates to issue.',
      issued_count: issued.length,
      certificates: issued,
    });
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // ignore rollback errors
    }

    console.error('Issue eligible certificates error:', error);
    res.status(500).json({ error: 'Unable to issue certificates.' });
  } finally {
    client.release();
  }
};

export const getMyEventCertificate = async (req, res) => {
  try {
    const eventId = parsePositiveInt(req.params.id);
    const userId = req.user.userId;

    if (!eventId) {
      return res.status(400).json({ error: 'Invalid event id.' });
    }

    const registration = await pool.query(
      `
      SELECT id
      FROM event_registrations
      WHERE event_id = $1 AND user_id = $2
      `,
      [eventId, userId]
    );

    if (registration.rows.length === 0) {
      return res.status(403).json({
        error: 'You are not registered for this event.',
      });
    }

    const result = await pool.query(
      `
      SELECT
        ec.id,
        ec.event_id,
        ec.user_id,
        ec.certificate_number,
        ec.issued_at,
        ec.certificate_url,
        e.title AS event_title,
        e.event_date::text AS event_date
      FROM event_certificates ec
      JOIN events e ON e.id = ec.event_id
      WHERE ec.event_id = $1 AND ec.user_id = $2
      `,
      [eventId, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'Certificate is not available.',
      });
    }

    res.status(200).json(result.rows[0]);
  } catch (error) {
    console.error('Get my event certificate error:', error);
    res.status(500).json({ error: 'Unable to load certificate.' });
  }
};

export const getEventAnalytics = async (req, res) => {
  try {
    const eventId = parsePositiveInt(req.params.id);

    if (!eventId) {
      return res.status(400).json({ error: 'Invalid event id.' });
    }

    const event = await getEventById(eventId);

    if (!event) {
      return res.status(404).json({ error: 'Event not found.' });
    }

    const counts = await pool.query(
      `
      SELECT
        (SELECT COUNT(*)::integer FROM event_registrations WHERE event_id = $1) AS registered,
        (SELECT COUNT(*)::integer FROM event_attendance WHERE event_id = $1 AND status = 'present') AS present,
        (SELECT COUNT(*)::integer FROM event_attendance WHERE event_id = $1 AND status = 'absent') AS absent,
        (SELECT COUNT(*)::integer FROM event_certificates WHERE event_id = $1) AS certificates_issued
      `,
      [eventId]
    );

    const stats = counts.rows[0];
    const remaining = remainingSeats(event.capacity, stats.registered);
    const attendanceRate =
      stats.registered === 0
        ? 0
        : Math.round((stats.present / stats.registered) * 100);

    res.status(200).json({
      event_id: event.id,
      title: event.title,
      status: event.status,
      event_type: event.event_type,
      event_date: event.event_date,
      start_time: event.start_time,
      duration_minutes: event.duration_minutes,
      capacity: event.capacity,
      registered: stats.registered,
      remaining,
      attendance_present: stats.present,
      attendance_absent: stats.absent,
      attendance_rate: attendanceRate,
      certificates_issued: stats.certificates_issued,
      certificates_eligible: stats.present,
    });
  } catch (error) {
    console.error('Get event analytics error:', error);
    res.status(500).json({ error: 'Unable to load event analytics.' });
  }
};
