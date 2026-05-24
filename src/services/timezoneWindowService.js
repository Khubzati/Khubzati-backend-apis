const DEFAULT_TIMEZONE = String(process.env.KPI_TIMEZONE || process.env.APP_TIMEZONE || 'Asia/Amman');

const buildDateFormatter = (timeZone) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

const buildDateTimeFormatter = (timeZone) =>
  new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

const normalizeDateKey = (input) => {
  if (input instanceof Date) {
    return input.toISOString().slice(0, 10);
  }

  const str = String(input || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    throw new Error('Expected date string in YYYY-MM-DD format');
  }
  return str;
};

const toTimeZoneDateKey = (date, timeZone = DEFAULT_TIMEZONE) => {
  return buildDateFormatter(timeZone).format(date);
};

const parseDateKey = (dateKey) => {
  const [year, month, day] = normalizeDateKey(dateKey).split('-').map((part) => Number(part));
  return { year, month, day };
};

const toUtcInstantForLocalTime = ({ year, month, day, hour = 0, minute = 0, second = 0 }, timeZone) => {
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  const parts = buildDateTimeFormatter(timeZone)
    .formatToParts(utcGuess)
    .reduce((acc, part) => {
      if (part.type !== 'literal') acc[part.type] = Number(part.value);
      return acc;
    }, {});

  const mappedUtc = Date.UTC(
    parts.year,
    (parts.month || 1) - 1,
    parts.day || 1,
    parts.hour || 0,
    parts.minute || 0,
    parts.second || 0,
  );
  const offsetMs = mappedUtc - utcGuess.getTime();
  return new Date(utcGuess.getTime() - offsetMs);
};

const getUtcDayWindowForDateKey = (dateKey, timeZone = DEFAULT_TIMEZONE) => {
  const parsed = parseDateKey(dateKey);
  const startUtc = toUtcInstantForLocalTime(parsed, timeZone);

  const startPlus36h = new Date(startUtc.getTime() + 36 * 60 * 60 * 1000);
  const nextDateKey = toTimeZoneDateKey(startPlus36h, timeZone);
  const nextParsed = parseDateKey(nextDateKey);
  const endUtc = toUtcInstantForLocalTime(nextParsed, timeZone);

  return { dateKey, startUtc, endUtc };
};

const getUtcDayWindowForDate = (date, timeZone = DEFAULT_TIMEZONE) => {
  const dateKey = toTimeZoneDateKey(date, timeZone);
  return getUtcDayWindowForDateKey(dateKey, timeZone);
};

const enumerateDateKeys = (fromDateKey, toDateKey) => {
  const out = [];
  const start = new Date(`${normalizeDateKey(fromDateKey)}T00:00:00.000Z`);
  const end = new Date(`${normalizeDateKey(toDateKey)}T00:00:00.000Z`);
  if (start > end) throw new Error('fromDate must be <= toDate');

  const cursor = new Date(start);
  while (cursor <= end) {
    out.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
};

module.exports = {
  DEFAULT_TIMEZONE,
  normalizeDateKey,
  toTimeZoneDateKey,
  getUtcDayWindowForDate,
  getUtcDayWindowForDateKey,
  enumerateDateKeys,
};
