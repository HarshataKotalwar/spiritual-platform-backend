import pool from '../db.js';
import {
  ACTIVE_APPLICATION_STATUSES,
  APPROVED_CAPACITY_STATUSES,
  occupiedCountQuery,
  opportunityReturning,
  opportunitySelect,
  parseId,
  publicOpportunity,
  validateOpportunityBody,
  certificateStatusFor,
  isOpportunityCoreLocked,
  opportunityCoreFieldsChanged,
} from './volunteerHelpers.js';
import {
  notifyVolunteeringApplicationReviewed,
  notifyVolunteeringCancelled,
  notifyVolunteeringCompleted,
  notifyVolunteeringPublished,
  notifyVolunteeringUpdated,
} from '../services/notifications/hooks.js';

const setOpportunityStatus = async (req, res, nextStatus, message) => {
  try {
    const opportunityId = parseId(req.params.id);

    if (!opportunityId) {
      return res.status(400).json({ error: 'Invalid opportunity.' });
    }

    const existing = await pool.query(
      `SELECT ${opportunityReturning} FROM volunteer_opportunities WHERE id = $1`,
      [opportunityId]
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Opportunity not found.' });
    }

    const previous = existing.rows[0];

    const result = await pool.query(
      `
      UPDATE volunteer_opportunities
      SET status = $2, updated_at = NOW()
      WHERE id = $1
      RETURNING ${opportunityReturning}
      `,
      [opportunityId, nextStatus]
    );

    const opportunity = result.rows[0];

    if (previous.status !== 'published' && opportunity.status === 'published') {
      await notifyVolunteeringPublished(opportunity);
    } else if (previous.status !== 'cancelled' && opportunity.status === 'cancelled') {
      await notifyVolunteeringCancelled(opportunity);
    } else if (previous.status !== 'completed' && opportunity.status === 'completed') {
      const volunteers = await pool.query(
        `
        SELECT user_id
        FROM volunteer_applications
        WHERE opportunity_id = $1 AND status IN ('approved', 'completed')
        `,
        [opportunity.id]
      );
      await notifyVolunteeringCompleted(
        opportunity,
        volunteers.rows.map((row) => row.user_id)
      );
    }

    res.status(200).json({
      message,
      opportunity,
    });
  } catch (error) {
    console.error('Update volunteering status error:', error);
    res.status(500).json({ error: 'Unable to update this opportunity.' });
  }
};

export const adminListOpportunities = async (req, res) => {
  try {
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const status = typeof req.query.status === 'string' ? req.query.status.trim() : '';
    const category = typeof req.query.category === 'string' ? req.query.category.trim() : '';
    const volunteerType =
      typeof req.query.volunteer_type === 'string' ? req.query.volunteer_type.trim() : '';

    const result = await pool.query(
      `
      SELECT
        ${opportunitySelect},
        COUNT(a.id) FILTER (
          WHERE a.status = ANY($4::varchar[])
        )::integer AS occupied,
        COUNT(a.id)::integer AS application_total,
        COUNT(a.id) FILTER (WHERE a.status = 'approved')::integer AS approved_count,
        COUNT(a.id) FILTER (WHERE a.status = 'completed')::integer AS completed_count
      FROM volunteer_opportunities o
      LEFT JOIN volunteer_applications a ON a.opportunity_id = o.id
      WHERE ($1 = '' OR o.title ILIKE '%' || $1 || '%' OR COALESCE(o.description, '') ILIKE '%' || $1 || '%')
        AND ($2 = '' OR o.status = $2)
        AND ($3 = '' OR o.category ILIKE '%' || $3 || '%')
        AND ($5 = '' OR o.volunteer_type = $5)
      GROUP BY o.id
      ORDER BY o.event_date ASC, o.start_time ASC
      `,
      [search, status, category, ACTIVE_APPLICATION_STATUSES, volunteerType]
    );

    res.status(200).json(result.rows.map((row) => publicOpportunity(row, { includeMeeting: true })));
  } catch (error) {
    console.error('Admin list volunteering error:', error);
    res.status(500).json({ error: 'Unable to load volunteering opportunities.' });
  }
};

