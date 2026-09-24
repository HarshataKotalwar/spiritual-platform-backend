import pool from '../db.js';
import { getStoredImageUrl } from '../utils/storage.js';
import {
  ACTIVE_APPLICATION_STATUSES,
  occupiedCountQuery,
  opportunitySelect,
  parseId,
  publicOpportunity,
  certificateStatusFor,
} from './volunteerHelpers.js';
import { notifyVolunteeringApplicationSubmitted } from '../services/notifications/hooks.js';

export const listOpportunities = async (req, res) => {
  try {
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const category = typeof req.query.category === 'string' ? req.query.category.trim() : '';
    const volunteerType =
      typeof req.query.volunteer_type === 'string' ? req.query.volunteer_type.trim() : '';
    const fromDate =
      typeof req.query.from_date === 'string' ? req.query.from_date.slice(0, 10) : '';

    const result = await pool.query(
      `
      SELECT
        ${opportunitySelect},
        COUNT(a.id) FILTER (
          WHERE a.status = ANY($4::varchar[])
        )::integer AS occupied
      FROM volunteer_opportunities o
      LEFT JOIN volunteer_applications a ON a.opportunity_id = o.id
      WHERE o.status = 'published'
        AND ($1 = '' OR o.title ILIKE '%' || $1 || '%' OR o.description ILIKE '%' || $1 || '%')
        AND ($2 = '' OR o.category ILIKE '%' || $2 || '%')
        AND ($3 = '' OR o.volunteer_type = $3)
        AND ($5 = '' OR o.event_date::text >= $5)
      GROUP BY o.id
      ORDER BY o.event_date ASC, o.start_time ASC
      `,
      [search, category, volunteerType, ACTIVE_APPLICATION_STATUSES, fromDate]
    );

    res.status(200).json(result.rows.map((row) => publicOpportunity(row)));
  } catch (error) {
    console.error('List volunteering opportunities error:', error);
    res.status(500).json({ error: 'Unable to load volunteering opportunities.' });
  }
};

export const getOpportunityById = async (req, res) => {
  try {
    const opportunityId = parseId(req.params.id);
    const requester = req.user;

    if (!opportunityId) {
      return res.status(400).json({ error: 'Invalid opportunity.' });
    }

    const result = await pool.query(
      `
      SELECT
        ${opportunitySelect},
        COUNT(a.id) FILTER (
          WHERE a.status = ANY($2::varchar[])
        )::integer AS occupied
      FROM volunteer_opportunities o
      LEFT JOIN volunteer_applications a ON a.opportunity_id = o.id
      WHERE o.id = $1
      GROUP BY o.id
      `,
      [opportunityId, ACTIVE_APPLICATION_STATUSES]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Opportunity not found.' });
    }

    const opportunity = result.rows[0];
    const isAdmin = requester?.role === 'admin';

    if (opportunity.status !== 'published' && !isAdmin) {
      return res.status(404).json({ error: 'Opportunity not found.' });
    }

    let application = null;
    let attendance = null;
    let certificate = null;

    if (requester?.userId) {
      const applicationResult = await pool.query(
        `
        SELECT id, status, applied_at, reviewed_at
        FROM volunteer_applications
        WHERE opportunity_id = $1 AND user_id = $2
        `,
        [opportunityId, requester.userId]
      );
      application = applicationResult.rows[0] || null;

      if (application) {
        const attendanceResult = await pool.query(
          `
          SELECT status, check_in, check_out, duration_minutes
          FROM volunteer_attendance
          WHERE opportunity_id = $1 AND user_id = $2
          `,
          [opportunityId, requester.userId]
        );
        attendance = attendanceResult.rows[0] || null;

        const certificateResult = await pool.query(
          `
          SELECT certificate_number, issued_at, certificate_url
          FROM volunteer_certificates
          WHERE opportunity_id = $1 AND user_id = $2
          `,
          [opportunityId, requester.userId]
        );
        certificate = certificateResult.rows[0] || null;
      }
    }

    const canSeeMeeting =
      isAdmin ||
      application?.status === 'approved' ||
      application?.status === 'completed';

    res.status(200).json({
      ...publicOpportunity(opportunity, { includeMeeting: canSeeMeeting }),
      my_application: application,
      my_attendance: attendance
        ? {
            status: attendance.status,
            duration_minutes: attendance.duration_minutes,
          }
        : null,
      certificate_status: certificateStatusFor({
        applicationStatus: application?.status,
        attendanceStatus: attendance?.status,
        issued: Boolean(certificate),
      }),
      certificate_number: certificate?.certificate_number ?? null,
    });
  } catch (error) {
    console.error('Get volunteering opportunity error:', error);
    res.status(500).json({ error: 'Unable to load this opportunity.' });
  }
};

