import express from 'express';

import {
  getEvents,
  getEventById,
  getAdminEvents,
  getMyEvents,
  createEvent,
  updateEvent,
  cancelEvent,
  deleteEvent,
  registerForEvent,
} from '../controllers/eventsController.js';

import {
  getEventRegistrations,
  removeEventRegistration,
  getEventAttendance,
  upsertEventAttendance,
  getEventCertificates,
  issueEventCertificate,
  issueEligibleEventCertificates,
  getMyEventCertificate,
  getEventAnalytics,
} from '../controllers/eventsOpsController.js';

import {
  joinEventSession,
  heartbeatEventSession,
  leaveEventSession,
  uploadEventBanner,
} from '../controllers/eventsSessionController.js';

import {
  optionalAuth,
  requireAuth,
  requireRole,
} from '../middleware/authMiddleware.js';

import {
  createImageUpload,
  handleUploadError,
} from '../utils/storage.js';

const eventBannerUpload = createImageUpload('events');

const router = express.Router();

router.get('/', getEvents);

router.get(
  '/admin/all',
  requireAuth,
  requireRole('admin'),
  getAdminEvents
);

router.get(
  '/my-events',
  requireAuth,
  getMyEvents
);

router.post(
  '/uploads/banner',
  requireAuth,
  requireRole('admin'),
  eventBannerUpload.single('banner'),
  handleUploadError,
  uploadEventBanner
);

router.post(
  '/',
  requireAuth,
  requireRole('admin'),
  createEvent
);

router.put(
  '/:id',
  requireAuth,
  requireRole('admin'),
  updateEvent
);

router.patch(
  '/:id/cancel',
  requireAuth,
  requireRole('admin'),
  cancelEvent
);

router.delete(
  '/:id',
  requireAuth,
  requireRole('admin'),
  deleteEvent
);

router.post(
  '/:id/register',
  requireAuth,
  registerForEvent
);

router.get(
  '/:id/registrations',
  requireAuth,
  requireRole('admin'),
  getEventRegistrations
);

router.delete(
  '/:id/registrations/:userId',
  requireAuth,
  requireRole('admin'),
  removeEventRegistration
);

router.get(
  '/:id/attendance',
  requireAuth,
  requireRole('admin'),
  getEventAttendance
);

router.put(
  '/:id/attendance',
  requireAuth,
  requireRole('admin'),
  upsertEventAttendance
);

router.get(
  '/:id/certificates/me',
  requireAuth,
  getMyEventCertificate
);

router.get(
  '/:id/certificates',
  requireAuth,
  requireRole('admin'),
  getEventCertificates
);

router.post(
  '/:id/certificates/issue-eligible',
  requireAuth,
  requireRole('admin'),
  issueEligibleEventCertificates
);

router.post(
  '/:id/certificates',
  requireAuth,
  requireRole('admin'),
  issueEventCertificate
);

router.get(
  '/:id/analytics',
  requireAuth,
  requireRole('admin'),
  getEventAnalytics
);

router.post(
  '/:id/session/join',
  requireAuth,
  joinEventSession
);

router.post(
  '/:id/session/heartbeat',
  requireAuth,
  heartbeatEventSession
);

router.post(
  '/:id/session/leave',
  requireAuth,
  leaveEventSession
);

router.get('/:id', optionalAuth, getEventById);

export default router;
