import {
  CHANNEL_IN_APP,
  NOTIFICATION_TYPES,
  SOURCE_AUTOMATIC,
} from './constants.js';
import {
  createBulkNotifications,
  notifyAudience,
  notifySpecificUser,
  processNotificationRules,
} from './notificationService.js';

export const runNotificationSafely = async (task) => {
  try {
    return await task();
  } catch (error) {
    console.error('Notification error:', error);
    return null;
  }
};

export const notifyEventPublished = (event) =>
  runNotificationSafely(() =>
    processNotificationRules({
      notificationType: NOTIFICATION_TYPES.EVENT_PUBLISHED,
      entityType: 'event',
      entityId: event.id,
      vars: { title: event.title },
      occurrenceKey: 'published',
    })
  );

export const notifyEventUpdated = (event) =>
  runNotificationSafely(() =>
    notifyAudience('registered_participants', {
      type: NOTIFICATION_TYPES.EVENT_UPDATED,
      title: 'Event updated',
      message: `${event.title} has been updated.`,
      entityType: 'event',
      entityId: event.id,
      occurrenceKey: `updated:${Date.now()}`,
      skipDedupe: true,
    })
  );

export const notifyEventCancelled = (event) =>
  runNotificationSafely(() =>
    notifyAudience('registered_participants', {
      type: NOTIFICATION_TYPES.EVENT_CANCELLED,
      title: 'Event cancelled',
      message: `${event.title} has been cancelled.`,
      entityType: 'event',
      entityId: event.id,
      occurrenceKey: 'cancelled',
    })
  );

export const notifyEventRegistration = (event, userId) =>
  runNotificationSafely(() =>
    notifySpecificUser(userId, {
      type: NOTIFICATION_TYPES.EVENT_REGISTRATION_CONFIRMED,
      title: 'Registration confirmed',
      message: `You are registered for ${event.title}.`,
      entityType: 'event',
      entityId: event.id,
      occurrenceKey: `registration:${userId}`,
    })
  );

export const notifyEventCertificate = (event, userId) =>
  runNotificationSafely(() =>
    notifySpecificUser(userId, {
      type: NOTIFICATION_TYPES.EVENT_CERTIFICATE_AVAILABLE,
      title: 'Certificate available',
      message: `Your certificate for ${event.title} is now available.`,
      entityType: 'event',
      entityId: event.id,
      occurrenceKey: `certificate:${userId}`,
    })
  );

export const notifyVolunteeringPublished = (opportunity) =>
  runNotificationSafely(() =>
    processNotificationRules({
      notificationType: NOTIFICATION_TYPES.VOLUNTEERING_PUBLISHED,
      entityType: 'volunteering',
      entityId: opportunity.id,
      vars: { title: opportunity.title },
      occurrenceKey: 'published',
    })
  );

export const notifyVolunteeringUpdated = (opportunity) =>
  runNotificationSafely(() =>
    notifyAudience('affected_volunteers', {
      type: NOTIFICATION_TYPES.VOLUNTEERING_UPDATED,
      title: 'Volunteering opportunity updated',
      message: `${opportunity.title} has been updated.`,
      entityType: 'volunteering',
      entityId: opportunity.id,
      occurrenceKey: `updated:${Date.now()}`,
      skipDedupe: true,
    })
  );

export const notifyVolunteeringCancelled = (opportunity) =>
  runNotificationSafely(() =>
    notifyAudience('affected_volunteers', {
      type: NOTIFICATION_TYPES.VOLUNTEERING_CANCELLED,
      title: 'Volunteering opportunity cancelled',
      message: `${opportunity.title} has been cancelled.`,
      entityType: 'volunteering',
      entityId: opportunity.id,
      occurrenceKey: 'cancelled',
    })
  );

export const notifyVolunteeringApplicationSubmitted = async (opportunity, userId) =>
  runNotificationSafely(async () => {
    await notifySpecificUser(userId, {
      type: NOTIFICATION_TYPES.VOLUNTEERING_APPLICATION_SUBMITTED,
      title: 'Application submitted',
      message: `Your application for ${opportunity.title} has been submitted.`,
      entityType: 'volunteering',
      entityId: opportunity.id,
      occurrenceKey: `applied:${userId}`,
    });
    await notifyAudience('admins', {
      type: NOTIFICATION_TYPES.VOLUNTEERING_APPLICATION_SUBMITTED,
      title: 'New volunteer application',
      message: `A participant applied for ${opportunity.title}.`,
      entityType: 'volunteering',
      entityId: opportunity.id,
      occurrenceKey: `applied-admin:${userId}`,
    });
  });

export const notifyVolunteeringApplicationReviewed = (opportunity, userId, approved) =>
  runNotificationSafely(() =>
    notifySpecificUser(userId, {
      type: approved
        ? NOTIFICATION_TYPES.VOLUNTEERING_APPLICATION_APPROVED
        : NOTIFICATION_TYPES.VOLUNTEERING_APPLICATION_REJECTED,
      title: approved ? 'Application approved' : 'Application not approved',
      message: approved
        ? `Your application for ${opportunity.title} was approved.`
        : `Your application for ${opportunity.title} was not approved.`,
      entityType: 'volunteering',
      entityId: opportunity.id,
      occurrenceKey: approved ? `approved:${userId}` : `rejected:${userId}`,
    })
  );

