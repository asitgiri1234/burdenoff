import { describe, expect, it } from 'vitest';
import { formatDateTime, formatRemaining, humanise } from './format.ts';

describe('formatRemaining', () => {
  // The minute count always comes from the API; this only formats it.
  it('renders hours and minutes', () => {
    expect(formatRemaining(134)).toBe('2h 14m');
  });

  it('renders whole hours without a minute part', () => {
    expect(formatRemaining(120)).toBe('2h');
    expect(formatRemaining(60)).toBe('1h');
  });

  it('renders sub-hour values as minutes only', () => {
    expect(formatRemaining(1)).toBe('1m');
    expect(formatRemaining(59)).toBe('59m');
  });

  it('renders a large multi-day budget in hours', () => {
    // 72 business hours, the LOW resolution budget.
    expect(formatRemaining(4320)).toBe('72h');
  });

  it('says overdue at or below zero rather than showing a negative', () => {
    expect(formatRemaining(0)).toBe('overdue');
    expect(formatRemaining(-15)).toBe('overdue');
  });
});

describe('formatDateTime', () => {
  it('renders a dash for null', () => {
    expect(formatDateTime(null)).toBe('—');
  });

  it('renders a dash for an unparseable value rather than "Invalid Date"', () => {
    expect(formatDateTime('not-a-date')).toBe('—');
  });

  it('renders an ISO timestamp in the local timezone', () => {
    const iso = '2026-03-02T04:30:00.000Z';
    // Compared against the platform's own conversion: the assertion is that we
    // localise rather than print the raw UTC string.
    expect(formatDateTime(iso)).toBe(new Date(iso).toLocaleString());
    expect(formatDateTime(iso)).not.toContain('Z');
  });
});

describe('humanise', () => {
  it('turns an enum value into sentence case', () => {
    expect(humanise('IN_PROGRESS')).toBe('In progress');
    expect(humanise('OPEN')).toBe('Open');
    expect(humanise('ON_TRACK')).toBe('On track');
    expect(humanise('URGENT')).toBe('Urgent');
  });
});
