import { invalidStatusTransition } from '../../graphql/errors.ts';

export type TicketStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';

/**
 * Legal status transitions, enforced server-side.
 *
 *   OPEN        → IN_PROGRESS, RESOLVED, CLOSED
 *   IN_PROGRESS → RESOLVED, OPEN, CLOSED
 *   RESOLVED    → CLOSED, IN_PROGRESS (reopen), OPEN (reopen)
 *   CLOSED      → OPEN only
 *
 * CLOSED is deliberately a near-terminal state: the single way out is an
 * explicit reopen to OPEN. Allowing CLOSED → IN_PROGRESS would let a ticket
 * resume work without ever re-entering the queue, so it is rejected.
 *
 * Same-status transitions are rejected as well — they carry no meaning and are
 * almost always a client bug (a double-submitted mutation) worth surfacing.
 */
const TRANSITIONS: Readonly<Record<TicketStatus, readonly TicketStatus[]>> = Object.freeze({
  OPEN: ['IN_PROGRESS', 'RESOLVED', 'CLOSED'],
  IN_PROGRESS: ['RESOLVED', 'OPEN', 'CLOSED'],
  RESOLVED: ['CLOSED', 'IN_PROGRESS', 'OPEN'],
  CLOSED: ['OPEN'],
});

/** True when `from → to` is a permitted transition. */
export function canTransition(from: TicketStatus, to: TicketStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Statuses a ticket in `from` may legally move to. */
export function allowedTransitions(from: TicketStatus): readonly TicketStatus[] {
  return TRANSITIONS[from];
}

/**
 * Throws INVALID_STATUS_TRANSITION unless `from → to` is permitted.
 * The message names both states so the client can show it verbatim.
 */
export function assertValidTransition(from: TicketStatus, to: TicketStatus): void {
  if (!canTransition(from, to)) {
    throw invalidStatusTransition(from, to);
  }
}
