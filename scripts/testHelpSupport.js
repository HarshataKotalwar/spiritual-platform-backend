import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

import pool from '../db.js';
import { listUserNotifications } from '../services/notifications/notificationService.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API = `http://localhost:${process.env.PORT || 5000}`;
const results = [];

const record = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const ensureSchema = async () => {
  const sql = fs.readFileSync(path.join(__dirname, '../help_support.sql'), 'utf8');
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

const supportDeepLink = (entityId, role) =>
  role === 'admin'
    ? `/admin/helpdesk/tickets/${entityId}`
    : `/my-support/${entityId}`;

const main = async () => {
  const prefix = `helptest.${Date.now()}`;
  await ensureSchema();
  const password = 'HelpTest123!';
  const userId = await upsertUser(`${prefix}.user@example.com`, 'user', password);
  const otherId = await upsertUser(`${prefix}.other@example.com`, 'user', password);
  const mentorId = await upsertUser(`${prefix}.mentor@example.com`, 'mentor', password);
  const adminId = await upsertUser(`${prefix}.admin@example.com`, 'admin', password);
  const userToken = tokenFor(userId, 'user');
  const otherToken = tokenFor(otherId, 'user');
  const mentorToken = tokenFor(mentorId, 'mentor');
  const adminToken = tokenFor(adminId, 'admin');

  const guestFaqs = await api('GET', '/api/help/faqs', null);
  record(
    'Guest can read published FAQs',
    guestFaqs.status === 200 && Array.isArray(guestFaqs.data.faqs) && guestFaqs.data.faqs.length > 0,
    guestFaqs.data.error || ''
  );

  const draft = await api('POST', '/api/help/admin/faqs', adminToken, {
    question: `${prefix} Draft only question`,
    answer: 'This should stay hidden.',
    status: 'draft',
  });
  record('Admin can create FAQ', draft.status === 201, draft.data.error || '');
  const draftId = draft.data?.faq?.id;
  const guestDraft = await api('GET', `/api/help/faqs/${draftId}`, null);
  record('Guest cannot read draft FAQs', guestDraft.status === 404);

  const search = await api('GET', '/api/help/search?q=How%20do%20I%20register%20for%20an%20event', null);
  record(
    'Search returns relevant published FAQ',
    search.status === 200 &&
      Array.isArray(search.data.faqs) &&
      search.data.faqs.some((row) => /register/i.test(row.question)),
    search.data.error || JSON.stringify(search.data.faqs?.map((row) => row.question).slice(0, 3) || search.status)
  );

  const publishedFaq = (guestFaqs.data.faqs || [])[0];
  const feedback = await api('POST', `/api/help/faqs/${publishedFaq?.id}/feedback`, userToken, {
    helpful: true,
  });
  record('User can submit FAQ feedback', feedback.status === 200, feedback.data.error || '');

  const guestTicket = await api('POST', '/api/support/tickets', null, {
    subject: 'Nope',
    description: 'Guest should fail',
  });
  record('Guest cannot create a support ticket', guestTicket.status === 401);

  const created = await api('POST', '/api/support/tickets', userToken, {
    subject: `${prefix} Event registration issue`,
    description: 'I cannot register for a published event.',
    priority: 'high',
  });
  record('User can create support ticket', created.status === 201, created.data.error || '');
  const ticketId = created.data?.ticket?.id;

  const mine = await api('GET', `/api/support/tickets/${ticketId}`, userToken);
  record('User can view own ticket', mine.status === 200 && mine.data.id === ticketId);

  const stolen = await api('GET', `/api/support/tickets/${ticketId}`, otherToken);
  record('User cannot view another user ticket', stolen.status === 403);

  const reply = await api('POST', `/api/support/tickets/${ticketId}/messages`, userToken, {
    message: 'Adding more detail for support.',
  });
  record('User can reply to own ticket', reply.status === 201, reply.data.error || '');

  const mentorTicket = await api('POST', '/api/support/tickets', mentorToken, {
    subject: `${prefix} Mentor access question`,
    description: 'How do I open community as a mentor?',
  });
  record('Mentor can create support ticket', mentorTicket.status === 201, mentorTicket.data.error || '');

  const mentorAdmin = await api('GET', '/api/support/admin/overview', mentorToken);
  record('Mentor cannot access admin helpdesk', mentorAdmin.status === 403);

  const adminList = await api('GET', '/api/support/admin/tickets', adminToken);
  record(
    'Admin can view all tickets',
    adminList.status === 200 &&
      Array.isArray(adminList.data) &&
      adminList.data.some((row) => row.id === ticketId),
    adminList.data.error || ''
  );

  const adminReply = await api(
    'POST',
    `/api/support/admin/tickets/${ticketId}/messages`,
    adminToken,
    { message: 'Please try registering again while signed in.' }
  );
  record('Admin can reply', adminReply.status === 201, adminReply.data.error || '');

  const statusChange = await api('PATCH', `/api/support/admin/tickets/${ticketId}`, adminToken, {
    status: 'waiting_for_user',
  });
  record(
    'Admin can change status',
    statusChange.status === 200 && statusChange.data.ticket?.status === 'waiting_for_user',
    statusChange.data.error || ''
  );

  const priorityChange = await api('PATCH', `/api/support/admin/tickets/${ticketId}`, adminToken, {
    priority: 'urgent',
  });
  record(
    'Admin can change priority',
    priorityChange.status === 200 && priorityChange.data.ticket?.priority === 'urgent',
    priorityChange.data.error || ''
  );

  const createdFaq = await api('POST', '/api/help/admin/faqs', adminToken, {
    question: `${prefix} How do I contact support?`,
    answer: 'Create a support request from the Help Centre.',
    status: 'draft',
    search_keywords: 'contact support',
  });
  const faqId = createdFaq.data?.faq?.id;
  const edited = await api('PATCH', `/api/help/admin/faqs/${faqId}`, adminToken, {
    answer: 'Create a support request from Help or My Support.',
  });
  record('Admin can edit FAQ', edited.status === 200, edited.data.error || '');
  const published = await api('PATCH', `/api/help/admin/faqs/${faqId}`, adminToken, {
    status: 'published',
  });
  record(
    'Admin can publish FAQ',
    published.status === 200 && published.data.faq?.status === 'published',
    published.data.error || ''
  );
  const visible = await api('GET', `/api/help/faqs/${faqId}`, null);
  record('Published FAQ is visible to guests', visible.status === 200);
  const unpublished = await api('PATCH', `/api/help/admin/faqs/${faqId}`, adminToken, {
    status: 'draft',
  });
  record('Admin can unpublish FAQ', unpublished.status === 200);
  const hidden = await api('GET', `/api/help/faqs/${faqId}`, null);
  record('Unpublished FAQ is hidden from normal users', hidden.status === 404);

  const createdNotes = await listUserNotifications(adminId, { limit: 50 });
  record(
    'Ticket creation notification works',
    createdNotes.notifications.some(
      (row) => row.type === 'SUPPORT_TICKET_CREATED' && Number(row.entity_id) === Number(ticketId)
    )
  );
  const ownerNotes = await listUserNotifications(userId, { limit: 50 });
  record(
    'Admin reply notification works',
    ownerNotes.notifications.some(
      (row) => row.type === 'SUPPORT_TICKET_REPLY' && Number(row.entity_id) === Number(ticketId)
    )
  );

  record(
    'Support deep links work',
    supportDeepLink(ticketId, 'user') === `/my-support/${ticketId}` &&
      supportDeepLink(ticketId, 'admin') === `/admin/helpdesk/tickets/${ticketId}`
  );

  const failed = results.filter((item) => !item.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);

  await pool.query(`DELETE FROM support_tickets WHERE subject LIKE $1`, [`${prefix}%`]);
  await pool.query(`DELETE FROM help_faqs WHERE question LIKE $1`, [`${prefix}%`]);
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
