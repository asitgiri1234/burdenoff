import type { PrismaClient } from '@prisma/client';
import {
  forbidden,
  ticketNotFound,
  userNotFound,
  validationError,
} from '../../graphql/errors.ts';
import type {
  ListTicketsArgs,
  TicketPage,
  TicketRecord,
  TicketRepository,
  Viewer,
} from '../../repositories/ticketRepository.ts';
import type { UserRepository } from '../../repositories/userRepository.ts';
import type {
  AssignTicketInput,
  ChangeTicketStatusInput,
  CreateTicketInput,
} from '../../validation/ticket.ts';
import { computeSlaTimestamps, type BusinessHoursContext } from '../sla/index.ts';
import { assertValidTransition, type TicketStatus } from './statusMachine.ts';

/**
 * Collaborators the ticket service needs.
 *
 * `now` and `businessHours` are supplied by the caller rather than read from a
 * clock or the database here, which keeps the service deterministic and lets
 * the seed script create backdated tickets through the very same code path.
 */
export interface TicketDeps {
  readonly prisma: PrismaClient;
  readonly tickets: TicketRepository;
  readonly users: UserRepository;
  readonly now: Date;
  readonly businessHours: BusinessHoursContext;
}

/** Loads a ticket or raises TICKET_NOT_FOUND. */
export async function requireTicket(id: string, deps: TicketDeps): Promise<TicketRecord> {
  const ticket = await deps.tickets.findById(id);
  if (ticket === null) throw ticketNotFound(id);
  return ticket;
}

/** Agents may act on any ticket; this guards the reporter-only operations. */
export function assertCanViewTicket(ticket: TicketRecord, viewer: Viewer): void {
  if (viewer.role === 'AGENT') return;
  if (ticket.reporterId !== viewer.id) {
    throw forbidden('You can only access tickets you reported');
  }
}

/**
 * Creates a ticket, materialising its four SLA deadlines at write time.
 *
 * Open to any authenticated user. The deadlines come from the SLA engine rather
 * than being derived later, which is what makes SLA state filterable in SQL.
 */
export async function createTicket(
  input: CreateTicketInput,
  viewer: Viewer,
  deps: TicketDeps,
): Promise<TicketRecord> {
  const createdAt = deps.now;
  const sla = computeSlaTimestamps(createdAt, input.priority, deps.businessHours);

  return deps.prisma.ticket.create({
    data: {
      title: input.title,
      description: input.description,
      priority: input.priority,
      status: 'OPEN',
      reporterId: viewer.id,
      createdAt,
      firstResponseDueAt: sla.firstResponseDueAt,
      resolutionDueAt: sla.resolutionDueAt,
      firstResponseAtRiskAt: sla.firstResponseAtRiskAt,
      resolutionAtRiskAt: sla.resolutionAtRiskAt,
    },
  });
}

/**
 * Assigns a ticket to an agent. AGENT only.
 *
 * Assigning an OPEN ticket also moves it to IN_PROGRESS: work has started, and
 * leaving it OPEN would misreport the queue.
 */
export async function assignTicket(
  input: AssignTicketInput,
  deps: TicketDeps,
): Promise<TicketRecord> {
  const ticket = await requireTicket(input.ticketId, deps);

  const assignee = await deps.users.findById(input.assigneeId);
  if (assignee === null) throw userNotFound(input.assigneeId);

  if (assignee.role !== 'AGENT') {
    throw validationError('Tickets can only be assigned to agents', [
      { path: 'assigneeId', message: 'This user is not an agent' },
    ]);
  }

  const status: TicketStatus = ticket.status === 'OPEN' ? 'IN_PROGRESS' : ticket.status;

  return deps.prisma.ticket.update({
    where: { id: ticket.id },
    data: { assigneeId: assignee.id, status },
  });
}

/**
 * Moves a ticket through the status machine. AGENT only.
 *
 * `resolvedAt` and `closedAt` are stamped on first entry into those states and
 * are never cleared on reopen. That is deliberate: the resolution SLA freezes
 * the moment the ticket is first resolved, so reopening a ticket cannot
 * retroactively turn a met SLA into a breach. Reopening starts a new working
 * period; it does not rewrite what already happened.
 */
export async function changeTicketStatus(
  input: ChangeTicketStatusInput,
  deps: TicketDeps,
): Promise<TicketRecord> {
  const ticket = await requireTicket(input.ticketId, deps);

  assertValidTransition(ticket.status, input.status);

  const data: {
    status: TicketStatus;
    resolvedAt?: Date;
    closedAt?: Date;
  } = { status: input.status };

  if (input.status === 'RESOLVED' && ticket.resolvedAt === null) {
    data.resolvedAt = deps.now;
  }
  if (input.status === 'CLOSED' && ticket.closedAt === null) {
    data.closedAt = deps.now;
  }

  return deps.prisma.ticket.update({ where: { id: ticket.id }, data });
}

/** Dedicated resolve mutation, sharing the single status-change code path. */
export async function resolveTicket(ticketId: string, deps: TicketDeps): Promise<TicketRecord> {
  return changeTicketStatus({ ticketId, status: 'RESOLVED' }, deps);
}

/** Reads a single ticket, subject to the caller's visibility. */
export async function getTicket(
  id: string,
  viewer: Viewer,
  deps: TicketDeps,
): Promise<TicketRecord | null> {
  const ticket = await deps.tickets.findById(id);
  if (ticket === null) return null;

  // Reporters get null rather than FORBIDDEN for another reporter's ticket, so
  // the API does not confirm that an id they cannot see exists.
  if (viewer.role !== 'AGENT' && ticket.reporterId !== viewer.id) return null;

  return ticket;
}

/** Lists tickets with filtering, sorting and cursor pagination. */
export async function listTickets(
  args: Omit<ListTicketsArgs, 'now'>,
  deps: TicketDeps,
): Promise<TicketPage> {
  return deps.tickets.list({ ...args, now: deps.now });
}
