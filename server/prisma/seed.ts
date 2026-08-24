import { PrismaClient, UserRole } from '@prisma/client';
import {
  addBusinessMinutes,
  buildBusinessHoursContext,
  businessMinutesBetween,
  computeSlaTimestamps,
  type BusinessHoursContext,
  type Priority,
} from '../src/services/sla/index.ts';

const prisma = new PrismaClient();

const SEED_PASSWORD = 'password123';

const BUSINESS_TIMEZONE = process.env['BUSINESS_TIMEZONE'] ?? 'Asia/Kolkata';
const BUSINESS_START_HOUR = Number(process.env['BUSINESS_START_HOUR'] ?? 9);
const BUSINESS_END_HOUR = Number(process.env['BUSINESS_END_HOUR'] ?? 18);

interface SeedUser {
  name: string;
  email: string;
  role: UserRole;
}

const users: SeedUser[] = [
  { name: 'Ava Agent', email: 'agent@example.com', role: UserRole.AGENT },
  { name: 'Ben Agent', email: 'agent2@example.com', role: UserRole.AGENT },
  { name: 'Rhea Reporter', email: 'reporter@example.com', role: UserRole.REPORTER },
  { name: 'Raj Reporter', email: 'reporter2@example.com', role: UserRole.REPORTER },
];

const holidays: { date: string; name: string }[] = [
  { date: '2026-08-15', name: 'Independence Day' },
  { date: '2026-10-02', name: 'Gandhi Jayanti' },
];

/**
 * A `createdAt` exactly `elapsed` business minutes before `now`.
 *
 * Walks forward from a distant anchor rather than subtracting wall-clock time,
 * so the gap is measured in real business minutes — which is what decides the
 * SLA state. Backdating by calendar days would land unpredictably depending on
 * where the weekend fell.
 */
function businessMinutesAgo(
  elapsed: number,
  now: Date,
  ctx: BusinessHoursContext,
): Date {
  const anchor = new Date(now.getTime() - 120 * 24 * 60 * 60 * 1000);
  const available = businessMinutesBetween(anchor, now, ctx);

  if (available < elapsed) {
    throw new Error(`Anchor is too recent to back-date ${String(elapsed)} business minutes`);
  }

  return addBusinessMinutes(anchor, available - elapsed, ctx);
}

interface SeedTicket {
  title: string;
  description: string;
  priority: Priority;
  reporterEmail: string;
  assigneeEmail?: string;
  status?: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';
  /** Business minutes between creation and now — this is what sets SLA state. */
  elapsedBusinessMinutes: number;
  /** Thread seeded onto the ticket, in order. */
  comments?: { authorEmail: string; content: string }[];
  resolved?: boolean;
}

/**
 * Demo tickets chosen to exercise every SLA state.
 *
 * The elapsed figures are read against the policy budgets (URGENT 60/240,
 * HIGH 240/1440, MEDIUM 480/2880, LOW 1440/4320 business minutes, at-risk at
 * 75% of each).
 */
const tickets: SeedTicket[] = [
  {
    // 600 min elapsed vs a 60-minute first-response budget: firmly BREACHED.
    title: 'Checkout fails with a 500 on card payment',
    description:
      'Customers report a server error at the final step of checkout when paying by card. Reproducible on production.',
    priority: 'URGENT',
    reporterEmail: 'reporter@example.com',
    elapsedBusinessMinutes: 600,
  },
  {
    // 200 min elapsed: past the 180-minute at-risk mark, inside the 240 budget.
    title: 'Password reset emails are delayed by several hours',
    description:
      'Reset emails eventually arrive but take 2-4 hours, so users retry and lock themselves out.',
    priority: 'HIGH',
    reporterEmail: 'reporter2@example.com',
    elapsedBusinessMinutes: 200,
  },
  {
    // 60 min elapsed against a 480-minute budget: comfortably ON_TRACK.
    title: 'Export to CSV drops the last column',
    description: 'The generated CSV is missing the "Owner" column that appears in the UI table.',
    priority: 'MEDIUM',
    reporterEmail: 'reporter@example.com',
    elapsedBusinessMinutes: 60,
  },
  {
    // Answered and resolved, so both clocks are frozen at MET.
    title: 'Dark mode toggle resets after a page reload',
    description: 'Selecting dark mode works, but the preference is lost when the page reloads.',
    priority: 'LOW',
    reporterEmail: 'reporter2@example.com',
    assigneeEmail: 'agent@example.com',
    status: 'RESOLVED',
    elapsedBusinessMinutes: 300,
    resolved: true,
    comments: [
      {
        authorEmail: 'reporter2@example.com',
        content: 'Happens in both Chrome and Firefox, on desktop only.',
      },
      {
        authorEmail: 'agent@example.com',
        content: 'Thanks — reproduced. The preference was never being written to localStorage.',
      },
      {
        authorEmail: 'agent@example.com',
        content: 'Fix deployed in 2.14.1. Please confirm when you get a chance.',
      },
    ],
  },
  {
    title: 'Add bulk actions to the ticket list',
    description: 'Agents would like to close or reassign several tickets at once.',
    priority: 'LOW',
    reporterEmail: 'reporter@example.com',
    assigneeEmail: 'agent2@example.com',
    status: 'IN_PROGRESS',
    elapsedBusinessMinutes: 120,
    comments: [
      {
        authorEmail: 'agent2@example.com',
        content: 'Picking this up — starting with multi-select on the list view.',
      },
    ],
  },
  {
    title: 'Typo on the billing settings page',
    description: 'The heading reads "Biling" instead of "Billing".',
    priority: 'LOW',
    reporterEmail: 'reporter2@example.com',
    assigneeEmail: 'agent@example.com',
    status: 'CLOSED',
    elapsedBusinessMinutes: 900,
    resolved: true,
    comments: [{ authorEmail: 'agent@example.com', content: 'Fixed and shipped.' }],
  },
];

