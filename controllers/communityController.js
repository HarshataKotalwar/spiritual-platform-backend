import pool from '../db.js';
import { getStoredImageUrl } from '../utils/storage.js';

const TITLE_MAX = 200;
const CONTENT_MAX = 5000;

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

const isGroupMember = async (groupId, userId) => {
  const result = await pool.query(
    `
    SELECT id
    FROM community_group_members
    WHERE group_id = $1 AND user_id = $2
    `,
    [groupId, userId]
  );
  return result.rows.length > 0;
};

export const getGroups = async (req, res) => {
  try {
    const userId = req.user.userId;
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';

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
        g.created_at,
        COUNT(DISTINCT m.id)::integer AS member_count,
        COUNT(DISTINCT q.id)::integer AS question_count,
        EXISTS (
          SELECT 1
          FROM community_group_members me
          WHERE me.group_id = g.id AND me.user_id = $1
        ) AS is_member
      FROM community_groups g
      LEFT JOIN community_group_members m ON m.group_id = g.id
      LEFT JOIN community_questions q
        ON q.group_id = g.id AND q.status = 'active'
      WHERE g.status = 'active'
        AND (
          $2 = ''
          OR g.name ILIKE '%' || $2 || '%'
          OR COALESCE(g.description, '') ILIKE '%' || $2 || '%'
          OR COALESCE(g.category, '') ILIKE '%' || $2 || '%'
        )
      GROUP BY g.id
      ORDER BY g.name ASC
      `,
      [userId, q]
    );

    res.status(200).json(result.rows);
  } catch (error) {
    console.error('Get community groups error:', error);
    res.status(500).json({ error: 'Unable to load community groups.' });
  }
};

export const getGroupById = async (req, res) => {
  try {
    const groupId = parseId(req.params.id);
    const userId = req.user.userId;

    if (!groupId) {
      return res.status(400).json({ error: 'Invalid group.' });
    }

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
        g.created_at,
        COUNT(DISTINCT m.id)::integer AS member_count,
        COUNT(DISTINCT q.id)::integer AS question_count,
        EXISTS (
          SELECT 1
          FROM community_group_members me
          WHERE me.group_id = g.id AND me.user_id = $2
        ) AS is_member
      FROM community_groups g
      LEFT JOIN community_group_members m ON m.group_id = g.id
      LEFT JOIN community_questions q
        ON q.group_id = g.id AND q.status = 'active'
      WHERE g.id = $1 AND g.status = 'active'
      GROUP BY g.id
      `,
      [groupId, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Group not found.' });
    }

    res.status(200).json(result.rows[0]);
  } catch (error) {
    console.error('Get community group error:', error);
    res.status(500).json({ error: 'Unable to load this group.' });
  }
};

export const joinGroup = async (req, res) => {
  try {
    const groupId = parseId(req.params.id);
    const userId = req.user.userId;

    if (!groupId) {
      return res.status(400).json({ error: 'Invalid group.' });
    }

    const group = await pool.query(
      `SELECT id FROM community_groups WHERE id = $1 AND status = 'active'`,
      [groupId]
    );

    if (group.rows.length === 0) {
      return res.status(404).json({ error: 'Group not found.' });
    }

    await pool.query(
      `
      INSERT INTO community_group_members (group_id, user_id)
      VALUES ($1, $2)
      `,
      [groupId, userId]
    );

    res.status(201).json({ message: 'You have joined this group.' });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'You have already joined this group.' });
    }

    console.error('Join community group error:', error);
    res.status(500).json({ error: 'Unable to join this group.' });
  }
};

export const leaveGroup = async (req, res) => {
  try {
    const groupId = parseId(req.params.id);
    const userId = req.user.userId;

    if (!groupId) {
      return res.status(400).json({ error: 'Invalid group.' });
    }

    const result = await pool.query(
      `
      DELETE FROM community_group_members
      WHERE group_id = $1 AND user_id = $2
      RETURNING id
      `,
      [groupId, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'You are not a member of this group.' });
    }

    res.status(200).json({ message: 'You have left this group.' });
  } catch (error) {
    console.error('Leave community group error:', error);
    res.status(500).json({ error: 'Unable to leave this group.' });
  }
};