export const notifyVolunteeringCompleted = (opportunity, userIds) =>
  runNotificationSafely(() =>
    createBulkNotifications({
      userIds,
      type: NOTIFICATION_TYPES.VOLUNTEERING_COMPLETED,
      title: 'Volunteering completed',
      message: `Your participation in ${opportunity.title} is marked complete.`,
      entityType: 'volunteering',
      entityId: opportunity.id,
      occurrenceKey: 'completed',
    })
  );

export const notifyCommunityAnswered = (question, actorUserId) =>
  runNotificationSafely(() => {
    if (Number(question.user_id) === Number(actorUserId)) {
      return null;
    }
    return notifySpecificUser(question.user_id, {
      type: NOTIFICATION_TYPES.COMMUNITY_QUESTION_ANSWERED,
      title: 'Your question was answered',
      message: `Someone answered “${question.title}”.`,
      entityType: 'community_question',
      entityId: question.id,
      occurrenceKey: `answer:${Date.now()}`,
      skipDedupe: true,
    });
  });

export const notifyCommunityComment = ({ question, parentAuthorId, actorUserId }) =>
  runNotificationSafely(async () => {
    const recipients = new Set();
    if (question?.user_id && Number(question.user_id) !== Number(actorUserId)) {
      recipients.add(Number(question.user_id));
    }
    if (parentAuthorId && Number(parentAuthorId) !== Number(actorUserId)) {
      recipients.add(Number(parentAuthorId));
    }
    if (recipients.size === 0) {
      return null;
    }
    return createBulkNotifications({
      userIds: [...recipients],
      type: NOTIFICATION_TYPES.COMMUNITY_COMMENT,
      title: 'New comment on a discussion',
      message: `There is a new comment on “${question.title}”.`,
      entityType: 'community_question',
      entityId: question.id,
      occurrenceKey: `comment:${Date.now()}`,
      skipDedupe: true,
    });
  });

export const notifyCommunityModeration = (userId, title, questionId) =>
  runNotificationSafely(() =>
    notifySpecificUser(userId, {
      type: NOTIFICATION_TYPES.COMMUNITY_MODERATION,
      title: 'Community moderation update',
      message: title,
      entityType: 'community_question',
      entityId: questionId,
      occurrenceKey: `moderation:${Date.now()}`,
      skipDedupe: true,
    })
  );

export const notifyMeditationPublished = (meditation) =>
  runNotificationSafely(() =>
    processNotificationRules({
      notificationType: NOTIFICATION_TYPES.NEW_MEDITATION,
      entityType: 'meditation',
      entityId: meditation.id,
      vars: { title: meditation.title },
      occurrenceKey: 'published',
    })
  );

export const notifyNewCourse = (course) =>
  runNotificationSafely(() =>
    processNotificationRules({
      notificationType: NOTIFICATION_TYPES.NEW_COURSE,
      entityType: 'course',
      entityId: course.id,
      vars: { title: course.title },
      occurrenceKey: 'published',
    })
  );

export const notifyCampPublished = (camp) =>
  runNotificationSafely(() =>
    processNotificationRules({
      notificationType: NOTIFICATION_TYPES.NEW_CAMP,
      entityType: 'camp',
      entityId: camp.id,
      vars: { title: camp.title },
      occurrenceKey: 'published',
    })
  );

export const notifySupportTicketCreated = (ticket) =>
  runNotificationSafely(() =>
    notifyAudience('admins', {
      type: NOTIFICATION_TYPES.SUPPORT_TICKET_CREATED,
      title: 'New support request',
      message: `${ticket.ticket_number}: ${ticket.subject}`,
      entityType: 'support_ticket',
      entityId: ticket.id,
      occurrenceKey: `created:${ticket.id}`,
      skipDedupe: true,
    })
  );

export const notifySupportTicketReply = ({ ticket, actorRole, messageId }) =>
  runNotificationSafely(() => {
    if (actorRole === 'admin') {
      return notifySpecificUser(ticket.user_id, {
        type: NOTIFICATION_TYPES.SUPPORT_TICKET_REPLY,
        title: 'Support reply',
        message: `There is a new reply on ${ticket.ticket_number}.`,
        entityType: 'support_ticket',
        entityId: ticket.id,
        occurrenceKey: `reply:${messageId}`,
        skipDedupe: true,
      });
    }

    return notifyAudience('admins', {
      type: NOTIFICATION_TYPES.SUPPORT_TICKET_REPLY,
      title: 'Support request updated',
      message: `${ticket.ticket_number} has a new reply from the participant.`,
      entityType: 'support_ticket',
      entityId: ticket.id,
      occurrenceKey: `reply:${messageId}`,
      skipDedupe: true,
    });
  });

export const notifySupportStatusUpdated = (ticket, previousStatus) =>
  runNotificationSafely(() =>
    notifySpecificUser(ticket.user_id, {
      type: NOTIFICATION_TYPES.SUPPORT_TICKET_STATUS_UPDATED,
      title: 'Support request status updated',
      message: `${ticket.ticket_number} is now ${String(ticket.status).replaceAll('_', ' ')}.`,
      entityType: 'support_ticket',
      entityId: ticket.id,
      occurrenceKey: `status:${ticket.id}:${ticket.status}:${previousStatus || ''}`,
      skipDedupe: true,
    })
  );

export { CHANNEL_IN_APP, SOURCE_AUTOMATIC };
