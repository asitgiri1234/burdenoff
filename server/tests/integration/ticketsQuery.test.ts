import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { env } from '../../src/config/env.ts';
import {
  addBusinessMinutes,
  buildBusinessHoursContext,
  businessMinutesBetween,
  computeSlaTimestamps,
  type BusinessHoursContext,
  type Priority,
} from '../../src/services/sla/index.ts';
import { disconnectDatabase, resetDatabase, testPrisma } from './helpers/db.ts';
import { createTestUser, type TestUser } from './helpers/factories.ts';
import { createTestServer, type TestServer } from './helpers/testServer.ts';

const LIST = /* GraphQL */ `
  query (
    $status: TicketStatus
    $priority: Priority
    $assigneeId: ID
    $slaState: SLAState
    $take: Int
    $cursor: String
    $sortBy: TicketSortField
    $sortDirection: SortDirection
  ) {
    tickets(
      status: $status
      priority: $priority
      assigneeId: $assigneeId
      slaState: $slaState
      take: $take
      cursor: $cursor
      sortBy: $sortBy
      sortDirection: $sortDirection
    ) {
      nodes {
        id
        title
        priority
        status
        sla {
          firstResponseState
          resolutionState
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

const DASHBOARD = /* GraphQL */ `
  query {
    dashboard {
      openTickets
      inProgressTickets
      resolvedTickets
      atRiskTickets
      breachedTickets
    }
  }
