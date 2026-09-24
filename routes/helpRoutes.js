import express from 'express';

import {
  getHelpCategories,
  getHelpFaqById,
  getHelpFaqs,
  postFaqFeedback,
  searchHelp,
} from '../controllers/helpController.js';
import {
  adminCreateFaqHandler,
  adminDeleteFaqHandler,
  adminGetFaqById,
  adminGetFaqs,
  adminUpdateFaqHandler,
} from '../controllers/helpAdminController.js';
import { optionalAuth, requireAuth, requireRole } from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/categories', getHelpCategories);
router.get('/search', searchHelp);
router.get('/faqs', getHelpFaqs);

router.get(
  '/admin/faqs',
  requireAuth,
  requireRole('admin'),
  adminGetFaqs
);
router.post(
  '/admin/faqs',
  requireAuth,
  requireRole('admin'),
  adminCreateFaqHandler
);
router.get(
  '/admin/faqs/:id',
  requireAuth,
  requireRole('admin'),
  adminGetFaqById
);
router.patch(
  '/admin/faqs/:id',
  requireAuth,
  requireRole('admin'),
  adminUpdateFaqHandler
);
router.delete(
  '/admin/faqs/:id',
  requireAuth,
  requireRole('admin'),
  adminDeleteFaqHandler
);

router.post('/faqs/:id/feedback', requireAuth, postFaqFeedback);
router.get('/faqs/:id', optionalAuth, getHelpFaqById);

export default router;
