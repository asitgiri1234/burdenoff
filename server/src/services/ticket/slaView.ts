import type { TicketRecord } from '../../repositories/ticketRepository.ts';
import {
  remainingBusinessMinutes,
  resolveSlaState,
  type BusinessHoursContext,
  type SlaState,
} from '../sla/index.ts';

/** The shape behind the `SLAInfo` GraphQL type. */
export interface SlaView {
  readonly firstResponseDueAt: Date;
  readonly resolutionDueAt: Date;
  readonly firstResponseState: SlaState;
  readonly resolutionState: SlaState;
  readonly firstResponseRemainingMinutes: number;
  readonly resolutionRemainingMinutes: number;
}

/**
 * Projects a ticket row onto its SLA view.
 *
 * This is the only place in the codebase that turns stored timestamps into an
 * SLA state — everything else reads the result. `now` is passed in (from the
 * request context) so every ticket in one response is judged against the same
 * instant, rather than drifting as the response is assembled.
 *
 * Reads only columns already present on the row: no database access.
 */
export function toSlaView(
  ticket: TicketRecord,
  now: Date,
  ctx: BusinessHoursContext,
): SlaView {
  return {
    firstResponseDueAt: ticket.firstResponseDueAt,
    resolutionDueAt: ticket.resolutionDueAt,

    firstResponseState: resolveSlaState({
      eventAt: ticket.firstResponseAt,
      dueAt: ticket.firstResponseDueAt,
      atRiskAt: ticket.firstResponseAtRiskAt,
      now,
    }),

    resolutionState: resolveSlaState({
      eventAt: ticket.resolvedAt,
      dueAt: ticket.resolutionDueAt,
      atRiskAt: ticket.resolutionAtRiskAt,
      now,
    }),

    firstResponseRemainingMinutes: remainingBusinessMinutes(
      ticket.firstResponseDueAt,
      now,
      ctx,
    ),
    resolutionRemainingMinutes: remainingBusinessMinutes(ticket.resolutionDueAt, now, ctx),
  };
}
