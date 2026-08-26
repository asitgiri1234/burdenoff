import {
  addBusinessMinutes,
  businessMinutesBetween,
  type BusinessHoursContext,
} from './businessHours.ts';
import { getPolicy, type Priority } from './slaPolicy.ts';

/**
 * SLA state for a single clock (first response or resolution).
 *
 * `MET` is terminal: once the event happened the clock stopped, and no amount
 * of elapsed time can move the ticket back into breach.
 */
export type SlaState = 'MET' | 'ON_TRACK' | 'AT_RISK' | 'BREACHED';

export interface SlaTimestamps {
  readonly firstResponseDueAt: Date;
  readonly resolutionDueAt: Date;
  readonly firstResponseAtRiskAt: Date;
  readonly resolutionAtRiskAt: Date;
}

/** Fraction of the budget that must be consumed before a ticket is "at risk". */
const AT_RISK_THRESHOLD = 0.75;

/**
 * Computes the four SLA timestamps stored on a ticket at creation time.
 *
 * At-risk marks sit at 75% of the budget, measured in business minutes from
 * `createdAt` (floored, so the mark never lands mid-minute).
 */
export function computeSlaTimestamps(
  createdAt: Date,
  priority: Priority,
  ctx: BusinessHoursContext,
): SlaTimestamps {
  const { firstResponseMinutes, resolutionMinutes } = getPolicy(priority);

  return {
    firstResponseDueAt: addBusinessMinutes(createdAt, firstResponseMinutes, ctx),
    resolutionDueAt: addBusinessMinutes(createdAt, resolutionMinutes, ctx),
    firstResponseAtRiskAt: addBusinessMinutes(
      createdAt,
      Math.floor(firstResponseMinutes * AT_RISK_THRESHOLD),
      ctx,
    ),
    resolutionAtRiskAt: addBusinessMinutes(
      createdAt,
      Math.floor(resolutionMinutes * AT_RISK_THRESHOLD),
      ctx,
    ),
  };
}

export interface ResolveSlaStateArgs {
  /** When the tracked event actually happened, or null if it has not. */
  readonly eventAt: Date | null;
  readonly dueAt: Date;
  readonly atRiskAt: Date;
  readonly now: Date;
}

/**
 * Derives SLA state from stored timestamps.
 *
 * Precedence is strict and ordered:
 *   1. the event happened  → MET, frozen forever. A late response still counts
 *      as met: the clock stopped when the event landed, so a ticket answered
 *      after its deadline never reports BREACHED afterwards.
 *   2. past the deadline   → BREACHED
 *   3. past the at-risk mark → AT_RISK
 *   4. otherwise           → ON_TRACK
 *
 * Boundaries are strictly greater-than: at *exactly* the at-risk mark (75% of
 * the budget consumed) the ticket is still ON_TRACK, and AT_RISK only begins
 * afterwards. The same holds for the deadline itself.
 */
export function resolveSlaState({
  eventAt,
  dueAt,
  atRiskAt,
  now,
}: ResolveSlaStateArgs): SlaState {
  if (eventAt !== null) return 'MET';

  const nowMs = now.getTime();
  if (nowMs > dueAt.getTime()) return 'BREACHED';
  if (nowMs > atRiskAt.getTime()) return 'AT_RISK';
  return 'ON_TRACK';
}

/**
 * Business minutes left before `dueAt`, floored at 0.
 *
 * Display only — SLA state is always derived by {@link resolveSlaState} from
 * the stored timestamps, never from this number.
 */
export function remainingBusinessMinutes(
  dueAt: Date,
  now: Date,
  ctx: BusinessHoursContext,
): number {
  return businessMinutesBetween(now, dueAt, ctx);
}
