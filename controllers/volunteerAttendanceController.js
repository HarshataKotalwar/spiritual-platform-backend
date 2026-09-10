import pool from '../db.js';
import { parseId } from './volunteerHelpers.js';

export const getAttendance = async (req, res) => {
  try {
    const opportunityId = parseId(req.params.id);

    if (!opportunityId) {
      return res.status(400).json({ error: 'Invalid opportunity.' });
    }

    const opportunity = await pool.query(
      `SELECT id FROM volunteer_opportunities WHERE id = $1`,
      [opportunityId]
    );

    if (opportunity.rows.length === 0) {
      return res.status(404).json({ error: 'Opportunity not found.' });
    }

    const result = await pool.query(
      `
      SELECT
        a.id AS application_id,
        a.user_id,
        a.status AS application_status,
        u.name AS participant_name,
        u.email AS participant_email,
        u.role AS participant_role,
        att.status AS attendance_status,
        att.check_in,
        att.check_out,
        att.duration_minutes,
        att.source,
        c.certificate_number,
        c.issued_at
      FROM volunteer_applications a
      JOIN users u ON u.id = a.user_id
      LEFT JOIN volunteer_attendance att ON att.application_id = a.id
      LEFT JOIN volunteer_certificates c ON c.application_id = a.id
      WHERE a.opportunity_id = $1
        AND a.status IN ('approved', 'completed')
      ORDER BY u.name ASC
      `,
      [opportunityId]
    );

    res.status(200).json(result.rows);
  } catch (error) {
    console.error('Get volunteering attendance error:', error);
    res.status(500).json({ error: 'Unable to load attendance.' });
  }
};

export const upsertAttendance = async (req, res) => {
  const client = await pool.connect();

  try {
    const opportunityId = parseId(req.params.id);
    const userId = parseId(req.body?.user_id);
    const status = req.body?.status;
    const durationMinutes = Number(req.body?.duration_minutes ?? 0);

    if (!opportunityId || !userId) {
      return res.status(400).json({ error: 'Invalid opportunity or participant.' });
    }

    if (!['present', 'absent', 'partial'].includes(status)) {
      return res.status(400).json({
        error: 'Attendance status must be present, partial, or absent.',
      });
    }

    if (!Number.isFinite(durationMinutes) || durationMinutes < 0) {
      return res.status(400).json({ error: 'Duration cannot be negative.' });
    }

    await client.query('BEGIN');

    const application = await client.query(
      `
      SELECT id, status
      FROM volunteer_applications
      WHERE opportunity_id = $1 AND user_id = $2
      FOR UPDATE
      `,
      [opportunityId, userId]
    );

    if (application.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'Attendance can only be marked for volunteers who applied.',
      });
    }

    if (!['approved', 'completed'].includes(application.rows[0].status)) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'Approve the volunteer before marking attendance.',
      });
    }

    const result = await client.query(
      `
      INSERT INTO volunteer_attendance (
        opportunity_id,
        user_id,
        application_id,
        status,
        check_in,
        check_out,
        duration_minutes,
        source,
        marked_by,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'admin', $8, NOW())
      ON CONFLICT (opportunity_id, user_id)
      DO UPDATE SET
        status = EXCLUDED.status,
        check_in = EXCLUDED.check_in,
        check_out = EXCLUDED.check_out,
        duration_minutes = EXCLUDED.duration_minutes,
        source = 'admin',
        marked_by = EXCLUDED.marked_by,
        updated_at = NOW()
      RETURNING *
      `,
      [
        opportunityId,
        userId,
        application.rows[0].id,
        status,
        req.body?.check_in || null,
        req.body?.check_out || null,
        Math.floor(durationMinutes),
        req.user.userId,
      ]
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

    console.error('Update volunteering attendance error:', error);
    res.status(500).json({ error: 'Unable to update attendance.' });
  } finally {
    client.release();
  }
};
