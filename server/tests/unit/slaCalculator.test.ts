import { describe, expect, it } from 'bun:test';
import {
  computeSlaTimestamps,
  getPolicy,
  remainingBusinessMinutes,
  resolveSlaState,
  SLA_POLICIES,
  type Priority,
} from '../../src/services/sla/index.ts';
import {
  ctxWith,
  FRIDAY,
  fmt,
  ist,
  MONDAY,
  NEXT_MONDAY,
  NEXT_THURSDAY,
  NEXT_WEDNESDAY,
  TUESDAY,
  WEDNESDAY,
} from './fixtures.ts';

const ctx = ctxWith();

describe('SLA_POLICIES', () => {
  it('stores every budget in business minutes', () => {
    expect(SLA_POLICIES).toEqual({
      URGENT: { firstResponseMinutes: 60, resolutionMinutes: 240 },
      HIGH: { firstResponseMinutes: 240, resolutionMinutes: 1440 },
      MEDIUM: { firstResponseMinutes: 480, resolutionMinutes: 2880 },
      LOW: { firstResponseMinutes: 1440, resolutionMinutes: 4320 },
    });
  });

  it('exposes each policy through getPolicy', () => {
    expect(getPolicy('URGENT').firstResponseMinutes).toBe(60);
    expect(getPolicy('LOW').resolutionMinutes).toBe(4320);
  });

  it('rejects an unknown priority', () => {
    expect(() => getPolicy('WHENEVER' as Priority)).toThrow(RangeError);
  });
});

describe('computeSlaTimestamps', () => {
  // All expectations below start from Mon 2026-03-02 10:00 IST and are computed
  // by hand against a Mon-Fri 09:00-18:00 (9h/day) week with no holidays.
  const createdAt = ist(`${MONDAY} 10:00`);

  it('URGENT: 1h first response, 4h resolution', () => {
    const sla = computeSlaTimestamps(createdAt, 'URGENT', ctx);
    expect(fmt(sla.firstResponseDueAt)).toBe(`${MONDAY} 11:00`);
    expect(fmt(sla.resolutionDueAt)).toBe(`${MONDAY} 14:00`);
  });

  it('HIGH: 4h first response, 24h resolution', () => {
    // 24 business hours from Mon 10:00: 8h Mon + 9h Tue + 7h Wed -> Wed 16:00.
    const sla = computeSlaTimestamps(createdAt, 'HIGH', ctx);
    expect(fmt(sla.firstResponseDueAt)).toBe(`${MONDAY} 14:00`);
    expect(fmt(sla.resolutionDueAt)).toBe(`${WEDNESDAY} 16:00`);
  });

  it('MEDIUM: 8h first response, 48h resolution', () => {
    // 8h from Mon 10:00 lands exactly at Monday close.
    // 48h: 8 Mon + 9 Tue + 9 Wed + 9 Thu + 9 Fri = 44, leaving 4h on Mon 03-09.
    const sla = computeSlaTimestamps(createdAt, 'MEDIUM', ctx);
    expect(fmt(sla.firstResponseDueAt)).toBe(`${MONDAY} 18:00`);
    expect(fmt(sla.resolutionDueAt)).toBe(`${NEXT_MONDAY} 13:00`);
  });

  it('LOW: 24h first response, 72h resolution', () => {
    // 72h: 8 Mon + 9x7 working days = 71 through Wed 03-11, leaving 1h Thu.
    const sla = computeSlaTimestamps(createdAt, 'LOW', ctx);
    expect(fmt(sla.firstResponseDueAt)).toBe(`${WEDNESDAY} 16:00`);
    expect(fmt(sla.resolutionDueAt)).toBe(`${NEXT_THURSDAY} 10:00`);
  });

  it('places at-risk marks at 75% of the budget', () => {
    // URGENT: floor(60 * 0.75) = 45min -> Mon 10:45
    //         floor(240 * 0.75) = 180min -> Mon 13:00
    const sla = computeSlaTimestamps(createdAt, 'URGENT', ctx);
    expect(fmt(sla.firstResponseAtRiskAt)).toBe(`${MONDAY} 10:45`);
    expect(fmt(sla.resolutionAtRiskAt)).toBe(`${MONDAY} 13:00`);
  });

  it('keeps at-risk marks strictly before their deadlines for every priority', () => {
    const priorities: Priority[] = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];
    for (const priority of priorities) {
      const sla = computeSlaTimestamps(createdAt, priority, ctx);
      expect(sla.firstResponseAtRiskAt.getTime()).toBeLessThan(sla.firstResponseDueAt.getTime());
      expect(sla.resolutionAtRiskAt.getTime()).toBeLessThan(sla.resolutionDueAt.getTime());
    }
  });

  it('anchors an out-of-hours creation before applying the budget', () => {
    // Created Friday night -> the clock only starts Monday 09:00.
    const sla = computeSlaTimestamps(ist(`${FRIDAY} 22:00`), 'URGENT', ctx);
    expect(fmt(sla.firstResponseDueAt)).toBe(`${NEXT_MONDAY} 10:00`);
  });

  it('pushes deadlines past a holiday', () => {
    // Same URGENT ticket, but Monday 03-09 is a public holiday.
    const holidayCtx = ctxWith([NEXT_MONDAY]);
    const sla = computeSlaTimestamps(ist(`${FRIDAY} 22:00`), 'URGENT', holidayCtx);
    expect(fmt(sla.firstResponseDueAt)).toBe(`2026-03-10 10:00`);
  });
});

