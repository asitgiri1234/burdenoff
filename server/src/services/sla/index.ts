import { DateTime } from 'luxon';
import type { BusinessHoursContext } from './businessHours.ts';

export {
  addBusinessMinutes,
  businessMinutesBetween,
  isBusinessDay,
  type BusinessHoursContext,
} from './businessHours.ts';

export {
  SLA_POLICIES,
  getPolicy,
  type Priority,
  type SlaPolicy,
} from './slaPolicy.ts';

export {
  computeSlaTimestamps,
  remainingBusinessMinutes,
  resolveSlaState,
  type ResolveSlaStateArgs,
  type SlaState,
  type SlaTimestamps,
} from './slaCalculator.ts';

export interface BusinessHoursConfig {
  readonly timezone: string;
  readonly startHour: number;
  readonly endHour: number;
}

/**
 * Turns Holiday rows into the context the pure calculator expects.
 *
 * Holiday dates come from a Postgres `DATE` column, which the driver
 * materialises as midnight **UTC**. The calendar date is therefore read in UTC
 * rather than in the business timezone — converting midnight UTC into a zone
 * behind UTC would silently shift the holiday to the previous day.
 */
export function buildBusinessHoursContext(
  holidayDates: readonly Date[],
  config: BusinessHoursConfig,
): BusinessHoursContext {
  const holidays = new Set<string>(
    holidayDates.map((date) =>
      DateTime.fromJSDate(date, { zone: 'utc' }).toFormat('yyyy-MM-dd'),
    ),
  );

  return Object.freeze({
    timezone: config.timezone,
    startHour: config.startHour,
    endHour: config.endHour,
    holidays,
  });
}
