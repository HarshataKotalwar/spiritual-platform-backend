import express from 'express';

import {
  adminCreateRule,
  adminDeleteRule,
  adminGetOverview,
  adminListActivity,
  adminListRules,
  adminSendNotification,
  adminUpdateRule,
  getMyNotifications,
  getMyPreferences,
  getMyUnreadCount,
  markMyNotificationRead,
  markMyNotificationsReadAll,
  dismissMyNotification,
  updateMyPreferences,
} from '../controllers/notificationController.js';
import { requireAuth, requireRole } from '../middleware/authMiddleware.js';

const router = express.Router();

router.use(requireAuth);

router.get('/unread-count', getMyUnreadCount);
router.get('/preferences', getMyPreferences);
router.patch('/preferences', updateMyPreferences);
router.patch('/read-all', markMyNotificationsReadAll);

router.get('/admin/overview', requireRole('admin'), adminGetOverview);
router.get('/admin/rules', requireRole('admin'), adminListRules);
router.post('/admin/rules', requireRole('admin'), adminCreateRule);
router.patch('/admin/rules/:id', requireRole('admin'), adminUpdateRule);
router.delete('/admin/rules/:id', requireRole('admin'), adminDeleteRule);
router.post('/admin/send', requireRole('admin'), adminSendNotification);
router.get('/admin', requireRole('admin'), adminListActivity);

router.patch('/:id/read', markMyNotificationRead);
router.delete('/:id', dismissMyNotification);
router.get('/', getMyNotifications);

export default router;
