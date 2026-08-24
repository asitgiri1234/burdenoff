import { beforeEach, describe, expect, it } from 'bun:test';
import { GraphQLError } from 'graphql';
import type { Viewer } from '../../src/repositories/ticketRepository.ts';
import {
  clampTake,
  decodeCursor,
  DEFAULT_TAKE,
  MAX_TAKE,
  slaStateWhere,
} from '../../src/repositories/ticketRepository.ts';
import { computeSlaTimestamps } from '../../src/services/sla/index.ts';
import {
  addComment,
  allowedTransitions,
  assertValidTransition,
  assignTicket,
  canTransition,
  changeTicketStatus,
  createTicket,
  listTickets,
  resolveTicket,
  toSlaView,
  type TicketDeps,
  type TicketStatus,
} from '../../src/services/ticket/index.ts';
import {
  addCommentSchema,
  createTicketSchema,
  parseInput,
} from '../../src/validation/index.ts';
import { ctxWith, ist, MONDAY } from './fixtures.ts';
import { FakeTicketStore } from './fakeTicketStore.ts';
import { FakeUserRepository } from './fakeUserRepository.ts';

const businessHours = ctxWith();
const NOW = ist(`${MONDAY} 10:00`);

let store: FakeTicketStore;
let users: FakeUserRepository;
let deps: TicketDeps;

let reporter: Viewer;
let otherReporter: Viewer;
let agent: Viewer;

beforeEach(async () => {
  store = new FakeTicketStore();
  users = new FakeUserRepository();

  const rhea = await users.create({
    name: 'Rhea',
    email: 'rhea@example.com',
    passwordHash: 'x',
    role: 'REPORTER',
  });
  const raj = await users.create({
    name: 'Raj',
    email: 'raj@example.com',
    passwordHash: 'x',
    role: 'REPORTER',
  });
  const ava = await users.create({
    name: 'Ava',
    email: 'ava@example.com',
    passwordHash: 'x',
    role: 'AGENT',
  });

  reporter = { id: rhea.id, role: 'REPORTER' };
  otherReporter = { id: raj.id, role: 'REPORTER' };
  agent = { id: ava.id, role: 'AGENT' };

  deps = {
    prisma: store.prisma,
    tickets: store.repository,
    users,
    now: NOW,
    businessHours,
  };
});

async function captureError(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
  } catch (error) {
    return error;
  }
  throw new Error('Expected the call to throw, but it resolved');
}

function codeOf(error: unknown): string | undefined {
  if (!(error instanceof GraphQLError)) return undefined;
  const code = error.extensions['code'];
  return typeof code === 'string' ? code : undefined;
}

function fieldPathsOf(error: unknown): string[] {
  if (!(error instanceof GraphQLError)) return [];
  const fieldErrors = error.extensions['fieldErrors'];
  return Array.isArray(fieldErrors)
    ? (fieldErrors as { path: string }[]).map((f) => f.path)
    : [];
}

const newTicket = {
  title: 'Checkout fails',
  description: 'A 500 on the payment step',
  priority: 'URGENT' as const,
};

describe('status machine', () => {
  const legal: [TicketStatus, TicketStatus][] = [
    ['OPEN', 'IN_PROGRESS'],
    ['OPEN', 'RESOLVED'],
    ['OPEN', 'CLOSED'],
    ['IN_PROGRESS', 'RESOLVED'],
    ['IN_PROGRESS', 'OPEN'],
    ['IN_PROGRESS', 'CLOSED'],
    ['RESOLVED', 'CLOSED'],
    ['RESOLVED', 'IN_PROGRESS'],
    ['RESOLVED', 'OPEN'],
    ['CLOSED', 'OPEN'],
  ];

  it.each(legal)('allows %s -> %s', (from, to) => {
    expect(() => { assertValidTransition(from, to); }).not.toThrow();
    expect(canTransition(from, to)).toBe(true);
  });

  it('rejects CLOSED -> IN_PROGRESS with the right code and message', () => {
    let thrown: unknown;
    try {
      assertValidTransition('CLOSED', 'IN_PROGRESS');
    } catch (error) {
      thrown = error;
    }

    expect(codeOf(thrown)).toBe('INVALID_STATUS_TRANSITION');
    expect((thrown as GraphQLError).message).toBe(
      'Ticket cannot transition from CLOSED to IN_PROGRESS.',
    );
  });

  it('rejects CLOSED -> RESOLVED', () => {
    expect(canTransition('CLOSED', 'RESOLVED')).toBe(false);
  });

  const statuses: TicketStatus[] = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];
  it.each(statuses)('rejects the same-status transition %s -> %s', (status) => {
    expect(canTransition(status, status)).toBe(false);
    expect(() => { assertValidTransition(status, status); }).toThrow(GraphQLError);
  });

  it('exposes the allowed transitions for a state', () => {
    expect([...allowedTransitions('CLOSED')]).toEqual(['OPEN']);
  });
});