`;

let server: TestServer;
let reporter: TestUser;
let agent: TestUser;
let businessHours: BusinessHoursContext;

interface Fixture {
  title: string;
  priority: Priority;
  status?: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';
  /** Business minutes between creation and now — this decides the SLA state. */
  elapsed: number;
  assigned?: boolean;
  answered?: boolean;
  resolved?: boolean;
}

/**
 * The eight fixtures below, read against the policy budgets
 * (URGENT 60/240, HIGH 240/1440, MEDIUM 480/2880, LOW 1440/4320 business
 * minutes, at-risk at 75%):
 *
 *   1 URGENT  600 elapsed -> both clocks BREACHED
 *   2 URGENT  300 elapsed -> both clocks BREACHED
 *   3 HIGH    200 elapsed -> first response AT_RISK  (180 < 200 <= 240)
 *   4 HIGH     10 elapsed -> ON_TRACK
 *   5 MEDIUM   60 elapsed -> ON_TRACK
 *   6 MEDIUM  120 elapsed -> ON_TRACK, assigned + IN_PROGRESS
 *   7 LOW      30 elapsed -> ON_TRACK
 *   8 LOW     100 elapsed -> answered + resolved -> MET
 */
const fixtures: Fixture[] = [
  { title: 'Breached urgent one', priority: 'URGENT', elapsed: 600 },
  { title: 'Breached urgent two', priority: 'URGENT', elapsed: 300 },
  { title: 'At risk high', priority: 'HIGH', elapsed: 200 },
  { title: 'Fresh high', priority: 'HIGH', elapsed: 10 },
  { title: 'Fresh medium', priority: 'MEDIUM', elapsed: 60 },
  {
    title: 'Assigned medium',
    priority: 'MEDIUM',
    elapsed: 120,
    status: 'IN_PROGRESS',
    assigned: true,
  },
  { title: 'Fresh low', priority: 'LOW', elapsed: 30 },
  {
    title: 'Done low',
    priority: 'LOW',
    elapsed: 100,
    status: 'RESOLVED',
    answered: true,
    resolved: true,
  },
];

/** A createdAt exactly `elapsed` business minutes before `now`. */
function businessMinutesAgo(elapsed: number, now: Date, ctx: BusinessHoursContext): Date {
  const anchor = new Date(now.getTime() - 120 * 24 * 60 * 60 * 1000);
  const available = businessMinutesBetween(anchor, now, ctx);
  return addBusinessMinutes(anchor, available - elapsed, ctx);
}

/**
 * Inserts the fixtures directly, with deadlines from the real SLA engine.
 *
 * Written through Prisma rather than the createTicket mutation because the
 * mutation always stamps `createdAt = now`, and these tests need controlled
 * back-dating to produce breached and at-risk rows.
 */
async function seedFixtures(): Promise<void> {
  const now = new Date();

  for (const fixture of fixtures) {
    const createdAt = businessMinutesAgo(fixture.elapsed, now, businessHours);
    const sla = computeSlaTimestamps(createdAt, fixture.priority, businessHours);

    await testPrisma.ticket.create({
      data: {
        title: fixture.title,
        description: 'Seeded fixture',
        priority: fixture.priority,
        status: fixture.status ?? 'OPEN',
        reporterId: reporter.user.id,
        assigneeId: fixture.assigned === true ? agent.user.id : null,
        createdAt,
        firstResponseAt: fixture.answered === true ? createdAt : null,
        resolvedAt: fixture.resolved === true ? now : null,
        firstResponseDueAt: sla.firstResponseDueAt,
        resolutionDueAt: sla.resolutionDueAt,
        firstResponseAtRiskAt: sla.firstResponseAtRiskAt,
        resolutionAtRiskAt: sla.resolutionAtRiskAt,
      },
    });
  }
}

beforeAll(async () => {
  server = await createTestServer();
  businessHours = buildBusinessHoursContext([], {
    timezone: env.BUSINESS_TIMEZONE,
    startHour: env.BUSINESS_START_HOUR,
    endHour: env.BUSINESS_END_HOUR,
  });
});

afterAll(async () => {
  await disconnectDatabase();
});

beforeEach(async () => {
  await resetDatabase();
  reporter = await createTestUser({ role: 'REPORTER' });
  agent = await createTestUser({ role: 'AGENT' });
  await seedFixtures();
});

interface ListResult {
  tickets: {
    nodes: { id: string; title: string; priority: string; status: string }[];
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
}

describe('ticket filtering', () => {
  it('returns every ticket to an agent by default', async () => {
    const response = await server.execute<ListResult>(LIST, { take: 50 }, agent.token);

    expect(response.errors).toBeUndefined();
    expect(response.data?.tickets.nodes).toHaveLength(fixtures.length);
  });

  it('filters by status', async () => {
    const response = await server.execute<ListResult>(
      LIST,
      { status: 'IN_PROGRESS', take: 50 },
      agent.token,
    );

    expect(response.data?.tickets.nodes).toHaveLength(1);
    expect(response.data?.tickets.nodes[0]?.title).toBe('Assigned medium');
  });

  it('filters by priority', async () => {
    const response = await server.execute<ListResult>(
      LIST,
      { priority: 'URGENT', take: 50 },
      agent.token,
    );

    expect(response.data?.tickets.nodes).toHaveLength(2);
    expect(response.data?.tickets.nodes.every((n) => n.priority === 'URGENT')).toBe(true);
  });

  it('filters by assignee', async () => {
    const response = await server.execute<ListResult>(
      LIST,
      { assigneeId: agent.user.id, take: 50 },
      agent.token,
    );

    expect(response.data?.tickets.nodes).toHaveLength(1);
    expect(response.data?.tickets.nodes[0]?.title).toBe('Assigned medium');
  });

  it('combines filters', async () => {
    const response = await server.execute<ListResult>(
      LIST,
      { priority: 'MEDIUM', status: 'OPEN', take: 50 },
      agent.token,
    );

    expect(response.data?.tickets.nodes).toHaveLength(1);
    expect(response.data?.tickets.nodes[0]?.title).toBe('Fresh medium');
  });
});

describe('SLA state filtering happens in SQL', () => {
  it('returns exactly the tickets whose deadlines have passed', async () => {
    const response = await server.execute<ListResult>(
      LIST,
      { slaState: 'BREACHED', take: 50 },
      agent.token,
    );

    const titles = response.data?.tickets.nodes.map((n) => n.title).sort() ?? [];
    expect(titles).toEqual(['Breached urgent one', 'Breached urgent two']);

    // Cross-check the filter against the raw rows: every returned ticket really
    // has a passed deadline on a clock that never stopped.
    const now = new Date();
    for (const node of response.data?.tickets.nodes ?? []) {
      const row = await testPrisma.ticket.findUniqueOrThrow({ where: { id: node.id } });
      const breached =
        (row.firstResponseAt === null && row.firstResponseDueAt < now) ||
        (row.resolvedAt === null && row.resolutionDueAt < now);
      expect(breached).toBe(true);
    }
  });

  it('returns the at-risk ticket and excludes breached ones', async () => {
    const response = await server.execute<ListResult>(
      LIST,
      { slaState: 'AT_RISK', take: 50 },
      agent.token,
    );

    const titles = response.data?.tickets.nodes.map((n) => n.title) ?? [];
    expect(titles).toEqual(['At risk high']);
  });

  it('returns MET only for tickets with both clocks stopped', async () => {
    const response = await server.execute<ListResult>(
      LIST,
      { slaState: 'MET', take: 50 },
      agent.token,
    );

    const titles = response.data?.tickets.nodes.map((n) => n.title) ?? [];
    expect(titles).toEqual(['Done low']);
  });

  it('partitions every ticket across the four states exactly once', async () => {
    const states = ['ON_TRACK', 'AT_RISK', 'BREACHED', 'MET'] as const;
    const seen: string[] = [];

    for (const slaState of states) {
      const response = await server.execute<ListResult>(LIST, { slaState, take: 50 }, agent.token);
      seen.push(...(response.data?.tickets.nodes.map((n) => n.id) ?? []));
    }

    // No ticket may match two states, and none may fall through the cracks.
    expect(new Set(seen).size).toBe(fixtures.length);
    expect(seen).toHaveLength(fixtures.length);
  });
});

describe('cursor pagination', () => {
  it('returns non-overlapping pages with correct hasNextPage', async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;

    for (;;) {
      const response: { data?: ListResult | null } = await server.execute<ListResult>(
        LIST,
        { take: 3, sortBy: 'CREATED_AT', sortDirection: 'ASC', cursor },
        agent.token,
      );

      const page = response.data?.tickets;
      expect(page).toBeDefined();
      if (page === undefined) break;

      seen.push(...page.nodes.map((n) => n.id));
      pages += 1;

      if (!page.pageInfo.hasNextPage) {
        // 8 fixtures at 3 per page: 3 + 3 + 2.
        expect(page.nodes).toHaveLength(2);
        break;
      }

      expect(page.nodes).toHaveLength(3);
      cursor = page.pageInfo.endCursor;
      expect(cursor).not.toBeNull();
    }

    expect(pages).toBe(3);
    expect(seen).toHaveLength(fixtures.length);
    expect(new Set(seen).size).toBe(fixtures.length);
  });

  it('returns an empty page with a null endCursor past the end', async () => {
    const last = await server.execute<ListResult>(
      LIST,
      { take: 50, sortBy: 'CREATED_AT', sortDirection: 'ASC' },
      agent.token,
    );
    expect(last.data?.tickets.pageInfo.hasNextPage).toBe(false);

    // Following the final cursor yields nothing, and an empty page carries no
    // cursor to follow.
    const beyond = await server.execute<ListResult>(
      LIST,
      {
        take: 50,
        sortBy: 'CREATED_AT',
        sortDirection: 'ASC',
        cursor: last.data?.tickets.pageInfo.endCursor,
      },
      agent.token,
    );

    expect(beyond.data?.tickets.nodes).toHaveLength(0);
    expect(beyond.data?.tickets.pageInfo.hasNextPage).toBe(false);
    expect(beyond.data?.tickets.pageInfo.endCursor).toBeNull();
  });

  it('clamps take above the maximum', async () => {
    const response = await server.execute<ListResult>(LIST, { take: 5000 }, agent.token);
    expect(response.errors).toBeUndefined();
    expect(response.data?.tickets.nodes).toHaveLength(fixtures.length);
  });

  it('paginates by priority using the enum keyset', async () => {
    const first = await server.execute<ListResult>(
      LIST,
      { take: 3, sortBy: 'PRIORITY', sortDirection: 'DESC' },
      agent.token,
    );
    expect(first.data?.tickets.nodes).toHaveLength(3);
    // URGENT sorts highest, so both urgent tickets lead.
    expect(first.data?.tickets.nodes.slice(0, 2).map((n) => n.priority)).toEqual([
      'URGENT',
      'URGENT',
    ]);

    const second = await server.execute<ListResult>(
      LIST,
      {
        take: 3,
        sortBy: 'PRIORITY',
        sortDirection: 'DESC',
        cursor: first.data?.tickets.pageInfo.endCursor,
      },
      agent.token,
    );

    const firstIds = new Set(first.data?.tickets.nodes.map((n) => n.id) ?? []);
    const overlap = (second.data?.tickets.nodes ?? []).filter((n) => firstIds.has(n.id));
    expect(overlap).toHaveLength(0);
  });
});

describe('dashboard', () => {
  it('counts match the seeded data', async () => {
    const response = await server.execute<{
      dashboard: {
        openTickets: number;
        inProgressTickets: number;
        resolvedTickets: number;
        atRiskTickets: number;
        breachedTickets: number;
      };
    }>(DASHBOARD, {}, agent.token);

    expect(response.errors).toBeUndefined();
    expect(response.data?.dashboard).toEqual({
      openTickets: 6,
      inProgressTickets: 1,
      resolvedTickets: 1,
      atRiskTickets: 1,
      breachedTickets: 2,
    });
  });

  it('scopes counts to the caller`s visibility', async () => {
    const otherReporter = await createTestUser({ role: 'REPORTER' });

    const response = await server.execute<{
      dashboard: { openTickets: number; breachedTickets: number };
    }>(DASHBOARD, {}, otherReporter.token);

    // This reporter has no tickets of their own.
    expect(response.data?.dashboard.openTickets).toBe(0);
    expect(response.data?.dashboard.breachedTickets).toBe(0);
  });
});
