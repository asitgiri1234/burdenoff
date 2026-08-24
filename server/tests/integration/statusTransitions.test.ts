import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { disconnectDatabase, resetDatabase, testPrisma } from './helpers/db.ts';
import { createTestUser, type TestUser } from './helpers/factories.ts';
import { createTestServer, errorCode, type TestServer } from './helpers/testServer.ts';

const CHANGE_STATUS = /* GraphQL */ `
  mutation ($ticketId: ID!, $status: TicketStatus!) {
    changeTicketStatus(ticketId: $ticketId, status: $status) {
      id
      status
      resolvedAt
      closedAt
    }
  }
`;

const RESOLVE = /* GraphQL */ `
  mutation ($ticketId: ID!) {
    resolveTicket(ticketId: $ticketId) {
      id
      status
      resolvedAt
    }
  }
`;

let server: TestServer;
let reporter: TestUser;
let agent: TestUser;

beforeAll(async () => {
  server = await createTestServer();
});

afterAll(async () => {
  await disconnectDatabase();
});

beforeEach(async () => {
  await resetDatabase();
  reporter = await createTestUser({ role: 'REPORTER' });
  agent = await createTestUser({ role: 'AGENT' });
});

async function createTicket(): Promise<string> {
  const response = await server.execute<{ createTicket: { id: string } }>(
    'mutation { createTicket(title: "T", description: "D", priority: HIGH) { id } }',
    {},
    reporter.token,
  );
  expect(response.errors).toBeUndefined();
  return response.data?.createTicket.id ?? '';
}

describe('status transitions end to end', () => {
  it('walks OPEN -> IN_PROGRESS -> RESOLVED -> CLOSED and persists the stamps', async () => {
    const ticketId = await createTicket();

    const inProgress = await server.execute<{ changeTicketStatus: { status: string } }>(
      CHANGE_STATUS,
      { ticketId, status: 'IN_PROGRESS' },
      agent.token,
    );
    expect(inProgress.errors).toBeUndefined();
    expect(inProgress.data?.changeTicketStatus.status).toBe('IN_PROGRESS');

    const resolved = await server.execute<{
      changeTicketStatus: { status: string; resolvedAt: string };
    }>(CHANGE_STATUS, { ticketId, status: 'RESOLVED' }, agent.token);
    expect(resolved.errors).toBeUndefined();
    expect(resolved.data?.changeTicketStatus.resolvedAt).not.toBeNull();

    const closed = await server.execute<{
      changeTicketStatus: { status: string; closedAt: string };
    }>(CHANGE_STATUS, { ticketId, status: 'CLOSED' }, agent.token);
    expect(closed.errors).toBeUndefined();

    const row = await testPrisma.ticket.findUniqueOrThrow({ where: { id: ticketId } });
    expect(row.status).toBe('CLOSED');
    expect(row.resolvedAt).not.toBeNull();
    expect(row.closedAt).not.toBeNull();
  });

  it('rejects CLOSED -> IN_PROGRESS with a 200 carrying a typed error', async () => {
    const ticketId = await createTicket();
    await server.execute(CHANGE_STATUS, { ticketId, status: 'CLOSED' }, agent.token);

    const response = await server.execute(
      CHANGE_STATUS,
      { ticketId, status: 'IN_PROGRESS' },
      agent.token,
    );

    // A rule violation is a normal GraphQL error, never a 500.
    expect(response.status).toBe(200);
    expect(errorCode(response)).toBe('INVALID_STATUS_TRANSITION');
    expect(response.errors?.[0]?.message).toBe(
      'Ticket cannot transition from CLOSED to IN_PROGRESS.',
    );

    const row = await testPrisma.ticket.findUniqueOrThrow({ where: { id: ticketId } });
    expect(row.status).toBe('CLOSED');
  });

  it('rejects a same-status transition', async () => {
    const ticketId = await createTicket();

    const response = await server.execute(
      CHANGE_STATUS,
      { ticketId, status: 'OPEN' },
      agent.token,
    );

    expect(response.status).toBe(200);
    expect(errorCode(response)).toBe('INVALID_STATUS_TRANSITION');
  });

  it('allows CLOSED -> OPEN and keeps resolvedAt', async () => {
    const ticketId = await createTicket();
    await server.execute(CHANGE_STATUS, { ticketId, status: 'RESOLVED' }, agent.token);
    await server.execute(CHANGE_STATUS, { ticketId, status: 'CLOSED' }, agent.token);

    const beforeReopen = await testPrisma.ticket.findUniqueOrThrow({ where: { id: ticketId } });
    const resolvedAt = beforeReopen.resolvedAt;
    expect(resolvedAt).not.toBeNull();

    const reopened = await server.execute<{ changeTicketStatus: { status: string } }>(
      CHANGE_STATUS,
      { ticketId, status: 'OPEN' },
      agent.token,
    );
    expect(reopened.errors).toBeUndefined();
    expect(reopened.data?.changeTicketStatus.status).toBe('OPEN');

    // Reopening starts new work; it must not rewrite a met resolution SLA.
    const row = await testPrisma.ticket.findUniqueOrThrow({ where: { id: ticketId } });
    expect(row.resolvedAt).toEqual(resolvedAt);
  });

  it('does not move resolvedAt when a ticket is resolved twice', async () => {
    const ticketId = await createTicket();

    const first = await server.execute<{ resolveTicket: { resolvedAt: string } }>(
      RESOLVE,
      { ticketId },
      agent.token,
    );
    const firstResolvedAt = first.data?.resolveTicket.resolvedAt;
    expect(firstResolvedAt).toBeDefined();

    await server.execute(CHANGE_STATUS, { ticketId, status: 'IN_PROGRESS' }, agent.token);
    const second = await server.execute<{ resolveTicket: { resolvedAt: string } }>(
      RESOLVE,
      { ticketId },
      agent.token,
    );

    expect(second.data?.resolveTicket.resolvedAt).toBe(firstResolvedAt ?? '');

    const row = await testPrisma.ticket.findUniqueOrThrow({ where: { id: ticketId } });
    expect(row.resolvedAt?.toISOString()).toBe(firstResolvedAt ?? '');
  });

  it('reports TICKET_NOT_FOUND for an unknown ticket', async () => {
    const response = await server.execute(
      CHANGE_STATUS,
      { ticketId: 'does-not-exist', status: 'RESOLVED' },
      agent.token,
    );

    expect(response.status).toBe(200);
    expect(errorCode(response)).toBe('TICKET_NOT_FOUND');
  });
});
