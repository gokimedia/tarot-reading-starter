const LOCAL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const LOCAL_TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const IANA_TIMEZONE_PATTERN = /^(?:UTC|[A-Za-z_+-]+(?:\/[A-Za-z0-9_.+\-]+)+)$/;

function formatterFor(timezone) {
  try {
    return new Intl.DateTimeFormat('en-CA-u-ca-gregory-nu-latn', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
      timeZoneName: 'longOffset',
    });
  } catch {
    return null;
  }
}

function zonedParts(formatter, instant) {
  try {
    const parts = formatter.formatToParts(instant);
    const value = (type) => parts.find((part) => part.type === type)?.value || '';
    const offset = /^(?:GMT|UTC)(?:([+-])(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(value('timeZoneName'));
    if (!offset) return null;
    const offsetSeconds = offset[1]
      ? (offset[1] === '-' ? -1 : 1) * (
        Number.parseInt(offset[2], 10) * 3_600
        + Number.parseInt(offset[3], 10) * 60
        + Number.parseInt(offset[4] || '0', 10)
      )
      : 0;
    return {
      year: Number(value('year')),
      month: Number(value('month')),
      day: Number(value('day')),
      hour: Number(value('hour')),
      minute: Number(value('minute')),
      second: Number(value('second')),
      offsetSeconds,
    };
  } catch {
    return null;
  }
}

function resolverContext(date, timezone) {
  const dateMatch = LOCAL_DATE_PATTERN.exec(date);
  if (!dateMatch || !IANA_TIMEZONE_PATTERN.test(timezone)) return null;
  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const nominal = Date.UTC(year, month - 1, day, 12, 0, 0);
  if (!Number.isFinite(nominal) || new Date(nominal).toISOString().slice(0, 10) !== date) return null;
  const formatter = formatterFor(timezone);
  if (!formatter) return null;
  const offsets = new Set();
  for (let hours = -48; hours <= 48; hours += 1) {
    const parts = zonedParts(formatter, new Date(nominal + hours * 3_600_000));
    if (parts) offsets.add(parts.offsetSeconds);
  }
  return { year, month, day, formatter, offsets: [...offsets] };
}

function candidatesForMinute(context, hour, minute) {
  const nominal = Date.UTC(context.year, context.month - 1, context.day, hour, minute, 0);
  return context.offsets
    .map((offsetSeconds) => nominal - offsetSeconds * 1_000)
    .filter((candidate, index, values) => values.indexOf(candidate) === index)
    .filter((candidate) => {
      const parts = zonedParts(context.formatter, new Date(candidate));
      return Boolean(parts
        && parts.year === context.year
        && parts.month === context.month
        && parts.day === context.day
        && parts.hour === hour
        && parts.minute === minute
        && parts.second === 0);
    })
    .sort((left, right) => left - right)
    .map((candidate) => new Date(candidate).toISOString());
}

/**
 * Resolves an IANA civil time without guessing across daylight-saving gaps or
 * folds. Every returned UTC candidate must format back to the exact submitted
 * Gregorian date, hour and minute in the requested zone.
 *
 * @returns {{status:'nonexistent'|'unique'|'ambiguous', candidates:readonly string[]}|null}
 */
export function resolveIanaLocalDateTime(date, time, timezone) {
  const timeMatch = LOCAL_TIME_PATTERN.exec(time);
  const context = resolverContext(date, timezone);
  if (!timeMatch || !context) return null;
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  const candidates = candidatesForMinute(context, hour, minute);

  return Object.freeze({
    status: candidates.length === 0 ? 'nonexistent' : candidates.length === 1 ? 'unique' : 'ambiguous',
    candidates: Object.freeze(candidates),
  });
}

/**
 * Finds the real UTC bounds of a civil date. Midnight transitions are valid:
 * the first/last existing local minute is used, and only an entirely skipped
 * date is reported as nonexistent.
 */
export function resolveIanaLocalDateBounds(date, timezone) {
  const context = resolverContext(date, timezone);
  if (!context) return null;
  let first = null;
  for (let minuteOfDay = 0; minuteOfDay < 1_440; minuteOfDay += 1) {
    const candidates = candidatesForMinute(context, Math.floor(minuteOfDay / 60), minuteOfDay % 60);
    if (candidates.length) {
      first = { minuteOfDay, candidates };
      break;
    }
  }
  if (!first) {
    return Object.freeze({ status: 'nonexistent', start: null, end: null, startLocalTime: null, endLocalTime: null });
  }
  let last = first;
  for (let minuteOfDay = 1_439; minuteOfDay >= first.minuteOfDay; minuteOfDay -= 1) {
    const candidates = candidatesForMinute(context, Math.floor(minuteOfDay / 60), minuteOfDay % 60);
    if (candidates.length) {
      last = { minuteOfDay, candidates };
      break;
    }
  }
  const localTime = (minuteOfDay) => (
    `${String(Math.floor(minuteOfDay / 60)).padStart(2, '0')}:${String(minuteOfDay % 60).padStart(2, '0')}`
  );
  return Object.freeze({
    status: 'valid',
    start: first.candidates[0],
    end: last.candidates[last.candidates.length - 1],
    startLocalTime: localTime(first.minuteOfDay),
    endLocalTime: localTime(last.minuteOfDay),
  });
}

export function uniqueIanaLocalInstant(date, time, timezone) {
  const resolution = resolveIanaLocalDateTime(date, time, timezone);
  return resolution?.status === 'unique' ? new Date(resolution.candidates[0]) : null;
}
