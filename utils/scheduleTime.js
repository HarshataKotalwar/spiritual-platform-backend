const pad = (value) => String(value).padStart(2, '0');

export const parseDateParts = (eventDate) => {
  const [year, month, day] = String(eventDate || '')
    .slice(0, 10)
    .split('-')
    .map(Number);

  return { year, month, day };
};

export const parseTimeParts = (timeValue) => {
  const text = String(timeValue || '');
  const isoMatch = text.match(/T(\d{2}):(\d{2})(?::(\d{2}))?/);
  const wallMatch = text.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  const match = isoMatch || wallMatch;

  if (!match) {
    return { hours: 0, minutes: 0, seconds: 0 };
  }

  return {
    hours: Number(match[1]) || 0,
    minutes: Number(match[2]) || 0,
    seconds: Number(match[3] || 0) || 0,
  };
};

export const localDateTime = (eventDate, timeValue) => {
  const { year, month, day } = parseDateParts(eventDate);
  const { hours, minutes, seconds } = parseTimeParts(timeValue);
  return new Date(year, month - 1, day, hours, minutes, seconds);
};

export const normalizeDate = (value) => String(value || '').slice(0, 10);

export const normalizeTime = (value) => {
  const { hours, minutes, seconds } = parseTimeParts(value);
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
};

export const sameDate = (left, right) => normalizeDate(left) === normalizeDate(right);

export const sameTime = (left, right) => normalizeTime(left) === normalizeTime(right);

export const sameNullableText = (left, right) =>
  String(left || '').trim() === String(right || '').trim();

export const sameNullableNumber = (left, right) => {
  const leftEmpty = left === null || left === undefined || left === '';
  const rightEmpty = right === null || right === undefined || right === '';

  if (leftEmpty && rightEmpty) {
    return true;
  }

  return Number(left) === Number(right);
};

export const hasScheduleStarted = (eventDate, startTime, now = new Date()) => {
  return now.getTime() >= localDateTime(eventDate, startTime).getTime();
};