async function main(): Promise<void> {
  const now = new Date();

  // Idempotent: wipe in dependency order so re-running gives the same result.
  await prisma.comment.deleteMany();
  await prisma.ticket.deleteMany();
  await prisma.holiday.deleteMany();
  await prisma.user.deleteMany();

  // argon2id is Bun's default for Bun.password.hash.
  const passwordHash = await Bun.password.hash(SEED_PASSWORD, 'argon2id');

  const usersByEmail = new Map<string, { id: string }>();
  for (const user of users) {
    const created = await prisma.user.create({ data: { ...user, passwordHash } });
    usersByEmail.set(user.email, created);
  }
  console.log(`Seeded ${String(users.length)} users (password: ${SEED_PASSWORD})`);

  for (const holiday of holidays) {
    // @db.Date columns store midnight UTC; build the date that way explicitly.
    await prisma.holiday.create({
      data: { date: new Date(`${holiday.date}T00:00:00.000Z`), name: holiday.name },
    });
  }
  console.log(`Seeded ${String(holidays.length)} holidays`);

  // The same context the API builds per request, from the rows just seeded.
  const businessHours = buildBusinessHoursContext(
    holidays.map((holiday) => new Date(`${holiday.date}T00:00:00.000Z`)),
    {
      timezone: BUSINESS_TIMEZONE,
      startHour: BUSINESS_START_HOUR,
      endHour: BUSINESS_END_HOUR,
    },
  );

  const requireUser = (email: string): { id: string } => {
    const user = usersByEmail.get(email);
    if (user === undefined) throw new Error(`Seed user not found: ${email}`);
    return user;
  };

  for (const spec of tickets) {
    const createdAt = businessMinutesAgo(spec.elapsedBusinessMinutes, now, businessHours);

    // Deadlines come from the real SLA engine, exactly as createTicket does.
    const sla = computeSlaTimestamps(createdAt, spec.priority, businessHours);

    const reporter = requireUser(spec.reporterEmail);
    const assignee = spec.assigneeEmail === undefined ? null : requireUser(spec.assigneeEmail);

    const ticket = await prisma.ticket.create({
      data: {
        title: spec.title,
        description: spec.description,
        priority: spec.priority,
        status: spec.status ?? 'OPEN',
        reporterId: reporter.id,
        assigneeId: assignee?.id ?? null,
        createdAt,
        firstResponseDueAt: sla.firstResponseDueAt,
        resolutionDueAt: sla.resolutionDueAt,
        firstResponseAtRiskAt: sla.firstResponseAtRiskAt,
        resolutionAtRiskAt: sla.resolutionAtRiskAt,
      },
    });

    // Comments are spaced through the elapsed window so the thread reads in
    // order and the first agent reply lands at a plausible moment.
    let firstResponseAt: Date | null = null;
    const thread = spec.comments ?? [];

    for (const [index, comment] of thread.entries()) {
      const author = requireUser(comment.authorEmail);
      const offset = Math.floor(
        (spec.elapsedBusinessMinutes * (index + 1)) / (thread.length + 1),
      );
      const commentedAt = addBusinessMinutes(createdAt, offset, businessHours);

      await prisma.comment.create({
        data: {
          ticketId: ticket.id,
          authorId: author.id,
          content: comment.content,
          createdAt: commentedAt,
        },
      });

      // Same rule the service applies: the clock stops on the first reply from
      // somebody other than the reporter.
      if (firstResponseAt === null && author.id !== reporter.id) {
        firstResponseAt = commentedAt;
      }
    }

    const resolvedAt =
      spec.resolved === true
        ? addBusinessMinutes(createdAt, spec.elapsedBusinessMinutes, businessHours)
        : null;

    if (firstResponseAt !== null || resolvedAt !== null) {
      await prisma.ticket.update({
        where: { id: ticket.id },
        data: {
          firstResponseAt,
          resolvedAt,
          closedAt: spec.status === 'CLOSED' ? resolvedAt : null,
        },
      });
    }
  }

  console.log(`Seeded ${String(tickets.length)} tickets across all SLA states`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    console.error('Seed failed:', error);
    await prisma.$disconnect();
    process.exit(1);
  });
