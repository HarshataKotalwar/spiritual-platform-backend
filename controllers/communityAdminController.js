import pool from '../db.js';
import { notifyCommunityModeration } from '../services/notifications/hooks.js';

const parseId = (value) => {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    return null;
  }
  return id;
};

const publicAuthor = (row, prefix = '') => ({
  id: row[`${prefix}author_id`],
  name: row[`${prefix}author_name`],
  role: row[`${prefix}author_role`],
});

export const adminGetGroups = async (req, res) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const status = typeof req.query.status === 'string' ? req.query.status.trim() : '';

    const result = await pool.query(
      `
      SELECT
        g.id,
        g.name,
        g.description,
        g.category,
        g.banner_url,
        g.status,
        g.is_active,
        g.created_by,
        g.created_at,
        COUNT(DISTINCT m.id)::integer AS member_count,
        COUNT(DISTINCT q.id)::integer AS question_count
      FROM community_groups g
      LEFT JOIN community_group_members m ON m.group_id = g.id
      LEFT JOIN community_questions q ON q.group_id = g.id
      WHERE ($1 = '' OR g.name ILIKE '%' || $1 || '%' OR COALESCE(g.description, '') ILIKE '%' || $1 || '%')
        AND ($2 = '' OR g.status = $2)
      GROUP BY g.id
      ORDER BY g.created_at DESC
      `,
      [q, status]
    );

    res.status(200).json(result.rows);
  } catch (error) {
    console.error('Admin get community groups error:', error);
    res.status(500).json({ error: 'Unable to load communities.' });
  }
};

export const adminGetGroupById = async (req, res) => {
  try {
    const groupId = parseId(req.params.id);

    if (!groupId) {
      return res.status(400).json({ error: 'Invalid community.' });
    }

    const groupResult = await pool.query(
      `
      SELECT
        g.id,
        g.name,
        g.description,
        g.category,
        g.banner_url,
        g.status,
        g.is_active,
        g.created_by,
        u.name AS creator_name,
        g.created_at,
        COUNT(DISTINCT m.id)::integer AS member_count
      FROM community_groups g
      LEFT JOIN users u ON u.id = g.created_by
      LEFT JOIN community_group_members m ON m.group_id = g.id
      WHERE g.id = $1
      GROUP BY g.id, u.name
      `,
      [groupId]
    );

    if (groupResult.rows.length === 0) {
      return res.status(404).json({ error: 'Community not found.' });
    }

    const questions = await pool.query(
      `
      SELECT
        q.id,
        q.title,
        q.content,
        q.status,
        q.created_at,
        u.id AS author_id,
        u.name AS author_name,
        u.role AS author_role,
        COUNT(r.id)::integer AS reply_count
      FROM community_questions q
      JOIN users u ON u.id = q.user_id
      LEFT JOIN community_replies r ON r.question_id = q.id
      WHERE q.group_id = $1
      GROUP BY q.id, u.id
      ORDER BY q.created_at DESC
      `,
      [groupId]
    );

    res.status(200).json({
      ...groupResult.rows[0],
      questions: questions.rows.map((row) => ({
        id: row.id,
        title: row.title,
        content: row.content,
        status: row.status,
        created_at: row.created_at,
        reply_count: row.reply_count,
        author: publicAuthor(row),
      })),
    });
  } catch (error) {
    console.error('Admin get community group error:', error);
    res.status(500).json({ error: 'Unable to load this community.' });
  }
};

export const adminUpdateGroupStatus = async (req, res) => {
  try {
    const groupId = parseId(req.params.id);
    const status = req.body?.status;

    if (!groupId) {
      return res.status(400).json({ error: 'Invalid community.' });
    }

    if (!['active', 'archived', 'removed'].includes(status)) {
      return res.status(400).json({ error: 'Invalid community status.' });
    }

    const result = await pool.query(
      `
      UPDATE community_groups
      SET
        status = $2,
        is_active = $3,
        updated_at = NOW()
      WHERE id = $1
      RETURNING id, name, status, is_active
      `,
      [groupId, status, status === 'active']
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Community not found.' });
    }

    res.status(200).json({
      message: 'Community updated.',
      group: result.rows[0],
    });
  } catch (error) {
    console.error('Admin update community status error:', error);
    res.status(500).json({ error: 'Unable to update this community.' });
  }
};