export const adminGetStats = async (_req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT
        COUNT(*)::integer AS total_opportunities,
        COUNT(*) FILTER (WHERE status = 'published')::integer AS published,
        COUNT(*) FILTER (
          WHERE status = 'published' AND event_date >= CURRENT_DATE
        )::integer AS upcoming,
        COUNT(*) FILTER (WHERE status = 'completed')::integer AS completed_opportunities,
        (SELECT COUNT(*)::integer FROM volunteer_applications) AS total_applications,
        (SELECT COUNT(*)::integer FROM volunteer_applications WHERE status = 'approved') AS approved_volunteers,
        (SELECT COUNT(*)::integer FROM volunteer_applications WHERE status = 'completed') AS completed_applications
      FROM volunteer_opportunities
      `
    );

    res.status(200).json(result.rows[0]);
  } catch (error) {
    console.error('Admin volunteering stats error:', error);
    res.status(500).json({ error: 'Unable to load volunteering statistics.' });
  }
};

export const createOpportunity = async (req, res) => {
  try {
    const parsed = validateOpportunityBody(req.body);

    if (parsed.error) {
      return res.status(400).json({ error: parsed.error });
    }

    const data = parsed.data;

    const result = await pool.query(
      `
      INSERT INTO volunteer_opportunities (
        title,
        description,
        category,
        banner_url,
        volunteer_type,
        event_date,
        start_time,
        end_time,
        location,
        meeting_url,
        capacity,
        requirements,
        status,
        created_by
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      RETURNING ${opportunityReturning}
      `,
      [
        data.title,
        data.description,
        data.category,
        data.banner_url,
        data.volunteer_type,
        data.event_date,
        data.start_time,
        data.end_time,
        data.location,
        data.meeting_url,
        data.capacity,
        data.requirements,
        data.status === 'published' ? 'published' : 'draft',
        req.user.userId,
      ]
    );

    const opportunity = result.rows[0];

    if (opportunity.status === 'published') {
      await notifyVolunteeringPublished(opportunity);
    }

    res.status(201).json({
      message: 'Opportunity created.',
      opportunity,
    });
  } catch (error) {
    console.error('Create volunteering opportunity error:', error);
    res.status(500).json({ error: 'Unable to create this opportunity.' });
  }
};

export const updateOpportunity = async (req, res) => {
  try {
    const opportunityId = parseId(req.params.id);

    if (!opportunityId) {
      return res.status(400).json({ error: 'Invalid opportunity.' });
    }

    const parsed = validateOpportunityBody(req.body);

    if (parsed.error) {
      return res.status(400).json({ error: parsed.error });
    }

    const data = parsed.data;

    const existing = await pool.query(
      `
      SELECT ${opportunityReturning}
      FROM volunteer_opportunities
      WHERE id = $1
      `,
      [opportunityId]
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Opportunity not found.' });
    }

    const current = existing.rows[0];

    if (isOpportunityCoreLocked(current) && opportunityCoreFieldsChanged(current, data)) {
      return res.status(409).json({
        error: 'Core opportunity details cannot be edited after the activity has started.',
      });
    }

    if (data.capacity !== null) {
      const occupied = await pool.query(occupiedCountQuery, [
        opportunityId,
        APPROVED_CAPACITY_STATUSES,
      ]);

      if (occupied.rows[0].occupied > data.capacity) {
        return res.status(409).json({
          error: 'Capacity cannot be lower than the number of approved volunteers.',
        });
      }
    }

    const result = await pool.query(
      `
      UPDATE volunteer_opportunities
      SET
        title = $1,
        description = $2,
        category = $3,
        banner_url = $4,
        volunteer_type = $5,
        event_date = $6,
        start_time = $7,
        end_time = $8,
        location = $9,
        meeting_url = $10,
        capacity = $11,
        requirements = $12,
        status = $13,
        updated_at = NOW()
      WHERE id = $14
      RETURNING ${opportunityReturning}
      `,
      [
        data.title,
        data.description,
        data.category,
        data.banner_url,
        data.volunteer_type,
        data.event_date,
        data.start_time,
        data.end_time,
        data.location,
        data.meeting_url,
        data.capacity,
        data.requirements,
        data.status,
        opportunityId,
      ]
    );

    const opportunity = result.rows[0];

    if (!opportunity) {
      return res.status(404).json({ error: 'Opportunity not found.' });
    }

    const becamePublished =
      current.status !== 'published' && opportunity.status === 'published';
    const becameCancelled =
      current.status !== 'cancelled' && opportunity.status === 'cancelled';
    const meaningfulUpdate =
      current.status === 'published' &&
      opportunity.status === 'published' &&
      (
        current.title !== data.title ||
        current.description !== data.description ||
        opportunityCoreFieldsChanged(current, data)
      );

    if (becamePublished) {
      await notifyVolunteeringPublished(opportunity);
    } else if (becameCancelled) {
      await notifyVolunteeringCancelled(opportunity);
    } else if (meaningfulUpdate) {
      await notifyVolunteeringUpdated(opportunity);
    }

    res.status(200).json({
      message: 'Opportunity updated.',
      opportunity,
    });
  } catch (error) {
    console.error('Update volunteering opportunity error:', error);
    res.status(500).json({ error: 'Unable to update this opportunity.' });
  }
};

export const publishOpportunity = (req, res) =>
  setOpportunityStatus(req, res, 'published', 'Opportunity published.');

export const unpublishOpportunity = (req, res) =>
  setOpportunityStatus(req, res, 'draft', 'Opportunity moved to draft.');

export const closeOpportunity = (req, res) =>
  setOpportunityStatus(req, res, 'closed', 'Opportunity closed.');

export const completeOpportunity = (req, res) =>
  setOpportunityStatus(req, res, 'completed', 'Opportunity marked completed.');

export const cancelOpportunity = (req, res) =>
  setOpportunityStatus(req, res, 'cancelled', 'Opportunity cancelled.');

export const deleteOpportunity = async (req, res) => {
  try {
    const opportunityId = parseId(req.params.id);

    if (!opportunityId) {
      return res.status(400).json({ error: 'Invalid opportunity.' });
    }

    const existing = await pool.query(
      `
      SELECT
        o.id,
        o.status,
        COUNT(a.id) FILTER (
          WHERE a.status IN ('approved', 'completed')
        )::integer AS protected_count
      FROM volunteer_opportunities o
      LEFT JOIN volunteer_applications a ON a.opportunity_id = o.id
      WHERE o.id = $1
      GROUP BY o.id
      `,
      [opportunityId]
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Opportunity not found.' });
    }

    if (existing.rows[0].protected_count > 0) {
      return res.status(400).json({
        error: 'This opportunity has approved or completed volunteers. Cancel it instead of deleting.',
      });
    }

    await pool.query(`DELETE FROM volunteer_opportunities WHERE id = $1`, [opportunityId]);

    res.status(200).json({ message: 'Opportunity deleted.' });
  } catch (error) {
    console.error('Delete volunteering opportunity error:', error);
    res.status(500).json({ error: 'Unable to delete this opportunity.' });
  }
};

export const listApplications = async (req, res) => {
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
        a.id,
        a.opportunity_id,
        a.user_id,
        a.status,
        a.applied_at,
        a.reviewed_at,
        a.reviewed_by,
        u.name AS participant_name,
        u.email AS participant_email,
        u.role AS participant_role
      FROM volunteer_applications a
      JOIN users u ON u.id = a.user_id
      WHERE a.opportunity_id = $1
      ORDER BY a.applied_at ASC
      `,
      [opportunityId]
    );

    res.status(200).json(result.rows);
  } catch (error) {
    console.error('List volunteering applications error:', error);
    res.status(500).json({ error: 'Unable to load applications.' });
  }
};

