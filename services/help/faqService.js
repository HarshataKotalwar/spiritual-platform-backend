import pool from '../../db.js';
import { httpError, parsePositiveInt } from '../../utils/ticketNumber.js';

export const listActiveCategories = async () => {
  const result = await pool.query(
    `
    SELECT id, name, slug, description, icon, display_order
    FROM help_categories
    WHERE is_active = TRUE
    ORDER BY display_order ASC, name ASC
    `
  );
  return result.rows;
};

export const submitFaqFeedback = async (faqId, userId, helpful) => {
  const id = parsePositiveInt(faqId);
  if (!id) {
    throw httpError(400, 'Invalid FAQ.');
  }

  if (typeof helpful !== 'boolean') {
    throw httpError(400, 'Please choose whether this was helpful.');
  }

  const faq = await pool.query(
    `SELECT id FROM help_faqs WHERE id = $1 AND status = 'published'`,
    [id]
  );

  if (faq.rows.length === 0) {
    throw httpError(404, 'FAQ not found.');
  }

  const result = await pool.query(
    `
    INSERT INTO help_faq_feedback (faq_id, user_id, helpful)
    VALUES ($1, $2, $3)
    ON CONFLICT (faq_id, user_id) WHERE user_id IS NOT NULL
    DO UPDATE SET helpful = EXCLUDED.helpful
    RETURNING id, helpful
    `,
    [id, userId, helpful]
  );

  return result.rows[0];
};

const parseFaqBody = (body, { partial = false } = {}) => {
  const question = typeof body.question === 'string' ? body.question.trim() : '';
  const answer = typeof body.answer === 'string' ? body.answer.trim() : '';
  const searchKeywords =
    typeof body.search_keywords === 'string' ? body.search_keywords.trim() : '';
  const status = typeof body.status === 'string' ? body.status.trim() : undefined;
  const categoryId =
    body.category_id === '' || body.category_id === null || body.category_id === undefined
      ? null
      : parsePositiveInt(body.category_id);
  const displayOrder =
    body.display_order === undefined || body.display_order === ''
      ? undefined
      : Number(body.display_order);

  if (!partial && (!question || !answer)) {
    throw httpError(400, 'Question and answer are required.');
  }

  if (status && !['draft', 'published'].includes(status)) {
    throw httpError(400, 'Status must be draft or published.');
  }

  if (displayOrder !== undefined && (!Number.isInteger(displayOrder) || displayOrder < 0)) {
    throw httpError(400, 'Display order must be zero or a positive whole number.');
  }

  if (body.category_id !== undefined && body.category_id !== null && body.category_id !== '' && !categoryId) {
    throw httpError(400, 'Invalid category.');
  }

  return {
    question: question || undefined,
    answer: answer || undefined,
    search_keywords: searchKeywords || null,
    status,
    category_id: body.category_id === undefined ? undefined : categoryId,
    display_order: displayOrder,
  };
};

export const adminListFaqs = async ({ search = '', category = '', status = '' } = {}) => {
  const result = await pool.query(
    `
    SELECT
      f.id,
      f.question,
      f.answer,
      f.search_keywords,
      f.status,
      f.display_order,
      f.category_id,
      f.updated_at,
      c.name AS category_name,
      c.slug AS category_slug
    FROM help_faqs f
    LEFT JOIN help_categories c ON c.id = f.category_id
    WHERE ($1 = '' OR f.question ILIKE '%' || $1 || '%' OR f.answer ILIKE '%' || $1 || '%' OR COALESCE(f.search_keywords, '') ILIKE '%' || $1 || '%')
      AND ($2 = '' OR c.slug = $2)
      AND ($3 = '' OR f.status = $3)
    ORDER BY f.display_order ASC, f.id DESC
    `,
    [String(search).trim(), String(category).trim(), String(status).trim()]
  );
  return result.rows;
};

export const adminGetFaq = async (faqId) => {
  const id = parsePositiveInt(faqId);
  if (!id) {
    throw httpError(400, 'Invalid FAQ.');
  }

  const result = await pool.query(
    `
    SELECT
      f.*,
      c.name AS category_name,
      c.slug AS category_slug
    FROM help_faqs f
    LEFT JOIN help_categories c ON c.id = f.category_id
    WHERE f.id = $1
    `,
    [id]
  );

  if (result.rows.length === 0) {
    throw httpError(404, 'FAQ not found.');
  }

  return result.rows[0];
};

export const adminCreateFaq = async (body, userId) => {
  const data = parseFaqBody(body);
  if (data.category_id) {
    const category = await pool.query(`SELECT id FROM help_categories WHERE id = $1`, [
      data.category_id,
    ]);
    if (category.rows.length === 0) {
      throw httpError(400, 'Category not found.');
    }
  }

  const result = await pool.query(
    `
    INSERT INTO help_faqs (
      category_id, question, answer, search_keywords, status, display_order, created_by
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING *
    `,
    [
      data.category_id,
      data.question,
      data.answer,
      data.search_keywords,
      data.status || 'draft',
      data.display_order ?? 0,
      userId,
    ]
  );
  return result.rows[0];
};

export const adminUpdateFaq = async (faqId, body) => {
  const current = await adminGetFaq(faqId);
  const patch = parseFaqBody(body, { partial: true });
  const next = {
    question: patch.question ?? current.question,
    answer: patch.answer ?? current.answer,
    search_keywords:
      patch.search_keywords === undefined ? current.search_keywords : patch.search_keywords,
    status: patch.status ?? current.status,
    category_id: patch.category_id === undefined ? current.category_id : patch.category_id,
    display_order: patch.display_order ?? current.display_order,
  };

  if (next.category_id) {
    const category = await pool.query(`SELECT id FROM help_categories WHERE id = $1`, [
      next.category_id,
    ]);
    if (category.rows.length === 0) {
      throw httpError(400, 'Category not found.');
    }
  }

  const result = await pool.query(
    `
    UPDATE help_faqs
    SET
      category_id = $1,
      question = $2,
      answer = $3,
      search_keywords = $4,
      status = $5,
      display_order = $6,
      updated_at = NOW()
    WHERE id = $7
    RETURNING *
    `,
    [
      next.category_id,
      next.question,
      next.answer,
      next.search_keywords,
      next.status,
      next.display_order,
      current.id,
    ]
  );
  return result.rows[0];
};

export const adminDeleteFaq = async (faqId) => {
  const id = parsePositiveInt(faqId);
  if (!id) {
    throw httpError(400, 'Invalid FAQ.');
  }

  const result = await pool.query(`DELETE FROM help_faqs WHERE id = $1 RETURNING id`, [id]);
  if (result.rows.length === 0) {
    throw httpError(404, 'FAQ not found.');
  }
};
