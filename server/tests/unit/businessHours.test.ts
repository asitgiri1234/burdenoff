import { describe, expect, it } from 'bun:test';
import { DateTime } from 'luxon';
import {
  addBusinessMinutes,
  businessMinutesBetween,
  isBusinessDay,
  type BusinessHoursContext,
} from '../../src/services/sla/index.ts';
import {
  BUSINESS_TIMEZONE,
  ctxWith,
  FRIDAY,
  fmt,
  ist,
  MONDAY,
  NEXT_MONDAY,
  NEXT_TUESDAY,
  NEXT_WEDNESDAY,
  SATURDAY,
  SUNDAY,
  TUESDAY,
} from './fixtures.ts';

const ctx = ctxWith();

describe('reference week', () => {
  // Guards the whole suite: every expectation below is hand-computed from these
  // weekdays, so if the calendar assumption is wrong the failure should surface
  // here rather than as a confusing off-by-a-day somewhere else.
  it('has the weekdays the fixtures claim', () => {
    const weekdayOf = (date: string): string =>
      DateTime.fromISO(date, { zone: BUSINESS_TIMEZONE }).toFormat('cccc');

    expect(weekdayOf(MONDAY)).toBe('Monday');
    expect(weekdayOf(FRIDAY)).toBe('Friday');
    expect(weekdayOf(SATURDAY)).toBe('Saturday');
    expect(weekdayOf(SUNDAY)).toBe('Sunday');
    expect(weekdayOf(NEXT_MONDAY)).toBe('Monday');
  });
});

describe('isBusinessDay', () => {
  it('accepts a plain weekday', () => {
    expect(isBusinessDay(ist(`${MONDAY} 10:00`), ctx)).toBe(true);
  });

  it('rejects Saturday and Sunday', () => {
    expect(isBusinessDay(ist(`${SATURDAY} 10:00`), ctx)).toBe(false);
    expect(isBusinessDay(ist(`${SUNDAY} 10:00`), ctx)).toBe(false);
  });

  it('rejects a configured holiday', () => {
    expect(isBusinessDay(ist(`${NEXT_MONDAY} 10:00`), ctxWith([NEXT_MONDAY]))).toBe(false);
  });

  it('is unaffected by a holiday on a different day', () => {
    expect(isBusinessDay(ist(`${MONDAY} 10:00`), ctxWith([NEXT_MONDAY]))).toBe(true);
  });
});

describe('addBusinessMinutes', () => {
  it('adds within a single working day', () => {
    // Mon 10:00 + 4 business hours -> Mon 14:00
    expect(fmt(addBusinessMinutes(ist(`${MONDAY} 10:00`), 4 * 60, ctx))).toBe(
      `${MONDAY} 14:00`,
    );
  });

  it('anchors a start before opening to the same day 09:00', () => {
    // Mon 07:00 is outside hours, so the clock starts at Mon 09:00.
    expect(fmt(addBusinessMinutes(ist(`${MONDAY} 07:00`), 60, ctx))).toBe(
      `${MONDAY} 10:00`,
    );
  });

  it('anchors a start after closing to the next day 09:00', () => {
    // Mon 20:00 -> Tue 09:00
    expect(fmt(addBusinessMinutes(ist(`${MONDAY} 20:00`), 60, ctx))).toBe(
      `${TUESDAY} 10:00`,
    );
  });

  it('anchors a weekend start to Monday 09:00', () => {
    // Sat 12:00 -> Mon 09:00
    expect(fmt(addBusinessMinutes(ist(`${SATURDAY} 12:00`), 60, ctx))).toBe(
      `${NEXT_MONDAY} 10:00`,
    );
  });

  it('splits a budget across Friday evening and Monday morning', () => {
    // Fri 17:59 + 2h: 1 minute counts on Friday, the other 119 roll to Mon 09:00.
    expect(fmt(addBusinessMinutes(ist(`${FRIDAY} 17:59`), 2 * 60, ctx))).toBe(
      `${NEXT_MONDAY} 10:59`,
    );
  });

  it('skips a Monday holiday (worked example: Fri 17:00 + 4h -> Tue 12:00)', () => {
    // Friday contributes 1h, the weekend and the Monday holiday contribute
    // nothing, and the remaining 3h land on Tuesday morning.
    const holidayCtx = ctxWith([NEXT_MONDAY]);
    expect(fmt(addBusinessMinutes(ist(`${FRIDAY} 17:00`), 4 * 60, holidayCtx))).toBe(
      `${NEXT_TUESDAY} 12:00`,
    );
  });

  it('skips a weekend followed by two consecutive holidays', () => {
    // Fri 16:00 + 3h: 2h on Friday, then Sat/Sun/Mon/Tue are all non-working,
    // so the final hour lands on Wednesday morning.
    const holidayCtx = ctxWith([NEXT_MONDAY, NEXT_TUESDAY]);
    expect(fmt(addBusinessMinutes(ist(`${FRIDAY} 16:00`), 3 * 60, holidayCtx))).toBe(
      `${NEXT_WEDNESDAY} 10:00`,
    );
  });

  it('spans multiple business days for a 72-hour budget', () => {
    // 72 business hours = 8 full 9-hour days. Starting Mon 09:00, the eighth
    // working day is Wed 2026-03-11 and the budget ends exactly at close.
    expect(fmt(addBusinessMinutes(ist(`${MONDAY} 09:00`), 72 * 60, ctx))).toBe(
      `${NEXT_WEDNESDAY} 18:00`,
    );
  });

  it('rolls over at the exact end-of-day boundary', () => {
    // Mon 17:00 + 2h: 1h before close, then the remainder from Tue 09:00.
    expect(fmt(addBusinessMinutes(ist(`${MONDAY} 17:00`), 2 * 60, ctx))).toBe(
      `${TUESDAY} 10:00`,
    );
  });

  it('treats the closing instant as outside the window', () => {
    // 18:00 is the exclusive end of the window, so it behaves like after-hours.
    expect(fmt(addBusinessMinutes(ist(`${MONDAY} 18:00`), 60, ctx))).toBe(
      `${TUESDAY} 10:00`,
    );
  });

  it('treats the opening instant as inside the window', () => {
    expect(fmt(addBusinessMinutes(ist(`${MONDAY} 09:00`), 60, ctx))).toBe(
      `${MONDAY} 10:00`,
    );
  });

  it('anchors without advancing when adding zero minutes', () => {
    expect(fmt(addBusinessMinutes(ist(`${MONDAY} 10:00`), 0, ctx))).toBe(
      `${MONDAY} 10:00`,
    );
    expect(fmt(addBusinessMinutes(ist(`${SATURDAY} 12:00`), 0, ctx))).toBe(
      `${NEXT_MONDAY} 09:00`,
    );
  });

  it('rejects a negative budget', () => {
    expect(() => addBusinessMinutes(ist(`${MONDAY} 10:00`), -1, ctx)).toThrow(RangeError);
  });

  it('throws a clear error rather than looping when no window ever opens', () => {
    // A zero-length working day means no minute is ever consumable. The guard
    // must fire instead of walking the calendar forever.
    const zeroLengthDay: BusinessHoursContext = {
      timezone: BUSINESS_TIMEZONE,
      startHour: 9,
      endHour: 9,
      holidays: new Set<string>(),
    };
    expect(() => addBusinessMinutes(ist(`${MONDAY} 10:00`), 60, zeroLengthDay)).toThrow(
      /exceeded 400 day iterations/,
    );
  });
});

