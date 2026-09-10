import {
  hasScheduleStarted,
  sameDate,
  sameNullableNumber,
  sameNullableText,
  sameTime,
} from '../utils/scheduleTime.js';

export const parseId = (value) => {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    return null;
  }
  return id;
};

export const OPPORTUNITY_STATUSES = [
  'draft',
  'published',
  'closed',
  'completed',
  'cancelled',
];

export const ACTIVE_APPLICATION_STATUSES = ['applied', 'approved'];
export const APPROVED_CAPACITY_STATUSES = ['approved', 'completed'];

export const isOpportunityCoreLocked = (opportunity, now = new Date()) => {
  if (opportunity.status === 'draft') {
    return false;
  }

  if (opportunity.status === 'cancelled' || opportunity.status === 'completed') {
    return true;
  }

  return hasScheduleStarted(opportunity.event_date, opportunity.start_time, now);
};

export const opportunityCoreFieldsChanged = (current, next) => {
  return (
    current.volunteer_type !== next.volunteer_type ||
    !sameDate(current.event_date, next.event_date) ||
    !sameTime(current.start_time, next.start_time) ||
    !sameTime(current.end_time, next.end_time) ||
    !sameNullableText(current.location, next.location) ||
    !sameNullableText(current.meeting_url, next.meeting_url) ||
    !sameNullableNumber(current.capacity, next.capacity)
  );
};

export const opportunitySelect = `
  o.id,
  o.title,
  o.description,
  o.category,
  o.banner_url,
  o.volunteer_type,
  o.event_date::text AS event_date,
  o.start_time::text AS start_time,
  o.end_time::text AS end_time,
  o.location,
  o.meeting_url,
  o.capacity,
  o.requirements,
  o.status,
  o.created_by,
  o.created_at,
  o.updated_at
`;

export const opportunityReturning = `
  id,
  title,
  description,
  category,
  banner_url,
  volunteer_type,
  event_date::text AS event_date,
  start_time::text AS start_time,
  end_time::text AS end_time,
  location,
  meeting_url,
  capacity,
  requirements,
  status,
  created_by,
  created_at,
  updated_at
`;

export const occupiedCountQuery = `
  SELECT COUNT(*)::integer AS occupied
  FROM volunteer_applications
  WHERE opportunity_id = $1
    AND status = ANY($2::varchar[])
`;

export const validateOpportunityBody = (body) => {
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const description =
    typeof body.description === 'string' ? body.description.trim() : '';
  const volunteerType = body.volunteer_type;
  const eventDate =
    typeof body.event_date === 'string' ? body.event_date.slice(0, 10) : '';
  const normalizeTime = (value) => {
    const parts = value.split(':');
    if (parts.length < 2) {
      return '';
    }

    const hours = parts[0].padStart(2, '0');
    const minutes = parts[1].padStart(2, '0');
    const seconds = (parts[2] || '00').padStart(2, '0');
    return `${hours}:${minutes}:${seconds}`;
  };

  const startTime =
    typeof body.start_time === 'string' ? normalizeTime(body.start_time) : '';
  const endTime =
    typeof body.end_time === 'string' ? normalizeTime(body.end_time) : '';
  const status = body.status || 'draft';
  const category =
    typeof body.category === 'string' ? body.category.trim() : '';
  const bannerUrl =
    typeof body.banner_url === 'string' ? body.banner_url.trim() : '';
  const location =
    typeof body.location === 'string' ? body.location.trim() : '';
  const meetingUrl =
    typeof body.meeting_url === 'string' ? body.meeting_url.trim() : '';
  const requirements =
    typeof body.requirements === 'string' ? body.requirements.trim() : '';

  if (!title || !description || !volunteerType || !eventDate || !startTime || !endTime) {
    return {
      error: 'Title, description, type, date, start time, and end time are required.',
    };
  }

  if (!['online', 'offline'].includes(volunteerType)) {
    return { error: 'Volunteer type must be online or offline.' };
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) {
    return { error: 'Date must be YYYY-MM-DD.' };
  }

  if (!OPPORTUNITY_STATUSES.includes(status)) {
    return { error: 'Invalid opportunity status.' };
  }

  if (startTime >= endTime) {
    return { error: 'End time must be after start time.' };
  }

  if (volunteerType === 'online' && !meetingUrl) {
    return { error: 'Meeting URL is required for online opportunities.' };
  }

  if (volunteerType === 'offline' && !location) {
    return { error: 'Location is required for offline opportunities.' };
  }

  let capacity = null;
  if (body.capacity !== undefined && body.capacity !== null && body.capacity !== '') {
    capacity = Number(body.capacity);
    if (!Number.isInteger(capacity) || capacity <= 0) {
      return { error: 'Capacity must be a positive whole number.' };
    }
  }

  return {
    data: {
      title,
      description,
      category: category || null,
      banner_url: bannerUrl || null,
      volunteer_type: volunteerType,
      event_date: eventDate,
      start_time: startTime,
      end_time: endTime,
      location: volunteerType === 'offline' ? location : null,
      meeting_url: volunteerType === 'online' ? meetingUrl : null,
      capacity,
      requirements: requirements || null,
      status,
    },
  };
};

export const publicOpportunity = (row, { includeMeeting = false } = {}) => {
  const occupied = Number(row.occupied ?? row.application_count ?? 0);
  const remaining =
    row.capacity === null || row.capacity === undefined
      ? null
      : Math.max(row.capacity - occupied, 0);

  return {
    ...row,
    occupied,
    remaining,
    is_full: row.capacity !== null && remaining === 0,
    meeting_url: includeMeeting ? row.meeting_url : null,
  };
};

export const certificateStatusFor = ({ applicationStatus, attendanceStatus, issued }) => {
  if (issued) {
    return 'available';
  }

  if (
    applicationStatus === 'completed' &&
    (attendanceStatus === 'present' || attendanceStatus === 'partial')
  ) {
    return 'pending';
  }

  return 'not_available';
};
