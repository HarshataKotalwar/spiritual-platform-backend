import pool from '../../db.js';
import { httpError, nextTicketNumber, parsePositiveInt } from '../../utils/ticketNumber.js';
import {
  notifySupportStatusUpdated,
  notifySupportTicketCreated,
  notifySupportTicketReply,
} from '../notifications/hooks.js';

const STATUSES = ['open', 'in_progress', 'waiting_for_user', 'resolved', 'closed'];
const PRIORITIES = ['low', 'normal', 'high', 'urgent'];
const RELATED_TYPES = ['event', 'volunteering', 'community_question', 'meditation'];
const SENDER_ROLES = ['user', 'mentor', 'admin'];

const senderRoleFor = (role) => (SENDER_ROLES.includes(role) ? role : 'user');

const ticketSelect = `
  t.id,
  t.ticket_number,
  t.user_id,
  t.category_id,
  t.subject,
  t.description,
  t.status,
  t.priority,
  t.related_entity_type,
  t.related_entity_id,
  t.created_at,
  t.updated_at,
  t.resolved_at,
  c.name AS category_name,
  c.slug AS category_slug,
  u.name AS user_name,
  u.email AS user_email,
  u.role AS user_role
`;

const relatedQueries = {
  event: 'SELECT id FROM events WHERE id = $1',
  volunteering: 'SELECT id FROM volunteer_opportunities WHERE id = $1',
  community_question: 'SELECT id FROM community_questions WHERE id = $1',
  meditation: 'SELECT id FROM meditations WHERE id = $1',
};

const validateRelatedEntity = async (entityType, entityId) => {
  if (!entityType && (entityId === undefined || entityId === null || entityId === '')) {
    return { related_entity_type: null, related_entity_id: null };
  }

  if (!entityType || !RELATED_TYPES.includes(entityType)) {
    throw httpError(400, 'Invalid related feature.');
  }

  const id = parsePositiveInt(entityId);
  if (!id) {
    throw httpError(400, 'A valid related item is required.');
  }

  const result = await pool.query(relatedQueries[entityType], [id]);
  if (result.rows.length === 0) {
    throw httpError(400, 'The related item could not be found.');
  }

  return { related_entity_type: entityType, related_entity_id: id };
};

const getCategory = async (categoryId) => {
  if (categoryId === null || categoryId === undefined || categoryId === '') {
    return null;
  }
  const id = parsePositiveInt(categoryId);
  if (!id) {
    throw httpError(400, 'Invalid category.');
  }
  const result = await pool.query(
    `SELECT id FROM help_categories WHERE id = $1 AND is_active = TRUE`,
    [id]
  );
  if (result.rows.length === 0) {
    throw httpError(400, 'Category not found.');
  }
  return id;
};

const loadMessages = async (ticketId) => {
  const result = await pool.query(
    `
    SELECT
      m.id,
      m.ticket_id,
      m.sender_user_id,
      m.sender_role,
      m.message,
      m.created_at,
      u.name AS sender_name
    FROM support_ticket_messages m
    LEFT JOIN users u ON u.id = m.sender_user_id
    WHERE m.ticket_id = $1
    ORDER BY m.created_at ASC, m.id ASC
    `,
    [ticketId]
  );
  return result.rows;
};

const getTicketRow = async (ticketId, client = pool) => {
  const id = parsePositiveInt(ticketId);
  if (!id) {
    throw httpError(400, 'Invalid ticket.');
  }

  const result = await client.query(
    `
    SELECT ${ticketSelect}
    FROM support_tickets t
    LEFT JOIN help_categories c ON c.id = t.category_id
    JOIN users u ON u.id = t.user_id
    WHERE t.id = $1
    `,
    [id]
  );

  if (result.rows.length === 0) {
    throw httpError(404, 'Support request not found.');
  }

  return result.rows[0];
};