const reviewApplication = async (req, res, nextStatus, message) => {
  const client = await pool.connect();

  try {
    const applicationId = parseId(req.params.applicationId);

    if (!applicationId) {
      return res.status(400).json({ error: 'Invalid application.' });
    }

    await client.query('BEGIN');

    const applicationResult = await client.query(
      `
      SELECT id, opportunity_id, user_id, status
      FROM volunteer_applications
      WHERE id = $1
      FOR UPDATE
      `,
      [applicationId]
    );

    if (applicationResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Application not found.' });
    }

    const application = applicationResult.rows[0];
    const applicationStatus = String(application.status || '').trim();

    const opportunityResult = await client.query(
      `
      SELECT id, status, capacity
      FROM volunteer_opportunities
      WHERE id = $1
      FOR UPDATE
      `,
      [application.opportunity_id]
    );

    if (opportunityResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Opportunity not found.' });
    }

    const opportunity = opportunityResult.rows[0];
    const opportunityStatus = String(opportunity.status || '').trim().toLowerCase();

    if (nextStatus === 'approved') {
      if (applicationStatus !== 'applied') {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: 'This application has already been reviewed.',
        });
      }

      if (opportunityStatus === 'draft') {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: 'This opportunity is not published.',
        });
      }

      if (opportunityStatus === 'cancelled') {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: 'This opportunity was cancelled.',
        });
      }

      if (opportunityStatus === 'completed') {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: 'This opportunity is completed.',
        });
      }

      if (opportunityStatus !== 'published' && opportunityStatus !== 'closed') {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: 'This opportunity is no longer accepting applications.',
        });
      }

      const occupiedResult = await client.query(
        `
        SELECT COUNT(*)::integer AS occupied
        FROM volunteer_applications
        WHERE opportunity_id = $1
          AND status = ANY($2::varchar[])
          AND id <> $3
        `,
        [application.opportunity_id, APPROVED_CAPACITY_STATUSES, application.id]
      );

      if (
        opportunity.capacity !== null &&
        occupiedResult.rows[0].occupied >= opportunity.capacity
      ) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: 'Opportunity capacity reached.',
        });
      }
    }

    if (nextStatus === 'rejected') {
      if (applicationStatus !== 'applied') {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: 'This application has already been reviewed.',
        });
      }
    }

    if (
      nextStatus === 'cancelled' &&
      !['applied', 'approved'].includes(applicationStatus)
    ) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'This application cannot be cancelled.',
      });
    }

    const updated = await client.query(
      `
      UPDATE volunteer_applications
      SET
        status = $2,
        reviewed_at = NOW(),
        reviewed_by = $3
      WHERE id = $1
      RETURNING id, opportunity_id, user_id, status, applied_at, reviewed_at
      `,
      [applicationId, nextStatus, req.user.userId]
    );

    await client.query('COMMIT');

    if (nextStatus === 'approved' || nextStatus === 'rejected') {
      const opportunity = await pool.query(
        `SELECT id, title FROM volunteer_opportunities WHERE id = $1`,
        [application.opportunity_id]
      );
      if (opportunity.rows[0]) {
        await notifyVolunteeringApplicationReviewed(
          opportunity.rows[0],
          application.user_id,
          nextStatus === 'approved'
        );
      }
    }

    res.status(200).json({
      message,
      application: updated.rows[0],
    });
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // ignore rollback errors
    }

    console.error('Review volunteering application error:', error);
    res.status(500).json({ error: 'Unable to update this application.' });
  } finally {
    client.release();
  }
};