describe('createTicket', () => {
  it('persists the four SLA timestamps the engine computes', async () => {
    const ticket = await createTicket(newTicket, reporter, deps);
    const expected = computeSlaTimestamps(NOW, 'URGENT', businessHours);

    expect(ticket.firstResponseDueAt).toEqual(expected.firstResponseDueAt);
    expect(ticket.resolutionDueAt).toEqual(expected.resolutionDueAt);
    expect(ticket.firstResponseAtRiskAt).toEqual(expected.firstResponseAtRiskAt);
    expect(ticket.resolutionAtRiskAt).toEqual(expected.resolutionAtRiskAt);
  });

  it('starts OPEN, unassigned and unanswered', async () => {
    const ticket = await createTicket(newTicket, reporter, deps);

    expect(ticket.status).toBe('OPEN');
    expect(ticket.assigneeId).toBeNull();
    expect(ticket.firstResponseAt).toBeNull();
    expect(ticket.resolvedAt).toBeNull();
    expect(ticket.reporterId).toBe(reporter.id);
  });

  it('is open to reporters, not only agents', async () => {
    await expect(createTicket(newTicket, reporter, deps)).resolves.toBeDefined();
  });

  it.each([
    ['title', { ...newTicket, title: '' }],
    ['title', { ...newTicket, title: '   ' }],
    ['description', { ...newTicket, description: '' }],
    ['description', { ...newTicket, description: '\t\n  ' }],
  ])('rejects an empty or whitespace-only %s', (path, input) => {
    let thrown: unknown;
    try {
      parseInput(createTicketSchema, input);
    } catch (error) {
      thrown = error;
    }

    expect(codeOf(thrown)).toBe('VALIDATION_ERROR');
    expect(fieldPathsOf(thrown)).toContain(path);
  });
});

describe('assignTicket', () => {
  it('assigns to an agent and moves an OPEN ticket to IN_PROGRESS', async () => {
    const ticket = await createTicket(newTicket, reporter, deps);
    const updated = await assignTicket({ ticketId: ticket.id, assigneeId: agent.id }, deps);

    expect(updated.assigneeId).toBe(agent.id);
    expect(updated.status).toBe('IN_PROGRESS');
  });

  it('leaves a non-OPEN status untouched', async () => {
    const ticket = await createTicket(newTicket, reporter, deps);
    await changeTicketStatus({ ticketId: ticket.id, status: 'RESOLVED' }, deps);

    const updated = await assignTicket({ ticketId: ticket.id, assigneeId: agent.id }, deps);
    expect(updated.status).toBe('RESOLVED');
  });

  it('raises TICKET_NOT_FOUND for an unknown ticket', async () => {
    const error = await captureError(() =>
      assignTicket({ ticketId: 'nope', assigneeId: agent.id }, deps),
    );
    expect(codeOf(error)).toBe('TICKET_NOT_FOUND');
  });

  it('raises USER_NOT_FOUND for an unknown assignee', async () => {
    const ticket = await createTicket(newTicket, reporter, deps);
    const error = await captureError(() =>
      assignTicket({ ticketId: ticket.id, assigneeId: 'nobody' }, deps),
    );
    expect(codeOf(error)).toBe('USER_NOT_FOUND');
  });

  it('refuses to assign a ticket to a REPORTER', async () => {
    const ticket = await createTicket(newTicket, reporter, deps);
    const error = await captureError(() =>
      assignTicket({ ticketId: ticket.id, assigneeId: otherReporter.id }, deps),
    );

    expect(codeOf(error)).toBe('VALIDATION_ERROR');
    expect(fieldPathsOf(error)).toContain('assigneeId');
  });
});

