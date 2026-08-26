import { DateTime } from 'luxon';
import {
  buildBusinessHoursContext,
  type BusinessHoursContext,
} from '../../src/services/sla/index.ts';

export const BUSINESS_TIMEZONE = 'Asia/Kolkata';
export const BUSINESS_START_HOUR = 9;
export const BUSINESS_END_HOUR = 18;

/**
 * Builds a Date from a `yyyy-MM-dd HH:mm` literal read in the business
 * timezone, so tests can be written in the terms the rules are stated in
 * ("Friday 17:59") rather than in UTC offsets.
 */
export function ist(literal: string): Date {
  const dt = DateTime.fromFormat(literal, 'yyyy-MM-dd HH:mm', {
    zone: BUSINESS_TIMEZONE,
  });
  if (!dt.isValid) {
    throw new Error(`ist(): invalid literal "${literal}" — ${dt.invalidReason}`);
  }
  return dt.toJSDate();
}

/** Renders a Date back into the business timezone for readable assertions. */
export function fmt(date: Date): string {
  return DateTime.fromJSDate(date, { zone: BUSINESS_TIMEZONE }).toFormat(
    'yyyy-MM-dd HH:mm',
  );
}

/** A holiday Date exactly as Prisma materialises a Postgres DATE: midnight UTC. */
export function holidayDate(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00.000Z`);
}

/** Business-hours context for the standard Mon–Fri 09:00–18:00 IST week. */
export function ctxWith(holidays: readonly string[] = []): BusinessHoursContext {
  return buildBusinessHoursContext(holidays.map(holidayDate), {
    timezone: BUSINESS_TIMEZONE,
    startHour: BUSINESS_START_HOUR,
    endHour: BUSINESS_END_HOUR,
  });
}

/**
 * Reference week used across the suite, chosen so the weekday of every date is
 * unambiguous when reading a test:
 *
 *   Mon 2026-03-02 … Fri 2026-03-06, Sat 2026-03-07, Sun 2026-03-08,
 *   Mon 2026-03-09 … Thu 2026-03-12
 */
export const MONDAY = '2026-03-02';
export const TUESDAY = '2026-03-03';
export const WEDNESDAY = '2026-03-04';
export const THURSDAY = '2026-03-05';
export const FRIDAY = '2026-03-06';
export const SATURDAY = '2026-03-07';
export const SUNDAY = '2026-03-08';
export const NEXT_MONDAY = '2026-03-09';
export const NEXT_TUESDAY = '2026-03-10';
export const NEXT_WEDNESDAY = '2026-03-11';
export const NEXT_THURSDAY = '2026-03-12';