export const approveApplication = (req, res) =>
  reviewApplication(req, res, 'approved', 'Application approved.');

export const rejectApplication = (req, res) =>
  reviewApplication(req, res, 'rejected', 'Application rejected.');

export const cancelApplication = (req, res) =>
  reviewApplication(req, res, 'cancelled', 'Application cancelled.');

export const completeApplication = async (req, res) => {
  const client = await pool.connect();

  try {
    const applicationId = parseId(req.params.applicationId);

    if (!applicationId) {
      return res.status(400).json({ error: 'Invalid application.' });
    }

    await client.query('BEGIN');

    const applicationResult = await client.query(
      `
      SELECT a.*, att.status AS attendance_status
      FROM volunteer_applications a
      LEFT JOIN volunteer_attendance att
        ON att.application_id = a.id
      WHERE a.id = $1
      FOR UPDATE OF a
      `,
      [applicationId]
    );

    if (applicationResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Application not found.' });
    }

    const application = applicationResult.rows[0];

    if (application.status !== 'approved') {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'Only approved volunteers can be marked completed.',
      });
    }

    if (
      application.attendance_status !== 'present' &&
      application.attendance_status !== 'partial'
    ) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'Mark attendance as present or partial before completing.',
      });
    }

    const updated = await client.query(
      `
      UPDATE volunteer_applications
      SET
        status = 'completed',
        reviewed_at = NOW(),
        reviewed_by = $2
      WHERE id = $1
      RETURNING id, opportunity_id, user_id, status, applied_at, reviewed_at
      `,
      [applicationId, req.user.userId]
    );

    await client.query('COMMIT');

    const opportunity = await pool.query(
      `SELECT id, title FROM volunteer_opportunities WHERE id = $1`,
      [application.opportunity_id]
    );
    if (opportunity.rows[0]) {
      await notifyVolunteeringCompleted(opportunity.rows[0], [application.user_id]);
    }

    res.status(200).json({
      message: 'Volunteer marked completed.',
      application: updated.rows[0],
      certificate_status: certificateStatusFor({
        applicationStatus: 'completed',
        attendanceStatus: application.attendance_status,
        issued: false,
      }),
    });
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // ignore rollback errors
    }

    console.error('Complete volunteering application error:', error);
    res.status(500).json({ error: 'Unable to complete this application.' });
  } finally {
    client.release();
  }
};