describe('resolveSlaState', () => {
  const atRiskAt = ist(`${MONDAY} 15:00`);
  const dueAt = ist(`${MONDAY} 16:00`);

  it('is ON_TRACK well before the at-risk mark', () => {
    expect(
      resolveSlaState({ eventAt: null, dueAt, atRiskAt, now: ist(`${MONDAY} 12:00`) }),
    ).toBe('ON_TRACK');
  });

  it('is still ON_TRACK exactly at the at-risk mark', () => {
    // Boundary is strictly greater-than: at exactly 75% consumed the ticket has
    // not yet tipped into AT_RISK.
    expect(resolveSlaState({ eventAt: null, dueAt, atRiskAt, now: atRiskAt })).toBe('ON_TRACK');
  });

  it('becomes AT_RISK one millisecond after the mark', () => {
    const justAfter = new Date(atRiskAt.getTime() + 1);
    expect(resolveSlaState({ eventAt: null, dueAt, atRiskAt, now: justAfter })).toBe('AT_RISK');
  });

  it('stays AT_RISK up to and including the deadline', () => {
    expect(
      resolveSlaState({ eventAt: null, dueAt, atRiskAt, now: ist(`${MONDAY} 15:30`) }),
    ).toBe('AT_RISK');
    // Exactly at the deadline is not yet a breach, by the same rule.
    expect(resolveSlaState({ eventAt: null, dueAt, atRiskAt, now: dueAt })).toBe('AT_RISK');
  });

  it('becomes BREACHED one millisecond after the deadline', () => {
    const justAfter = new Date(dueAt.getTime() + 1);
    expect(resolveSlaState({ eventAt: null, dueAt, atRiskAt, now: justAfter })).toBe('BREACHED');
  });

  it('is BREACHED long after the deadline', () => {
    expect(
      resolveSlaState({ eventAt: null, dueAt, atRiskAt, now: ist(`${NEXT_WEDNESDAY} 09:00`) }),
    ).toBe('BREACHED');
  });

  describe('frozen once the event happens', () => {
    it('is MET when the event landed before the deadline', () => {
      expect(
        resolveSlaState({
          eventAt: ist(`${MONDAY} 11:00`),
          dueAt,
          atRiskAt,
          now: ist(`${MONDAY} 12:00`),
        }),
      ).toBe('MET');
    });

    it('is MET even when the event landed AFTER the deadline', () => {
      // The clock stops the moment the event happens. A late response is still
      // recorded as met and must never report BREACHED afterwards.
      expect(
        resolveSlaState({
          eventAt: ist(`${TUESDAY} 11:00`),
          dueAt,
          atRiskAt,
          now: ist(`${TUESDAY} 12:00`),
        }),
      ).toBe('MET');
    });

    it('stays MET days later, never sliding back into BREACHED', () => {
      expect(
        resolveSlaState({
          eventAt: ist(`${TUESDAY} 11:00`),
          dueAt,
          atRiskAt,
          now: ist(`${NEXT_THURSDAY} 17:00`),
        }),
      ).toBe('MET');
    });

    it('is MET at exactly the at-risk and due boundaries too', () => {
      expect(resolveSlaState({ eventAt: dueAt, dueAt, atRiskAt, now: dueAt })).toBe('MET');
    });
  });
});

describe('remainingBusinessMinutes', () => {
  it('counts business minutes still available', () => {
    expect(remainingBusinessMinutes(ist(`${MONDAY} 16:00`), ist(`${MONDAY} 14:00`), ctx)).toBe(120);
  });

  it('skips nights and weekends', () => {
    // Fri 17:00 -> Mon 10:00 leaves 1h Friday + 1h Monday.
    expect(
      remainingBusinessMinutes(ist(`${NEXT_MONDAY} 10:00`), ist(`${FRIDAY} 17:00`), ctx),
    ).toBe(120);
  });

  it('returns 0 rather than a negative number once past due', () => {
    expect(remainingBusinessMinutes(ist(`${MONDAY} 14:00`), ist(`${MONDAY} 16:00`), ctx)).toBe(0);
  });

  it('returns 0 exactly at the deadline', () => {
    const dueAt = ist(`${MONDAY} 16:00`);
    expect(remainingBusinessMinutes(dueAt, dueAt, ctx)).toBe(0);
  });

  it('returns 0 when only non-business time remains', () => {
    // now is Saturday, deadline is Sunday: no business minutes in between.
    expect(
      remainingBusinessMinutes(ist(`2026-03-08 18:00`), ist(`2026-03-07 09:00`), ctx),
    ).toBe(0);
  });
});