export const createTicket = async (user, body) => {
  const subject = typeof body.subject === 'string' ? body.subject.trim() : '';
  const description = typeof body.description === 'string' ? body.description.trim() : '';
  const priority = typeof body.priority === 'string' ? body.priority.trim() : 'normal';

  if (!subject || !description) {
    throw httpError(400, 'Subject and description are required.');
  }

  if (subject.length > 255) {
    throw httpError(400, 'Subject must be 255 characters or fewer.');
  }

  if (!PRIORITIES.includes(priority)) {
    throw httpError(400, 'Invalid priority.');
  }

  const categoryId = await getCategory(body.category_id);
  const related = await validateRelatedEntity(body.related_entity_type, body.related_entity_id);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const ticketNumber = await nextTicketNumber(client);
    const inserted = await client.query(
      `
      INSERT INTO support_tickets (
        ticket_number,
        user_id,
        category_id,
        subject,
        description,
        priority,
        related_entity_type,
        related_entity_id
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      RETURNING id
      `,
      [
        ticketNumber,
        user.userId,
        categoryId,
        subject,
        description,
        priority,
        related.related_entity_type,
        related.related_entity_id,
      ]
    );

    await client.query(
      `
      INSERT INTO support_ticket_messages (ticket_id, sender_user_id, sender_role, message)
      VALUES ($1, $2, $3, $4)
      `,
      [inserted.rows[0].id, user.userId, senderRoleFor(user.role), description]
    );

    await client.query('COMMIT');
    const ticket = await getTicketRow(inserted.rows[0].id);
    await notifySupportTicketCreated(ticket);
    return ticket;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // ignore
    }
    throw error;
  } finally {
    client.release();
  }
};

export const listMyTickets = async (userId, { status } = {}) => {
  const statusFilter = STATUSES.includes(status) ? status : '';
  const result = await pool.query(
    `
    SELECT ${ticketSelect}
    FROM support_tickets t
    LEFT JOIN help_categories c ON c.id = t.category_id
    JOIN users u ON u.id = t.user_id
    WHERE t.user_id = $1
      AND ($2 = '' OR t.status = $2)
    ORDER BY t.updated_at DESC, t.id DESC
    `,
    [userId, statusFilter]
  );
  return result.rows;
};

export const getMyTicket = async (userId, ticketId) => {
  const ticket = await getTicketRow(ticketId);
  if (Number(ticket.user_id) !== Number(userId)) {
    throw httpError(403, 'You do not have permission to view this support request.');
  }
  return {
    ...ticket,
    messages: await loadMessages(ticket.id),
  };
};

export const addMyMessage = async (user, ticketId, messageText) => {
  const message = typeof messageText === 'string' ? messageText.trim() : '';
  if (!message) {
    throw httpError(400, 'A message is required.');
  }

  const ticket = await getTicketRow(ticketId);
  if (Number(ticket.user_id) !== Number(user.userId)) {
    throw httpError(403, 'You do not have permission to update this support request.');
  }

  if (['resolved', 'closed'].includes(ticket.status)) {
    throw httpError(400, 'Reopen this request before adding a reply.');
  }

  const nextStatus = ticket.status === 'waiting_for_user' ? 'open' : ticket.status;
  const updated = await pool.query(
    `
    UPDATE support_tickets
    SET status = $2, updated_at = NOW()
    WHERE id = $1
    RETURNING id
    `,
    [ticket.id, nextStatus]
  );

  const inserted = await pool.query(
    `
    INSERT INTO support_ticket_messages (ticket_id, sender_user_id, sender_role, message)
    VALUES ($1, $2, $3, $4)
    RETURNING id, created_at
    `,
    [updated.rows[0].id, user.userId, senderRoleFor(user.role), message]
  );

  await notifySupportTicketReply({
    ticket,
    actorRole: user.role,
    messageId: inserted.rows[0].id,
  });

  return getMyTicket(user.userId, ticket.id);
};

export const updateMyTicketStatus = async (userId, ticketId, status) => {
  if (status !== 'open') {
    throw httpError(400, 'You can reopen a resolved or closed request.');
  }

  const ticket = await getTicketRow(ticketId);
  if (Number(ticket.user_id) !== Number(userId)) {
    throw httpError(403, 'You do not have permission to update this support request.');
  }

  if (!['resolved', 'closed'].includes(ticket.status)) {
    throw httpError(400, 'Only resolved or closed requests can be reopened.');
  }

  await pool.query(
    `
    UPDATE support_tickets
    SET status = 'open', resolved_at = NULL, updated_at = NOW()
    WHERE id = $1
    `,
    [ticket.id]
  );

  const updated = await getMyTicket(userId, ticket.id);
  await notifySupportStatusUpdated(updated, ticket.status);
  return updated;
};

