import pool from '../../db.js';
import { parsePositiveInt } from '../../utils/ticketNumber.js';

const escapeLike = (value) => String(value).replace(/[%_\\]/g, '\\$&');

const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'can',
  'do',
  'for',
  'how',
  'i',
  'if',
  'in',
  'is',
  'it',
  'me',
  'my',
  'of',
  'on',
  'or',
  'the',
  'to',
  'what',
  'where',
  'you',
]);

const extractTerms = (query) => {
  const tokens = String(query || '')
    .toLowerCase()
    .split(/\s+/)
    .map((part) => part.replace(/[^a-z0-9]+/g, ''))
    .filter((part) => part.length > 1 && !STOP_WORDS.has(part));

  return tokens.length > 0 ? [...new Set(tokens)] : [];
};

const scoreFaq = (row, query) => {
  const terms = extractTerms(query);

  if (terms.length === 0) {
    return 0;
  }

  const question = String(row.question || '').toLowerCase();
  const answer = String(row.answer || '').toLowerCase();
  const keywords = String(row.search_keywords || '').toLowerCase();
  const category = String(row.category_name || '').toLowerCase();

  let score = 0;
  for (const term of terms) {
    if (question.includes(term)) score += 4;
    if (keywords.includes(term)) score += 3;
    if (category.includes(term)) score += 2;
    if (answer.includes(term)) score += 1;
  }

  if (question.includes(String(query).toLowerCase().trim())) {
    score += 6;
  }

  return score;
};

export const searchPublishedFaqs = async (query, { category, limit = 8 } = {}) => {
  const search = String(query || '').trim();
  const categorySlug = typeof category === 'string' ? category.trim() : '';
  const safeLimit = Math.min(Math.max(Number(limit) || 8, 1), 25);

  if (!search) {
    return listPublishedFaqs({ category: categorySlug, limit: safeLimit });
  }

  const terms = extractTerms(search);
  const patterns = (terms.length > 0 ? terms : [search.toLowerCase()]).map(
    (term) => `%${escapeLike(term)}%`
  );
  const result = await pool.query(
    `
    SELECT
      f.id,
      f.question,
      f.answer,
      f.search_keywords,
      f.display_order,
      f.category_id,
      c.name AS category_name,
      c.slug AS category_slug
    FROM help_faqs f
    LEFT JOIN help_categories c ON c.id = f.category_id
    WHERE f.status = 'published'
      AND ($2 = '' OR c.slug = $2)
      AND EXISTS (
        SELECT 1
        FROM unnest($1::text[]) AS p(pattern)
        WHERE f.question ILIKE p.pattern ESCAPE '\\'
          OR f.answer ILIKE p.pattern ESCAPE '\\'
          OR COALESCE(f.search_keywords, '') ILIKE p.pattern ESCAPE '\\'
          OR COALESCE(c.name, '') ILIKE p.pattern ESCAPE '\\'
      )
    ORDER BY f.display_order ASC, f.id ASC
    LIMIT 50
    `,
    [patterns, categorySlug]
  );

  return result.rows
    .map((row) => ({ ...row, score: scoreFaq(row, search) }))
    .filter((row) => row.score > 0)
    .sort((left, right) => right.score - left.score || left.display_order - right.display_order)
    .slice(0, safeLimit);
};

export const listPublishedFaqs = async ({ category, limit = 20, page = 1 } = {}) => {
  const categorySlug = typeof category === 'string' ? category.trim() : '';
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 50);
  const safePage = Math.max(Number(page) || 1, 1);
  const offset = (safePage - 1) * safeLimit;

  const result = await pool.query(
    `
    SELECT
      f.id,
      f.question,
      f.answer,
      f.search_keywords,
      f.display_order,
      f.category_id,
      c.name AS category_name,
      c.slug AS category_slug
    FROM help_faqs f
    LEFT JOIN help_categories c ON c.id = f.category_id
    WHERE f.status = 'published'
      AND ($1 = '' OR c.slug = $1)
    ORDER BY f.display_order ASC, f.id ASC
    LIMIT $2 OFFSET $3
    `,
    [categorySlug, safeLimit, offset]
  );

  const count = await pool.query(
    `
    SELECT COUNT(*)::integer AS total
    FROM help_faqs f
    LEFT JOIN help_categories c ON c.id = f.category_id
    WHERE f.status = 'published'
      AND ($1 = '' OR c.slug = $1)
    `,
    [categorySlug]
  );

  return {
    faqs: result.rows,
    page: safePage,
    limit: safeLimit,
    total: count.rows[0].total,
  };
};

export const getPublishedFaqById = async (faqId) => {
  const id = parsePositiveInt(faqId);
  if (!id) {
    return null;
  }

  const result = await pool.query(
    `
    SELECT
      f.id,
      f.question,
      f.answer,
      f.search_keywords,
      f.display_order,
      f.category_id,
      c.name AS category_name,
      c.slug AS category_slug
    FROM help_faqs f
    LEFT JOIN help_categories c ON c.id = f.category_id
    WHERE f.id = $1 AND f.status = 'published'
    `,
    [id]
  );

  return result.rows[0] || null;
};
