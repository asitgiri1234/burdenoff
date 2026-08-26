import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { env } from '../../src/config/env.ts';
import {
  buildBusinessHoursContext,
  computeSlaTimestamps,
} from '../../src/services/sla/index.ts';
import { disconnectDatabase, resetDatabase, testPrisma } from './helpers/db.ts';
import { createTestUser, type TestUser } from './helpers/factories.ts';
import { createTestServer, type TestServer } from './helpers/testServer.ts';

const CREATE_TICKET = /* GraphQL */ `
  mutation ($title: String!, $description: String!, $priority: Priority!) {
    createTicket(title: $title, description: $description, priority: $priority) {
      id
      status
      priority
    }
  }
`;

const ADD_COMMENT = /* GraphQL */ `
  mutation ($ticketId: ID!, $content: String!) {
    addComment(ticketId: $ticketId, content: $content) {
      id
      content
      createdAt
    }
  }
`;

const GET_TICKET_SLA = /* GraphQL */ `
  query ($id: ID!) {
    ticket(id: $id) {
      id
      firstResponseAt
      sla {
        firstResponseState
        resolutionState
        firstResponseDueAt
        resolutionDueAt
      }
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

/** Creates a HIGH ticket as the reporter and returns its id. */
async function createHighTicket(): Promise<string> {
  const response = await server.execute<{ createTicket: { id: string } }>(
    CREATE_TICKET,
    {
      title: 'Password reset emails are delayed',
      description: 'Reset emails take hours to arrive.',
      priority: 'HIGH',
    },
    reporter.token,
  );

  expect(response.errors).toBeUndefined();
  const id = response.data?.createTicket.id;
  expect(id).toBeDefined();
  return id ?? '';
}

describe('first response tracking against a real database', () => {
  it('persists all four SLA timestamps matching the SLA engine', async () => {
    const ticketId = await createHighTicket();

    // Read the row back through Prisma — proving the values round-tripped
    // through Postgres rather than only existing in the response.
    const row = await testPrisma.ticket.findUniqueOrThrow({ where: { id: ticketId } });

    expect(row.firstResponseDueAt).not.toBeNull();
    expect(row.resolutionDueAt).not.toBeNull();
    expect(row.firstResponseAtRiskAt).not.toBeNull();
    expect(row.resolutionAtRiskAt).not.toBeNull();

    // The stored deadlines must equal what the engine computes for the stored
    // createdAt — no drift introduced by serialisation or the database.
    const businessHours = buildBusinessHoursContext([], {
      timezone: env.BUSINESS_TIMEZONE,
      startHour: env.BUSINESS_START_HOUR,
      endHour: env.BUSINESS_END_HOUR,
    });
    const expected = computeSlaTimestamps(row.createdAt, 'HIGH', businessHours);

    expect(row.firstResponseDueAt).toEqual(expected.firstResponseDueAt);
    expect(row.resolutionDueAt).toEqual(expected.resolutionDueAt);
    expect(row.firstResponseAtRiskAt).toEqual(expected.firstResponseAtRiskAt);
    expect(row.resolutionAtRiskAt).toEqual(expected.resolutionAtRiskAt);
  });

  it('starts with firstResponseAt NULL in the database', async () => {
    const ticketId = await createHighTicket();
    const row = await testPrisma.ticket.findUniqueOrThrow({ where: { id: ticketId } });

    expect(row.firstResponseAt).toBeNull();
  });

  it('runs the full reporter -> agent -> agent first-response flow', async () => {
    const ticketId = await createHighTicket();

    // 1. The reporter comments on their own ticket: not a response.
    const reporterComment = await server.execute(
      ADD_COMMENT,
      { ticketId, content: 'Any update on this?' },
      reporter.token,
    );
    expect(reporterComment.errors).toBeUndefined();

    const afterReporter = await testPrisma.ticket.findUniqueOrThrow({ where: { id: ticketId } });
    expect(afterReporter.firstResponseAt).toBeNull();

    // 2. The agent replies: the first-response clock stops.
    const agentComment = await server.execute<{ addComment: { id: string } }>(
      ADD_COMMENT,
      { ticketId, content: 'Looking into it now.' },
      agent.token,
    );
    expect(agentComment.errors).toBeUndefined();

    const afterAgent = await testPrisma.ticket.findUniqueOrThrow({ where: { id: ticketId } });
    expect(afterAgent.firstResponseAt).not.toBeNull();

    // It should line up with the comment that triggered it.
    const commentRow = await testPrisma.comment.findUniqueOrThrow({
      where: { id: agentComment.data?.addComment.id ?? '' },
    });
    const drift = Math.abs(
      (afterAgent.firstResponseAt?.getTime() ?? 0) - commentRow.createdAt.getTime(),
    );
    expect(drift).toBeLessThan(5000);

    const stampedAt = afterAgent.firstResponseAt;

    // 3. A second agent comment must not move the stamp.
    const secondAgentComment = await server.execute(
      ADD_COMMENT,
      { ticketId, content: 'Deployed a fix.' },
      agent.token,
    );
    expect(secondAgentComment.errors).toBeUndefined();

    const afterSecond = await testPrisma.ticket.findUniqueOrThrow({ where: { id: ticketId } });
    expect(afterSecond.firstResponseAt).toEqual(stampedAt);

    // 4. The API reports the first-response SLA as met, and it stays met.
    const query = await server.execute<{
      ticket: { firstResponseAt: string; sla: { firstResponseState: string } };
    }>(GET_TICKET_SLA, { id: ticketId }, agent.token);

    expect(query.errors).toBeUndefined();
    expect(query.data?.ticket.sla.firstResponseState).toBe('MET');
    expect(query.data?.ticket.firstResponseAt).not.toBeNull();

    const again = await server.execute<{ ticket: { sla: { firstResponseState: string } } }>(
      GET_TICKET_SLA,
      { id: ticketId },
      agent.token,
    );
    expect(again.data?.ticket.sla.firstResponseState).toBe('MET');
  });

  it('keeps the first response MET even when the deadline has long passed', async () => {
    const ticketId = await createHighTicket();

    // Force the deadline into the past while leaving the response recorded.
    await server.execute(ADD_COMMENT, { ticketId, content: 'On it.' }, agent.token);
    await testPrisma.ticket.update({
      where: { id: ticketId },
      data: {
        firstResponseDueAt: new Date('2020-01-01T00:00:00.000Z'),
        firstResponseAtRiskAt: new Date('2020-01-01T00:00:00.000Z'),
      },
    });

    const query = await server.execute<{ ticket: { sla: { firstResponseState: string } } }>(
      GET_TICKET_SLA,
      { id: ticketId },
      agent.token,
    );

    // The clock stopped when the reply landed; a passed deadline cannot undo it.
    expect(query.data?.ticket.sla.firstResponseState).toBe('MET');
  });

  it('does not stamp a first response when only the reporter comments', async () => {
    const ticketId = await createHighTicket();

    await server.execute(ADD_COMMENT, { ticketId, content: 'Bumping this.' }, reporter.token);
    await server.execute(ADD_COMMENT, { ticketId, content: 'Still broken.' }, reporter.token);

    const row = await testPrisma.ticket.findUniqueOrThrow({ where: { id: ticketId } });
    expect(row.firstResponseAt).toBeNull();

    const comments = await testPrisma.comment.count({ where: { ticketId } });
    expect(comments).toBe(2);
  });
});
