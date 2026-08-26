import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { disconnectDatabase, resetDatabase, testPrisma } from './helpers/db.ts';
import { createTestUser, type TestUser } from './helpers/factories.ts';
import { createTestServer, errorCode, type TestServer } from './helpers/testServer.ts';

const CREATE_TICKET = /* GraphQL */ `
  mutation ($title: String!, $priority: Priority!) {
    createTicket(title: $title, description: "Details", priority: $priority) {
      id
    }
  }
`;

const ASSIGN = /* GraphQL */ `
  mutation ($ticketId: ID!, $assigneeId: ID!) {
    assignTicket(ticketId: $ticketId, assigneeId: $assigneeId) {
      id
      status
      assignee {
        id
      }
    }
  }
`;

const ADD_COMMENT = /* GraphQL */ `
  mutation ($ticketId: ID!, $content: String!) {
    addComment(ticketId: $ticketId, content: $content) {
      id
    }
  }
`;

const LIST_TICKETS = /* GraphQL */ `
  query {
    tickets {
      nodes {
        id
        title
        reporter {
          id
        }
      }
    }
  }
`;

const GET_TICKET = /* GraphQL */ `
  query ($id: ID!) {
    ticket(id: $id) {
      id
    }
  }
`;

let server: TestServer;
let reporter: TestUser;
let otherReporter: TestUser;
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
  otherReporter = await createTestUser({ role: 'REPORTER' });
  agent = await createTestUser({ role: 'AGENT' });
});

async function createTicketAs(user: TestUser, title: string): Promise<string> {
  const response = await server.execute<{ createTicket: { id: string } }>(
    CREATE_TICKET,
    { title, priority: 'MEDIUM' },
    user.token,
  );
  expect(response.errors).toBeUndefined();
  return response.data?.createTicket.id ?? '';
}

describe('role-based authorization', () => {
  it('forbids a reporter from assigning a ticket', async () => {
    const ticketId = await createTicketAs(reporter, 'Mine');

    const response = await server.execute(
      ASSIGN,
      { ticketId, assigneeId: agent.user.id },
      reporter.token,
    );

    expect(errorCode(response)).toBe('FORBIDDEN');

    // Nothing was written.
    const row = await testPrisma.ticket.findUniqueOrThrow({ where: { id: ticketId } });
    expect(row.assigneeId).toBeNull();
    expect(row.status).toBe('OPEN');
  });

  it('lets an agent assign a ticket and moves it to IN_PROGRESS', async () => {
    const ticketId = await createTicketAs(reporter, 'Mine');

    const response = await server.execute<{ assignTicket: { status: string } }>(
      ASSIGN,
      { ticketId, assigneeId: agent.user.id },
      agent.token,
    );

    expect(response.errors).toBeUndefined();
    expect(response.data?.assignTicket.status).toBe('IN_PROGRESS');

    const row = await testPrisma.ticket.findUniqueOrThrow({ where: { id: ticketId } });
    expect(row.assigneeId).toBe(agent.user.id);
    expect(row.status).toBe('IN_PROGRESS');
  });

  it('refuses to assign a ticket to a reporter', async () => {
    const ticketId = await createTicketAs(reporter, 'Mine');

    const response = await server.execute(
      ASSIGN,
      { ticketId, assigneeId: otherReporter.user.id },
      agent.token,
    );

    expect(errorCode(response)).toBe('VALIDATION_ERROR');
  });

  it('forbids a reporter from changing status', async () => {
    const ticketId = await createTicketAs(reporter, 'Mine');

    const response = await server.execute(
      'mutation ($id: ID!) { changeTicketStatus(ticketId: $id, status: RESOLVED) { id } }',
      { id: ticketId },
      reporter.token,
    );

    expect(errorCode(response)).toBe('FORBIDDEN');
    const row = await testPrisma.ticket.findUniqueOrThrow({ where: { id: ticketId } });
    expect(row.status).toBe('OPEN');
    expect(row.resolvedAt).toBeNull();
  });
});

describe('ticket visibility', () => {
  it('forbids a reporter commenting on another reporter`s ticket', async () => {
    const ticketId = await createTicketAs(reporter, 'Mine');

    const response = await server.execute(
      ADD_COMMENT,
      { ticketId, content: 'Me too!' },
      otherReporter.token,
    );

    expect(errorCode(response)).toBe('FORBIDDEN');
    expect(await testPrisma.comment.count({ where: { ticketId } })).toBe(0);
  });

  it('lets a reporter comment on their own ticket', async () => {
    const ticketId = await createTicketAs(reporter, 'Mine');

    const response = await server.execute(
      ADD_COMMENT,
      { ticketId, content: 'Extra detail.' },
      reporter.token,
    );

    expect(response.errors).toBeUndefined();
    expect(await testPrisma.comment.count({ where: { ticketId } })).toBe(1);
  });

  it('scopes the tickets query to the reporter`s own tickets', async () => {
    await createTicketAs(reporter, 'Reporter one ticket');
    await createTicketAs(otherReporter, 'Reporter two ticket');
    await createTicketAs(otherReporter, 'Reporter two second ticket');

    const mine = await server.execute<{ tickets: { nodes: { title: string }[] } }>(
      LIST_TICKETS,
      {},
      reporter.token,
    );
    expect(mine.errors).toBeUndefined();
    expect(mine.data?.tickets.nodes).toHaveLength(1);
    expect(mine.data?.tickets.nodes[0]?.title).toBe('Reporter one ticket');

    const theirs = await server.execute<{ tickets: { nodes: { title: string }[] } }>(
      LIST_TICKETS,
      {},
      otherReporter.token,
    );
    expect(theirs.data?.tickets.nodes).toHaveLength(2);

    // The agent sees every ticket.
    const all = await server.execute<{ tickets: { nodes: { title: string }[] } }>(
      LIST_TICKETS,
      {},
      agent.token,
    );
    expect(all.data?.tickets.nodes).toHaveLength(3);
  });

  it('returns null rather than FORBIDDEN for a ticket a reporter cannot see', async () => {
    const ticketId = await createTicketAs(otherReporter, 'Not yours');

    const response = await server.execute<{ ticket: null }>(
      GET_TICKET,
      { id: ticketId },
      reporter.token,
    );

    // Answering FORBIDDEN would confirm the id exists; null does not.
    expect(response.errors).toBeUndefined();
    expect(response.data?.ticket).toBeNull();
  });
});