export const getGroupQuestions = async (req, res) => {
  try {
    const groupId = parseId(req.params.id);

    if (!groupId) {
      return res.status(400).json({ error: 'Invalid group.' });
    }

    const group = await pool.query(
      `SELECT id FROM community_groups WHERE id = $1 AND status = 'active'`,
      [groupId]
    );

    if (group.rows.length === 0) {
      return res.status(404).json({ error: 'Group not found.' });
    }

    const result = await pool.query(
      `
      SELECT
        q.id,
        q.group_id,
        q.title,
        q.content,
        q.created_at,
        u.id AS author_id,
        u.name AS author_name,
        u.role AS author_role,
        COUNT(r.id) FILTER (WHERE r.status = 'active')::integer AS reply_count
      FROM community_questions q
      JOIN users u ON u.id = q.user_id
      LEFT JOIN community_replies r ON r.question_id = q.id
      WHERE q.group_id = $1 AND q.status = 'active'
      GROUP BY q.id, u.id
      ORDER BY q.created_at DESC
      `,
      [groupId]
    );

    res.status(200).json(
      result.rows.map((row) => ({
        id: row.id,
        group_id: row.group_id,
        title: row.title,
        content: row.content,
        created_at: row.created_at,
        reply_count: row.reply_count,
        author: publicAuthor(row),
      }))
    );
  } catch (error) {
    console.error('Get group questions error:', error);
    res.status(500).json({ error: 'Unable to load discussions.' });
  }
};

export const createQuestion = async (req, res) => {
  try {
    const groupId = parseId(req.params.id);
    const userId = req.user.userId;
    const title = typeof req.body.title === 'string' ? req.body.title.trim() : '';
    const content = typeof req.body.content === 'string' ? req.body.content.trim() : '';

    if (!groupId) {
      return res.status(400).json({ error: 'Invalid group.' });
    }

    if (!title || !content) {
      return res.status(400).json({ error: 'Title and question are required.' });
    }

    if (title.length > TITLE_MAX) {
      return res.status(400).json({ error: `Title must be ${TITLE_MAX} characters or fewer.` });
    }

    if (content.length > CONTENT_MAX) {
      return res.status(400).json({ error: `Question must be ${CONTENT_MAX} characters or fewer.` });
    }

    const group = await pool.query(
      `SELECT id FROM community_groups WHERE id = $1 AND status = 'active'`,
      [groupId]
    );

    if (group.rows.length === 0) {
      return res.status(404).json({ error: 'Group not found.' });
    }

    const member = await isGroupMember(groupId, userId);
    if (!member) {
      return res.status(403).json({ error: 'Join this group to start a discussion.' });
    }

    const result = await pool.query(
      `
      INSERT INTO community_questions (group_id, user_id, title, content)
      VALUES ($1, $2, $3, $4)
      RETURNING id, group_id, title, content, created_at
      `,
      [groupId, userId, title, content]
    );

    res.status(201).json({
      message: 'Your question has been shared.',
      question: result.rows[0],
    });
  } catch (error) {
    console.error('Create community question error:', error);
    res.status(500).json({ error: 'Unable to share this question.' });
  }
};

export const getRecentQuestions = async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT
        q.id,
        q.group_id,
        g.name AS group_name,
        q.title,
        q.content,
        q.created_at,
        u.id AS author_id,
        u.name AS author_name,
        u.role AS author_role,
        COUNT(r.id)::integer AS reply_count
      FROM community_questions q
      JOIN community_groups g ON g.id = q.group_id
      JOIN users u ON u.id = q.user_id
      LEFT JOIN community_replies r ON r.question_id = q.id
      WHERE g.status = 'active' AND q.status = 'active'
      GROUP BY q.id, g.name, u.id
      ORDER BY q.created_at DESC
      LIMIT 12
      `
    );

    res.status(200).json(
      result.rows.map((row) => ({
        id: row.id,
        group_id: row.group_id,
        group_name: row.group_name,
        title: row.title,
        content: row.content,
        created_at: row.created_at,
        reply_count: row.reply_count,
        author: publicAuthor(row),
      }))
    );
  } catch (error) {
    console.error('Get recent community questions error:', error);
    res.status(500).json({ error: 'Unable to load discussions.' });
  }
};

export const getQuestionById = async (req, res) => {
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
        q.created_at,
        u.id AS author_id,
        u.name AS author_name,
        u.role AS author_role
      FROM community_questions q
      JOIN community_groups g ON g.id = q.group_id
      JOIN users u ON u.id = q.user_id
      WHERE q.id = $1 AND g.status = 'active' AND q.status = 'active'
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
        r.created_at,
        u.id AS author_id,
        u.name AS author_name,
        u.role AS author_role
      FROM community_replies r
      JOIN users u ON u.id = r.user_id
      WHERE r.question_id = $1 AND r.status = 'active'
      ORDER BY r.created_at ASC
      `,
      [questionId]
    );

    const question = questionResult.rows[0];
    const mapped = repliesResult.rows.map((row) => ({
      id: row.id,
      question_id: row.question_id,
      parent_id: row.parent_id,
      content: row.content,
      created_at: row.created_at,
      author: publicAuthor(row),
      replies: [],
    }));

    const answers = mapped.filter((row) => !row.parent_id);
    const comments = mapped.filter((row) => row.parent_id);
    const byId = new Map(answers.map((row) => [row.id, row]));

    comments.forEach((comment) => {
      const parent = byId.get(comment.parent_id);
      if (parent) {
        parent.replies.push(comment);
      }
    });

    res.status(200).json({
      id: question.id,
      group_id: question.group_id,
      group_name: question.group_name,
      title: question.title,
      content: question.content,
      created_at: question.created_at,
      author: publicAuthor(question),
      reply_count: answers.length,
      replies: answers,
    });
  } catch (error) {
    console.error('Get community question error:', error);
    res.status(500).json({ error: 'Unable to load this discussion.' });
  }
};