describe('changeTicketStatus', () => {
  it('stamps resolvedAt on the first resolve', async () => {
    const ticket = await createTicket(newTicket, reporter, deps);
    const resolved = await changeTicketStatus({ ticketId: ticket.id, status: 'RESOLVED' }, deps);

    expect(resolved.resolvedAt).toEqual(NOW);
  });

  it('does not move resolvedAt when resolved a second time', async () => {
    const ticket = await createTicket(newTicket, reporter, deps);
    await changeTicketStatus({ ticketId: ticket.id, status: 'RESOLVED' }, deps);

    // Reopen, then resolve again at a later instant.
    await changeTicketStatus({ ticketId: ticket.id, status: 'IN_PROGRESS' }, deps);
    const later: TicketDeps = { ...deps, now: ist(`${MONDAY} 15:00`) };
    const again = await changeTicketStatus({ ticketId: ticket.id, status: 'RESOLVED' }, later);

    expect(again.resolvedAt).toEqual(NOW);
  });

  it('keeps resolvedAt when a resolved ticket is reopened', async () => {
    const ticket = await createTicket(newTicket, reporter, deps);
    await changeTicketStatus({ ticketId: ticket.id, status: 'RESOLVED' }, deps);
    const reopened = await changeTicketStatus({ ticketId: ticket.id, status: 'OPEN' }, deps);

    // The resolution SLA is frozen once met; reopening starts new work but
    // must not retroactively turn a met SLA into a breach.
    expect(reopened.resolvedAt).toEqual(NOW);
    expect(reopened.status).toBe('OPEN');
  });

  it('stamps closedAt on close', async () => {
    const ticket = await createTicket(newTicket, reporter, deps);
    const closed = await changeTicketStatus({ ticketId: ticket.id, status: 'CLOSED' }, deps);
    expect(closed.closedAt).toEqual(NOW);
  });

  it('rejects an illegal transition through the service', async () => {
    const ticket = await createTicket(newTicket, reporter, deps);
    await changeTicketStatus({ ticketId: ticket.id, status: 'CLOSED' }, deps);

    const error = await captureError(() =>
      changeTicketStatus({ ticketId: ticket.id, status: 'IN_PROGRESS' }, deps),
    );
    expect(codeOf(error)).toBe('INVALID_STATUS_TRANSITION');
  });

  it('resolveTicket shares the status-change path', async () => {
    const ticket = await createTicket(newTicket, reporter, deps);
    const resolved = await resolveTicket(ticket.id, deps);

    expect(resolved.status).toBe('RESOLVED');
    expect(resolved.resolvedAt).toEqual(NOW);
  });
});

describe('addComment and first response', () => {
  it('does not stamp firstResponseAt for a reporter comment on their own ticket', async () => {
    const ticket = await createTicket(newTicket, reporter, deps);
    await addComment({ ticketId: ticket.id, content: 'Any update?' }, reporter, deps);

    expect(store.tickets.get(ticket.id)?.firstResponseAt).toBeNull();
  });

  it('stamps firstResponseAt on the first agent comment', async () => {
    const ticket = await createTicket(newTicket, reporter, deps);
    await addComment({ ticketId: ticket.id, content: 'Any update?' }, reporter, deps);
    await addComment({ ticketId: ticket.id, content: 'Looking into it.' }, agent, deps);

    expect(store.tickets.get(ticket.id)?.firstResponseAt).toEqual(NOW);
  });

  it('does not overwrite firstResponseAt on a second agent comment', async () => {
    const ticket = await createTicket(newTicket, reporter, deps);
    await addComment({ ticketId: ticket.id, content: 'Looking into it.' }, agent, deps);

    const later: TicketDeps = { ...deps, now: ist(`${MONDAY} 16:00`) };
    await addComment({ ticketId: ticket.id, content: 'Fixed.' }, agent, later);

    expect(store.tickets.get(ticket.id)?.firstResponseAt).toEqual(NOW);
  });

  it('lets an agent comment on any ticket', async () => {
    const ticket = await createTicket(newTicket, reporter, deps);
    await expect(
      addComment({ ticketId: ticket.id, content: 'On it.' }, agent, deps),
    ).resolves.toBeDefined();
  });

  it('forbids a reporter commenting on someone else`s ticket', async () => {
    const ticket = await createTicket(newTicket, reporter, deps);
    const error = await captureError(() =>
      addComment({ ticketId: ticket.id, content: 'Me too' }, otherReporter, deps),
    );

    expect(codeOf(error)).toBe('FORBIDDEN');
  });

  it('rejects an empty comment with INVALID_COMMENT', async () => {
    const ticket = await createTicket(newTicket, reporter, deps);
    const error = await captureError(() =>
      addComment({ ticketId: ticket.id, content: '' }, reporter, deps),
    );

    expect(codeOf(error)).toBe('INVALID_COMMENT');
  });

  it('rejects a whitespace-only comment', async () => {
    const ticket = await createTicket(newTicket, reporter, deps);
    // The schema trims first, so the service sees an empty string.
    const input = parseInput(addCommentSchema, { ticketId: ticket.id, content: '   \n ' });
    const error = await captureError(() => addComment(input, reporter, deps));

    expect(codeOf(error)).toBe('INVALID_COMMENT');
  });

  it('raises TICKET_NOT_FOUND for an unknown ticket', async () => {
    const error = await captureError(() =>
      addComment({ ticketId: 'nope', content: 'Hello' }, agent, deps),
    );
    expect(codeOf(error)).toBe('TICKET_NOT_FOUND');
  });
});

