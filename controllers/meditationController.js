import pool from '../db.js';
import { upload, getFileUrl } from '../utils/storage.js';
import { notifyMeditationPublished } from '../services/notifications/hooks.js';

export const getCategories = async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM meditation_categories ORDER BY name ASC');
    res.status(200).json({ categories: result.rows });
  } catch (error) {
    console.error('Get categories error:', error);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
};

export const createCategory = async (req, res) => {
  try {
    const { name, description } = req.body || {};

    if (!name) {
      return res.status(400).json({ error: 'Category name is required.' });
    }

    const slug = name.toLowerCase().trim().replace(/\s+/g, '-');

    const result = await pool.query(
      `INSERT INTO meditation_categories (name, slug, description) VALUES ($1, $2, $3) RETURNING *`,
      [name, slug, description || null]
    );

    res.status(201).json({ category: result.rows[0] });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'A category with this name already exists.' });
    }
    console.error('Create category error:', error);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
};
export const uploadMeditation = async (req, res) => {
    try {
      const { title, description, categoryId, mediaType, durationSeconds } = req.body || {};
      const userId = req.user.userId;
  
      if (!title || !mediaType || !durationSeconds) {
        return res.status(400).json({ error: 'Title, media type, and duration are required.' });
      }
  
      if (!['audio', 'video'].includes(mediaType)) {
        return res.status(400).json({ error: 'Media type must be audio or video.' });
      }
  
      if (!req.file) {
        return res.status(400).json({ error: 'A media file is required.' });
      }
  
      const mediaUrl = getFileUrl(req.file.filename);
  
      const result = await pool.query(
        `INSERT INTO meditations (title, description, category_id, media_type, media_url, duration_seconds, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [title, description || null, categoryId || null, mediaType, mediaUrl, durationSeconds, userId]
      );
  
      const meditation = result.rows[0];
      await notifyMeditationPublished(meditation);

      res.status(201).json({ meditation });
    } catch (error) {
      console.error('Upload meditation error:', error);
      res.status(500).json({ error: 'Something went wrong. Please try again.' });
    }
  };
  
  export const getMeditations = async (req, res) => {
    try {
      const { categoryId } = req.query;
  
      let query = `
        SELECT m.*, c.name AS category_name
        FROM meditations m
        LEFT JOIN meditation_categories c ON m.category_id = c.id
      `;
      const params = [];
  
      if (categoryId) {
        query += ' WHERE m.category_id = $1';
        params.push(categoryId);
      }
  
      query += ' ORDER BY m.created_at DESC';
  
      const result = await pool.query(query, params);
      res.status(200).json({ meditations: result.rows });
    } catch (error) {
      console.error('Get meditations error:', error);
      res.status(500).json({ error: 'Something went wrong. Please try again.' });
    }
  };
  
  export const getMeditationById = async (req, res) => {
    try {
      const { id } = req.params;
  
      const result = await pool.query(
        `SELECT m.*, c.name AS category_name
         FROM meditations m
         LEFT JOIN meditation_categories c ON m.category_id = c.id
         WHERE m.id = $1`,
        [id]
      );
  
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Meditation not found.' });
      }
  
      res.status(200).json({ meditation: result.rows[0] });
    } catch (error) {
      console.error('Get meditation error:', error);
      res.status(500).json({ error: 'Something went wrong. Please try again.' });
    }
  };

  export const updateProgress = async (req, res) => {
    try {
      const { id } = req.params;
      const { progressSeconds, completed } = req.body || {};
      const userId = req.user.userId;
  
      if (progressSeconds === undefined) {
        return res.status(400).json({ error: 'progressSeconds is required.' });
      }
  
      const result = await pool.query(
        `INSERT INTO meditation_progress (user_id, meditation_id, progress_seconds, completed, last_played_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (user_id, meditation_id)
         DO UPDATE SET progress_seconds = $3, completed = $4, last_played_at = NOW()
         RETURNING *`,
        [userId, id, progressSeconds, completed || false]
      );
  
      res.status(200).json({ progress: result.rows[0] });
    } catch (error) {
      console.error('Update progress error:', error);
      res.status(500).json({ error: 'Something went wrong. Please try again.' });
    }
  };
  
  export const getUserProgress = async (req, res) => {
    try {
      const { id } = req.params;
      const userId = req.user.userId;
  
      const result = await pool.query(
        'SELECT * FROM meditation_progress WHERE user_id = $1 AND meditation_id = $2',
        [userId, id]
      );
  
      res.status(200).json({ progress: result.rows[0] || null });
    } catch (error) {
      console.error('Get progress error:', error);
      res.status(500).json({ error: 'Something went wrong. Please try again.' });
    }
  };
  
  export const toggleBookmark = async (req, res) => {
    try {
      const { id } = req.params;
      const userId = req.user.userId;
  
      const existing = await pool.query(
        'SELECT id FROM meditation_bookmarks WHERE user_id = $1 AND meditation_id = $2',
        [userId, id]
      );
  
      if (existing.rows.length > 0) {
        await pool.query('DELETE FROM meditation_bookmarks WHERE user_id = $1 AND meditation_id = $2', [
          userId,
          id,
        ]);
        return res.status(200).json({ bookmarked: false });
      }
  
      await pool.query(
        'INSERT INTO meditation_bookmarks (user_id, meditation_id) VALUES ($1, $2)',
        [userId, id]
      );
      res.status(200).json({ bookmarked: true });
    } catch (error) {
      console.error('Toggle bookmark error:', error);
      res.status(500).json({ error: 'Something went wrong. Please try again.' });
    }
  };
  
  export const getBookmarkStatus = async (req, res) => {
    try {
      const { id } = req.params;
      const userId = req.user.userId;
  
      const result = await pool.query(
        'SELECT id FROM meditation_bookmarks WHERE user_id = $1 AND meditation_id = $2',
        [userId, id]
      );
  
      res.status(200).json({ bookmarked: result.rows.length > 0 });
    } catch (error) {
      console.error('Get bookmark status error:', error);
      res.status(500).json({ error: 'Something went wrong. Please try again.' });
    }
  };