describe('businessMinutesBetween', () => {
  it('returns 0 when the range is empty or inverted', () => {
    expect(businessMinutesBetween(ist(`${MONDAY} 10:00`), ist(`${MONDAY} 10:00`), ctx)).toBe(0);
    expect(businessMinutesBetween(ist(`${MONDAY} 14:00`), ist(`${MONDAY} 10:00`), ctx)).toBe(0);
  });

  it('counts a plain within-day range', () => {
    expect(businessMinutesBetween(ist(`${MONDAY} 10:00`), ist(`${MONDAY} 14:30`), ctx)).toBe(270);
  });

  it('ignores time outside the working window', () => {
    // 07:00 -> 20:00 spans the whole day, but only 09:00-18:00 counts.
    expect(businessMinutesBetween(ist(`${MONDAY} 07:00`), ist(`${MONDAY} 20:00`), ctx)).toBe(540);
  });

  it('counts across a weekend', () => {
    // Fri 17:00 -> Mon 10:00 = 1h Friday + 1h Monday; the weekend contributes 0.
    expect(
      businessMinutesBetween(ist(`${FRIDAY} 17:00`), ist(`${NEXT_MONDAY} 10:00`), ctx),
    ).toBe(120);
  });

  it('counts across a holiday', () => {
    // Same shape, but Monday is a holiday so the second hour falls on Tuesday.
    const holidayCtx = ctxWith([NEXT_MONDAY]);
    expect(
      businessMinutesBetween(ist(`${FRIDAY} 17:00`), ist(`${NEXT_TUESDAY} 10:00`), holidayCtx),
    ).toBe(120);
  });

  it('returns 0 for a range entirely inside a weekend', () => {
    expect(businessMinutesBetween(ist(`${SATURDAY} 09:00`), ist(`${SUNDAY} 18:00`), ctx)).toBe(0);
  });

  it('round-trips against addBusinessMinutes', () => {
    const start = ist(`${FRIDAY} 16:30`);
    const end = addBusinessMinutes(start, 500, ctx);
    expect(businessMinutesBetween(start, end, ctx)).toBe(500);
  });
});

describe('context validation', () => {
  it('throws on an unknown timezone instead of producing invalid dates', () => {
    const badZone: BusinessHoursContext = {
      timezone: 'Mars/Olympus_Mons',
      startHour: 9,
      endHour: 18,
      holidays: new Set<string>(),
    };
    expect(() => addBusinessMinutes(ist(`${MONDAY} 10:00`), 60, badZone)).toThrow(RangeError);
    expect(() => isBusinessDay(ist(`${MONDAY} 10:00`), badZone)).toThrow(/Mars\/Olympus_Mons/);
  });
});