export const adminRemoveQuestion = async (req, res) => {
  try {
    const questionId = parseId(req.params.id);

    if (!questionId) {
      return res.status(400).json({ error: 'Invalid question.' });
    }

    const result = await pool.query(
      `
      UPDATE community_questions
      SET status = 'removed', updated_at = NOW()
      WHERE id = $1
      RETURNING id, status, user_id, title
      `,
      [questionId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Question not found.' });
    }

    const question = result.rows[0];
    await notifyCommunityModeration(
      question.user_id,
      `Your discussion “${question.title}” was removed by a moderator.`,
      question.id
    );

    res.status(200).json({
      message: 'Question removed.',
      question: { id: question.id, status: question.status },
    });
  } catch (error) {
    console.error('Admin remove question error:', error);
    res.status(500).json({ error: 'Unable to remove this question.' });
  }
};

export const adminGetQuestionById = async (req, res) => {
  try {
    const questionId = parseId(req.params.id);

    if (!questionId) {
      return res.status(400).json({ error: 'Invalid question.' });
    }

    const questionResult = await pool.query(
      `
      SELECT
        q.id,
        q.group_id,
        g.name AS group_name,
        q.title,
        q.content,
        q.status,
        q.created_at,
        u.id AS author_id,
        u.name AS author_name,
        u.role AS author_role
      FROM community_questions q
      JOIN community_groups g ON g.id = q.group_id
      JOIN users u ON u.id = q.user_id
      WHERE q.id = $1
      `,
      [questionId]
    );

    if (questionResult.rows.length === 0) {
      return res.status(404).json({ error: 'Question not found.' });
    }

    const repliesResult = await pool.query(
      `
      SELECT
        r.id,
        r.question_id,
        r.parent_id,
        r.content,
        r.status,
        r.created_at,
        u.id AS author_id,
        u.name AS author_name,
        u.role AS author_role
      FROM community_replies r
      JOIN users u ON u.id = r.user_id
      WHERE r.question_id = $1
      ORDER BY r.created_at ASC
      `,
      [questionId]
    );

    const question = questionResult.rows[0];

    res.status(200).json({
      id: question.id,
      group_id: question.group_id,
      group_name: question.group_name,
      title: question.title,
      content: question.content,
      status: question.status,
      created_at: question.created_at,
      author: publicAuthor(question),
      replies: repliesResult.rows.map((row) => ({
        id: row.id,
        question_id: row.question_id,
        parent_id: row.parent_id,
        content: row.content,
        status: row.status,
        created_at: row.created_at,
        author: publicAuthor(row),
      })),
    });
  } catch (error) {
    console.error('Admin get question error:', error);
    res.status(500).json({ error: 'Unable to load this question.' });
  }
};

export const adminRemoveReply = async (req, res) => {
  try {
    const replyId = parseId(req.params.id);

    if (!replyId) {
      return res.status(400).json({ error: 'Invalid reply.' });
    }

    const result = await pool.query(
      `
      UPDATE community_replies
      SET status = 'removed', updated_at = NOW()
      WHERE id = $1
      RETURNING id, status, user_id, question_id
      `,
      [replyId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Reply not found.' });
    }

    const reply = result.rows[0];
    await notifyCommunityModeration(
      reply.user_id,
      'A moderator removed one of your community replies.',
      reply.question_id
    );

    res.status(200).json({
      message: 'Reply removed.',
      reply: { id: reply.id, status: reply.status },
    });
  } catch (error) {
    console.error('Admin remove reply error:', error);
    res.status(500).json({ error: 'Unable to remove this reply.' });
  }
};
