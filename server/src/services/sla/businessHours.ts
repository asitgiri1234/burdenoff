import { DateTime } from 'luxon';

/**
 * Everything the business-hours maths needs, passed in explicitly.
 *
 * This module is deliberately pure: no Prisma, no environment access and no
 * `Date.now()`. Callers supply the clock and the holiday list, which makes
 * every rule below testable with fixed, hand-computed dates.
 */
export interface BusinessHoursContext {
  /** IANA zone the business operates in, e.g. `Asia/Kolkata`. */
  readonly timezone: string;
  /** Hour the working day opens, in `timezone`. */
  readonly startHour: number;
  /** Hour the working day closes, in `timezone`. */
  readonly endHour: number;
  /** Holiday calendar dates as `yyyy-MM-dd`, expressed in `timezone`. */
  readonly holidays: ReadonlySet<string>;
}

/**
 * Upper bound on how many calendar days a single walk may cross before we
 * declare the calculation broken. 400 days is far beyond any real SLA budget,
 * so hitting it means a malformed context (e.g. every day marked a holiday)
 * rather than a legitimately long deadline.
 */
const MAX_DAY_ITERATIONS = 400;

/** Same guard for range scans, which may legitimately span longer periods. */
const MAX_SPAN_DAY_ITERATIONS = 4000;

/**
 * Reads an instant in the business timezone.
 *
 * Fails fast on an unknown IANA zone: Luxon would otherwise return an invalid
 * DateTime and every downstream calculation would silently produce garbage.
 */
function zoned(date: Date, ctx: BusinessHoursContext): DateTime {
  const dt = DateTime.fromJSDate(date, { zone: ctx.timezone });
  if (!dt.isValid) {
    throw new RangeError(
      `Invalid business-hours context for ${date.toISOString()}: ${dt.invalidReason ?? 'unknown reason'} ` +
        `(timezone "${ctx.timezone}")`,
    );
  }
  return dt;
}

/** Calendar-day key used to look holidays up. */
function dayKey(dt: DateTime): string {
  return dt.toFormat('yyyy-MM-dd');
}

function isBusinessDayInZone(dt: DateTime, ctx: BusinessHoursContext): boolean {
  // Luxon weekdays: 1 = Monday … 6 = Saturday, 7 = Sunday.
  if (dt.weekday > 5) return false;
  return !ctx.holidays.has(dayKey(dt));
}

/**
 * The `[open, close)` working window for the calendar day `dt` falls on.
 *
 * Built by adding hours to the start of the day rather than with `set({ hour })`
 * so that an `endHour` of 24 (midnight close) stays representable.
 */
function windowFor(
  dt: DateTime,
  ctx: BusinessHoursContext,
): { open: DateTime; close: DateTime } {
  const midnight = dt.startOf('day');
  return {
    open: midnight.plus({ hours: ctx.startHour }),
    close: midnight.plus({ hours: ctx.endHour }),
  };
}

/** Opening moment of the calendar day after `dt`. */
function nextDayOpen(dt: DateTime, ctx: BusinessHoursContext): DateTime {
  return dt.startOf('day').plus({ days: 1 }).startOf('day').plus({ hours: ctx.startHour });
}

/** True when `date` falls on a weekday that is not a configured holiday. */
export function isBusinessDay(date: Date, ctx: BusinessHoursContext): boolean {
  return isBusinessDayInZone(zoned(date, ctx), ctx);
}

/**
 * Adds `minutes` of *business* time to `start`.
 *
 * Anchoring: if `start` sits outside a working window the clock does not begin
 * until the next opening. Mon 07:00 counts from Mon 09:00; Mon 20:00 from
 * Tue 09:00; Saturday from Monday 09:00.
 *
 * Works by walking whole day-windows and subtracting each window's capacity,
 * so cost is proportional to the number of days crossed rather than to the
 * number of minutes added.
 */
export function addBusinessMinutes(
  start: Date,
  minutes: number,
  ctx: BusinessHoursContext,
): Date {
  if (!Number.isFinite(minutes) || minutes < 0) {
    throw new RangeError(`addBusinessMinutes: minutes must be a non-negative number, got ${minutes}`);
  }

  let cursor: DateTime = zoned(start, ctx);
  let remaining = minutes;

  for (let iteration = 0; iteration <= MAX_DAY_ITERATIONS; iteration += 1) {
    if (!isBusinessDayInZone(cursor, ctx)) {
      cursor = nextDayOpen(cursor, ctx);
      continue;
    }

    const { open, close } = windowFor(cursor, ctx);

    // Before opening: jump forward to the open. At or after closing: next day.
    if (cursor.toMillis() < open.toMillis()) {
      cursor = open;
    } else if (cursor.toMillis() >= close.toMillis()) {
      cursor = nextDayOpen(cursor, ctx);
      continue;
    }

    const available = (close.toMillis() - cursor.toMillis()) / 60_000;
    if (remaining <= available) {
      return cursor.plus({ minutes: remaining }).toJSDate();
    }

    remaining -= available;
    cursor = nextDayOpen(cursor, ctx);
  }

  throw new Error(
    `addBusinessMinutes: exceeded ${MAX_DAY_ITERATIONS} day iterations adding ${minutes} minutes from ${start.toISOString()}. ` +
      'Check the business-hours context — every day may be marked non-working.',
  );
}

/**
 * Business minutes elapsed between two instants, ignoring nights, weekends and
 * holidays. Returns 0 when `to` is at or before `from`.
 */
export function businessMinutesBetween(
  from: Date,
  to: Date,
  ctx: BusinessHoursContext,
): number {
  const start = zoned(from, ctx);
  const end = zoned(to, ctx);

  if (end.toMillis() <= start.toMillis()) return 0;

  const endMs = end.toMillis();
  let totalMs = 0;
  let day: DateTime = start.startOf('day');

  for (let iteration = 0; iteration <= MAX_SPAN_DAY_ITERATIONS; iteration += 1) {
    if (day.toMillis() >= endMs) {
      // Accumulated in milliseconds to keep the sum exact, floored at the end.
      return Math.floor(totalMs / 60_000);
    }

    if (isBusinessDayInZone(day, ctx)) {
      const { open, close } = windowFor(day, ctx);
      const lo = Math.max(open.toMillis(), start.toMillis());
      const hi = Math.min(close.toMillis(), endMs);
      if (hi > lo) totalMs += hi - lo;
    }

    day = day.plus({ days: 1 }).startOf('day');
  }

  throw new Error(
    `businessMinutesBetween: exceeded ${MAX_SPAN_DAY_ITERATIONS} day iterations between ` +
      `${from.toISOString()} and ${to.toISOString()}.`,
  );
}
