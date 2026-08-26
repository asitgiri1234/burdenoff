/**
 * Ticket priority.
 *
 * Declared locally rather than imported from `@prisma/client` on purpose: this
 * module is dependency-free so it can be unit-tested without a database or a
 * generated client. The union mirrors the Prisma `Priority` enum exactly, and
 * the persistence layer is responsible for the (structurally identical) mapping.
 */
export type Priority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';

export interface SlaPolicy {
  /** Business minutes allowed before an agent must first respond. */
  readonly firstResponseMinutes: number;
  /** Business minutes allowed before the ticket must be resolved. */
  readonly resolutionMinutes: number;
}

const HOUR = 60;

/**
 * SLA budgets per priority, in **business minutes** (not wall-clock).
 *
 *   URGENT   1h first response /  4h resolution
 *   HIGH     4h                / 24h
 *   MEDIUM   8h                / 48h
 *   LOW     24h                / 72h
 *
 * Stored as minutes so the arithmetic never has to deal with fractional hours.
 */
export const SLA_POLICIES: Record<Priority, SlaPolicy> = Object.freeze({
  URGENT: { firstResponseMinutes: 1 * HOUR, resolutionMinutes: 4 * HOUR },
  HIGH: { firstResponseMinutes: 4 * HOUR, resolutionMinutes: 24 * HOUR },
  MEDIUM: { firstResponseMinutes: 8 * HOUR, resolutionMinutes: 48 * HOUR },
  LOW: { firstResponseMinutes: 24 * HOUR, resolutionMinutes: 72 * HOUR },
});

/** Looks up the SLA budget for a priority. */
export function getPolicy(priority: Priority): SlaPolicy {
  const policy = SLA_POLICIES[priority];
  if (policy === undefined) {
    throw new RangeError(`getPolicy: unknown priority "${priority}"`);
  }
  return policy;
}