export const applyToOpportunity = async (req, res) => {
  const client = await pool.connect();

  try {
    const opportunityId = parseId(req.params.id);
    const userId = req.user.userId;

    if (!opportunityId) {
      return res.status(400).json({ error: 'Invalid opportunity.' });
    }

    await client.query('BEGIN');

    const opportunityResult = await client.query(
      `
      SELECT id, title, status, capacity
      FROM volunteer_opportunities
      WHERE id = $1
      FOR UPDATE
      `,
      [opportunityId]
    );

    if (opportunityResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Opportunity not found.' });
    }

    const opportunity = opportunityResult.rows[0];

    if (opportunity.status !== 'published') {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'This opportunity is not accepting applications.',
      });
    }

    const existing = await client.query(
      `
      SELECT id, status
      FROM volunteer_applications
      WHERE opportunity_id = $1 AND user_id = $2
      `,
      [opportunityId, userId]
    );

    if (existing.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'You have already applied for this opportunity.',
      });
    }

    const occupiedResult = await client.query(occupiedCountQuery, [
      opportunityId,
      ACTIVE_APPLICATION_STATUSES,
    ]);
    const occupied = occupiedResult.rows[0].occupied;

    if (opportunity.capacity !== null && occupied >= opportunity.capacity) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'This opportunity is full.',
      });
    }

    const inserted = await client.query(
      `
      INSERT INTO volunteer_applications (opportunity_id, user_id, status)
      VALUES ($1, $2, 'applied')
      RETURNING id, opportunity_id, user_id, status, applied_at
      `,
      [opportunityId, userId]
    );

    await client.query('COMMIT');

    await notifyVolunteeringApplicationSubmitted(opportunity, userId);

    res.status(201).json({
      message: 'Your application has been submitted.',
      application: inserted.rows[0],
    });
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // ignore rollback errors
    }

    if (error?.code === '23505') {
      return res.status(409).json({
        error: 'You have already applied for this opportunity.',
      });
    }

    console.error('Apply to volunteering error:', error);
    res.status(500).json({ error: 'Unable to submit this application.' });
  } finally {
    client.release();
  }
};

export const cancelMyApplication = async (req, res) => {
  try {
    const opportunityId = parseId(req.params.id);
    const userId = req.user.userId;

    if (!opportunityId) {
      return res.status(400).json({ error: 'Invalid opportunity.' });
    }

    const opportunity = await pool.query(
      `
      SELECT id, status
      FROM volunteer_opportunities
      WHERE id = $1
      `,
      [opportunityId]
    );

    if (opportunity.rows.length === 0) {
      return res.status(404).json({ error: 'Opportunity not found.' });
    }

    if (['completed', 'cancelled'].includes(opportunity.rows[0].status)) {
      return res.status(400).json({
        error: 'This application can no longer be cancelled.',
      });
    }

    const result = await pool.query(
      `
      UPDATE volunteer_applications
      SET status = 'cancelled', reviewed_at = NOW()
      WHERE opportunity_id = $1
        AND user_id = $2
        AND status IN ('applied', 'approved')
      RETURNING id, status
      `,
      [opportunityId, userId]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({
        error: 'There is no cancellable application for this opportunity.',
      });
    }

    res.status(200).json({
      message: 'Your application has been cancelled.',
      application: result.rows[0],
    });
  } catch (error) {
    console.error('Cancel volunteering application error:', error);
    res.status(500).json({ error: 'Unable to cancel this application.' });
  }
};

export const getMyVolunteering = async (req, res) => {
  try {
    const userId = req.user.userId;

    const result = await pool.query(
      `
      SELECT
        ${opportunitySelect},
        a.id AS application_id,
        a.status AS application_status,
        a.applied_at,
        a.reviewed_at,
        att.status AS attendance_status,
        att.duration_minutes,
        c.certificate_number,
        c.issued_at
      FROM volunteer_applications a
      JOIN volunteer_opportunities o ON o.id = a.opportunity_id
      LEFT JOIN volunteer_attendance att
        ON att.opportunity_id = a.opportunity_id AND att.user_id = a.user_id
      LEFT JOIN volunteer_certificates c
        ON c.opportunity_id = a.opportunity_id AND c.user_id = a.user_id
      WHERE a.user_id = $1
      ORDER BY o.event_date ASC, o.start_time ASC
      `,
      [userId]
    );

    res.status(200).json(
      result.rows.map((row) => ({
        ...publicOpportunity(row, {
          includeMeeting:
            row.application_status === 'approved' ||
            row.application_status === 'completed',
        }),
        application_id: row.application_id,
        application_status: row.application_status,
        applied_at: row.applied_at,
        reviewed_at: row.reviewed_at,
        attendance_status: row.attendance_status ?? null,
        duration_minutes: row.duration_minutes ?? null,
        certificate_status: certificateStatusFor({
          applicationStatus: row.application_status,
          attendanceStatus: row.attendance_status,
          issued: Boolean(row.certificate_number),
        }),
        certificate_number: row.certificate_number,
      }))
    );
  } catch (error) {
    console.error('Get my volunteering error:', error);
    res.status(500).json({ error: 'Unable to load your volunteering.' });
  }
};

export const uploadVolunteerBanner = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Please choose an image to upload.' });
    }

    res.status(201).json({
      banner_url: getStoredImageUrl('volunteering', req.file.filename),
    });
  } catch (error) {
    console.error('Upload volunteering banner error:', error);
    res.status(500).json({ error: 'Unable to upload banner.' });
  }
};