export const issueVolunteerCertificate = async (req, res) => {
  try {
    const applicationId = parseId(req.params.applicationId);

    if (!applicationId) {
      return res.status(400).json({ error: 'Invalid application.' });
    }

    const applicationResult = await pool.query(
      `
      SELECT
        a.id,
        a.opportunity_id,
        a.user_id,
        a.status,
        att.status AS attendance_status,
        c.certificate_number
      FROM volunteer_applications a
      LEFT JOIN volunteer_attendance att ON att.application_id = a.id
      LEFT JOIN volunteer_certificates c ON c.application_id = a.id
      WHERE a.id = $1
      `,
      [applicationId]
    );

    if (applicationResult.rows.length === 0) {
      return res.status(404).json({ error: 'Application not found.' });
    }

    const application = applicationResult.rows[0];

    if (application.certificate_number) {
      return res.status(200).json({
        message: 'Certificate was already issued.',
        certificate_number: application.certificate_number,
        certificate_url: null,
      });
    }

    if (
      application.status !== 'completed' ||
      (application.attendance_status !== 'present' &&
        application.attendance_status !== 'partial')
    ) {
      return res.status(400).json({
        error: 'This volunteer is not eligible for a certificate yet.',
      });
    }

    const certificateNumber = `VOL-${application.opportunity_id}-U${application.user_id}-${Date.now()}`;

    const inserted = await pool.query(
      `
      INSERT INTO volunteer_certificates (
        opportunity_id,
        user_id,
        application_id,
        certificate_number,
        certificate_url
      )
      VALUES ($1, $2, $3, $4, NULL)
      RETURNING *
      `,
      [
        application.opportunity_id,
        application.user_id,
        application.id,
        certificateNumber,
      ]
    );

    res.status(201).json({
      message: 'Certificate record issued.',
      certificate: inserted.rows[0],
    });
  } catch (error) {
    if (error?.code === '23505') {
      return res.status(409).json({
        error: 'A certificate already exists for this volunteer.',
      });
    }

    console.error('Issue volunteering certificate error:', error);
    res.status(500).json({ error: 'Unable to issue certificate.' });
  }
};