describe('SLA view', () => {
  it('reports a fresh URGENT ticket as ON_TRACK on both clocks', async () => {
    const ticket = await createTicket(newTicket, reporter, deps);
    const view = toSlaView(ticket, NOW, businessHours);

    expect(view.firstResponseState).toBe('ON_TRACK');
    expect(view.resolutionState).toBe('ON_TRACK');
    expect(view.firstResponseRemainingMinutes).toBe(60);
  });

  it('reports BREACHED once the deadline has passed unanswered', async () => {
    const ticket = await createTicket(newTicket, reporter, deps);
    const view = toSlaView(ticket, ist(`${MONDAY} 17:00`), businessHours);

    expect(view.firstResponseState).toBe('BREACHED');
    expect(view.firstResponseRemainingMinutes).toBe(0);
  });

  it('freezes at MET once answered, even long after the deadline', async () => {
    const ticket = await createTicket(newTicket, reporter, deps);
    await addComment({ ticketId: ticket.id, content: 'On it.' }, agent, deps);

    const answered = store.tickets.get(ticket.id);
    expect(answered).toBeDefined();
    if (answered === undefined) return;

    const view = toSlaView(answered, ist('2026-03-20 17:00'), businessHours);
    expect(view.firstResponseState).toBe('MET');
  });
});

describe('slaStateWhere', () => {
  // The point of these is that state is expressed as SQL a database can index,
  // not derived in JavaScript after loading rows.
  it('builds a BREACHED predicate over both clocks', () => {
    const where = slaStateWhere('BREACHED', NOW);
    expect(where.OR).toEqual([
      { firstResponseAt: null, firstResponseDueAt: { lt: NOW } },
      { resolvedAt: null, resolutionDueAt: { lt: NOW } },
    ]);
  });

  it('excludes breached tickets from AT_RISK', () => {
    const where = slaStateWhere('AT_RISK', NOW);
    expect(Array.isArray(where.AND)).toBe(true);
    expect(JSON.stringify(where)).toContain('NOT');
  });

  it('treats MET as both clocks stopped', () => {
    expect(slaStateWhere('MET', NOW)).toEqual({
      firstResponseAt: { not: null },
      resolvedAt: { not: null },
    });
  });
});

describe('pagination', () => {
  it('clamps take into range', () => {
    expect(clampTake(null)).toBe(DEFAULT_TAKE);
    expect(clampTake(undefined)).toBe(DEFAULT_TAKE);
    expect(clampTake(5)).toBe(5);
    expect(clampTake(0)).toBe(1);
    expect(clampTake(-10)).toBe(1);
    expect(clampTake(1000)).toBe(MAX_TAKE);
  });

  it('round-trips a cursor', async () => {
    const ticket = await createTicket(newTicket, reporter, deps);
    const page = await listTickets(
      { viewer: agent, sortBy: 'CREATED_AT', sortDirection: 'DESC', take: 1 },
      deps,
    );

    expect(page.endCursor).not.toBeNull();
    const decoded = page.endCursor === null ? null : decodeCursor(page.endCursor);
    expect(decoded?.id).toBe(ticket.id);
  });

  it('returns non-overlapping pages with a correct hasNextPage', async () => {
    // Five tickets, one business minute apart so the order is deterministic.
    const created = [];
    for (let index = 0; index < 5; index += 1) {
      const at = new Date(NOW.getTime() + index * 60_000);
      created.push(await createTicket(newTicket, reporter, { ...deps, now: at }));
    }

    const first = await listTickets(
      { viewer: agent, sortBy: 'CREATED_AT', sortDirection: 'ASC', take: 2 },
      deps,
    );
    expect(first.nodes).toHaveLength(2);
    expect(first.hasNextPage).toBe(true);

    const second = await listTickets(
      { viewer: agent, sortBy: 'CREATED_AT', sortDirection: 'ASC', take: 2, cursor: first.endCursor },
      deps,
    );
    expect(second.nodes).toHaveLength(2);
    expect(second.hasNextPage).toBe(true);

    const third = await listTickets(
      { viewer: agent, sortBy: 'CREATED_AT', sortDirection: 'ASC', take: 2, cursor: second.endCursor },
      deps,
    );
    expect(third.nodes).toHaveLength(1);
    expect(third.hasNextPage).toBe(false);

    const seen = [...first.nodes, ...second.nodes, ...third.nodes].map((t) => t.id);
    expect(new Set(seen).size).toBe(5);
    expect(seen).toEqual(created.map((t) => t.id));
  });

  it('scopes a reporter to their own tickets', async () => {
    await createTicket(newTicket, reporter, deps);
    await createTicket(newTicket, otherReporter, deps);

    const mine = await listTickets(
      { viewer: reporter, sortBy: 'CREATED_AT', sortDirection: 'DESC' },
      deps,
    );
    expect(mine.nodes).toHaveLength(1);
    expect(mine.nodes[0]?.reporterId).toBe(reporter.id);

    const all = await listTickets(
      { viewer: agent, sortBy: 'CREATED_AT', sortDirection: 'DESC' },
      deps,
    );
    expect(all.nodes).toHaveLength(2);
  });
});