export const adminOverview = async () => {
  const result = await pool.query(
    `
    SELECT
      COUNT(*) FILTER (WHERE status = 'open')::integer AS open_count,
      COUNT(*) FILTER (WHERE status = 'in_progress')::integer AS in_progress_count,
      COUNT(*) FILTER (WHERE status = 'waiting_for_user')::integer AS waiting_for_user_count,
      COUNT(*) FILTER (WHERE status = 'resolved')::integer AS resolved_count,
      COUNT(*) FILTER (WHERE status = 'closed')::integer AS closed_count,
      COUNT(*) FILTER (WHERE priority IN ('high', 'urgent') AND status NOT IN ('resolved', 'closed'))::integer AS high_urgent_count
    FROM support_tickets
    `
  );
  return result.rows[0];
};

export const adminListTickets = async ({
  status = '',
  priority = '',
  category = '',
  search = '',
} = {}) => {
  const result = await pool.query(
    `
    SELECT ${ticketSelect}
    FROM support_tickets t
    LEFT JOIN help_categories c ON c.id = t.category_id
    JOIN users u ON u.id = t.user_id
    WHERE ($1 = '' OR t.status = $1)
      AND ($2 = '' OR t.priority = $2)
      AND ($3 = '' OR c.slug = $3)
      AND (
        $4 = ''
        OR t.ticket_number ILIKE '%' || $4 || '%'
        OR t.subject ILIKE '%' || $4 || '%'
        OR u.name ILIKE '%' || $4 || '%'
        OR u.email ILIKE '%' || $4 || '%'
      )
    ORDER BY t.updated_at DESC, t.id DESC
    `,
    [String(status).trim(), String(priority).trim(), String(category).trim(), String(search).trim()]
  );
  return result.rows;
};

export const adminGetTicket = async (ticketId) => {
  const ticket = await getTicketRow(ticketId);
  return {
    ...ticket,
    messages: await loadMessages(ticket.id),
  };
};

export const adminAddMessage = async (admin, ticketId, messageText) => {
  const message = typeof messageText === 'string' ? messageText.trim() : '';
  if (!message) {
    throw httpError(400, 'A message is required.');
  }

  const ticket = await getTicketRow(ticketId);
  const nextStatus = ['open', 'waiting_for_user'].includes(ticket.status)
    ? 'in_progress'
    : ticket.status;

  await pool.query(
    `
    UPDATE support_tickets
    SET status = $2, updated_at = NOW()
    WHERE id = $1
    `,
    [ticket.id, nextStatus]
  );

  const inserted = await pool.query(
    `
    INSERT INTO support_ticket_messages (ticket_id, sender_user_id, sender_role, message)
    VALUES ($1, $2, 'admin', $3)
    RETURNING id
    `,
    [ticket.id, admin.userId, message]
  );

  const updated = await adminGetTicket(ticket.id);
  await notifySupportTicketReply({
    ticket: updated,
    actorRole: 'admin',
    messageId: inserted.rows[0].id,
  });
  return updated;
};

export const adminUpdateTicket = async (ticketId, body) => {
  const ticket = await getTicketRow(ticketId);
  const status = typeof body.status === 'string' ? body.status.trim() : ticket.status;
  const priority = typeof body.priority === 'string' ? body.priority.trim() : ticket.priority;

  if (!STATUSES.includes(status)) {
    throw httpError(400, 'Invalid status.');
  }
  if (!PRIORITIES.includes(priority)) {
    throw httpError(400, 'Invalid priority.');
  }

  const resolvedAt =
    status === 'resolved' || status === 'closed'
      ? ticket.resolved_at || new Date()
      : null;

  await pool.query(
    `
    UPDATE support_tickets
    SET
      status = $2,
      priority = $3,
      resolved_at = $4,
      updated_at = NOW()
    WHERE id = $1
    `,
    [ticket.id, status, priority, resolvedAt]
  );

  const updated = await adminGetTicket(ticket.id);
  if (status !== ticket.status) {
    await notifySupportStatusUpdated(updated, ticket.status);
  }
  return updated;
};