export const createReply = async (req, res) => {
  try {
    const questionId = parseId(req.params.id);
    const userId = req.user.userId;
    const parentId = req.body?.parent_id ? parseId(req.body.parent_id) : null;
    const content = typeof req.body.content === 'string' ? req.body.content.trim() : '';

    if (!questionId) {
      return res.status(400).json({ error: 'Invalid question.' });
    }

    if (!content) {
      return res.status(400).json({ error: 'A reply is required.' });
    }

    if (content.length > CONTENT_MAX) {
      return res.status(400).json({
        error: `Reply must be ${CONTENT_MAX} characters or fewer.`,
      });
    }

    const question = await pool.query(
      `
      SELECT q.id, q.group_id
      FROM community_questions q
      JOIN community_groups g ON g.id = q.group_id
      WHERE q.id = $1 AND g.status = 'active' AND q.status = 'active'
      `,
      [questionId]
    );

    if (question.rows.length === 0) {
      return res.status(404).json({ error: 'Question not found.' });
    }

    const member = await isGroupMember(question.rows[0].group_id, userId);
    if (!member) {
      return res.status(403).json({ error: 'Join this community to participate.' });
    }

    if (parentId) {
      const parent = await pool.query(
        `
        SELECT id
        FROM community_replies
        WHERE id = $1 AND question_id = $2 AND status = 'active' AND parent_id IS NULL
        `,
        [parentId, questionId]
      );

      if (parent.rows.length === 0) {
        return res.status(400).json({ error: 'That answer is not available to discuss.' });
      }
    }

    const result = await pool.query(
      `
      INSERT INTO community_replies (question_id, user_id, content, parent_id)
      VALUES ($1, $2, $3, $4)
      RETURNING id, question_id, parent_id, content, created_at
      `,
      [questionId, userId, content, parentId]
    );

    const authorResult = await pool.query(
      `SELECT id, name, role FROM users WHERE id = $1`,
      [userId]
    );

    res.status(201).json({
      message: parentId ? 'Your comment has been shared.' : 'Your answer has been shared.',
      reply: {
        ...result.rows[0],
        replies: [],
        author: {
          id: authorResult.rows[0].id,
          name: authorResult.rows[0].name,
          role: authorResult.rows[0].role,
        },
      },
    });
  } catch (error) {
    console.error('Create community reply error:', error);
    res.status(500).json({ error: 'Unable to share this reply.' });
  }
};

export const createGroup = async (req, res) => {
  try {
    const userId = req.user.userId;
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
    const description =
      typeof req.body.description === 'string' ? req.body.description.trim() : '';
    const category =
      typeof req.body.category === 'string' ? req.body.category.trim() : '';
    const bannerUrl =
      typeof req.body.banner_url === 'string' ? req.body.banner_url.trim() : '';

    if (!name) {
      return res.status(400).json({ error: 'Community name is required.' });
    }

    if (name.length > 200) {
      return res.status(400).json({ error: 'Community name must be 200 characters or fewer.' });
    }

    if (!description) {
      return res.status(400).json({ error: 'Please add a short description.' });
    }

    if (description.length > 2000) {
      return res.status(400).json({ error: 'Description must be 2000 characters or fewer.' });
    }

    if (category.length > 80) {
      return res.status(400).json({ error: 'Category must be 80 characters or fewer.' });
    }

    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const created = await client.query(
        `
        INSERT INTO community_groups (
          name,
          description,
          category,
          banner_url,
          created_by,
          status,
          is_active
        )
        VALUES ($1, $2, $3, $4, $5, 'active', TRUE)
        RETURNING *
        `,
        [name, description, category || null, bannerUrl || null, userId]
      );

      await client.query(
        `
        INSERT INTO community_group_members (group_id, user_id)
        VALUES ($1, $2)
        `,
        [created.rows[0].id, userId]
      );

      await client.query('COMMIT');

      res.status(201).json({
        message: 'Community created.',
        group: {
          ...created.rows[0],
          member_count: 1,
          question_count: 0,
          is_member: true,
        },
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'A community with this name already exists.' });
    }

    console.error('Create community group error:', error);
    res.status(500).json({ error: 'Unable to create this community.' });
  }
};

export const uploadCommunityBanner = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Please choose an image to upload.' });
    }

    res.status(201).json({
      banner_url: getStoredImageUrl('community', req.file.filename),
    });
  } catch (error) {
    console.error('Upload community banner error:', error);
    res.status(500).json({ error: 'Unable to upload community image.' });
  }
};
