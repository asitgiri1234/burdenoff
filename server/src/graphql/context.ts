import type { PrismaClient } from '@prisma/client';
import { env } from '../config/env.ts';
import { prisma as defaultPrisma } from '../db/prisma.ts';
import {
  createCommentRepository,
  type CommentRepository,
} from '../repositories/commentRepository.ts';
import {
  createHolidayRepository,
  type HolidayRepository,
} from '../repositories/holidayRepository.ts';
import {
  createTicketRepository,
  type TicketRepository,
} from '../repositories/ticketRepository.ts';
import {
  createUserRepository,
  type UserRepository,
  type UserRole,
} from '../repositories/userRepository.ts';
import { extractBearerToken, verifyToken } from '../services/auth/tokens.ts';
import { buildBusinessHoursContext, type BusinessHoursContext } from '../services/sla/index.ts';
import { createLoaders, type Loaders } from './loaders.ts';

/** The authenticated caller, or null for an anonymous request. */
export interface CurrentUser {
  readonly id: string;
  readonly role: UserRole;
}

export interface Repositories {
  readonly users: UserRepository;
  readonly tickets: TicketRepository;
  readonly comments: CommentRepository;
  readonly holidays: HolidayRepository;
}

export interface GraphQLContext {
  readonly prisma: PrismaClient;
  readonly currentUser: CurrentUser | null;
  readonly loaders: Loaders;
  readonly repositories: Repositories;
  /**
   * A single instant for the whole request, so every SLA state in one response
   * is judged against the same clock instead of drifting field by field.
   */
  readonly now: Date;
  /**
   * Business-hours context, memoised for the request. The holiday table is read
   * at most once no matter how many tickets a response touches.
   */
  businessHours(): Promise<BusinessHoursContext>;
}

export interface BuildContextArgs {
  readonly request: Request;
  readonly prisma?: PrismaClient;
  readonly now?: Date;
}

/**
 * Builds the per-request context.
 *
 * Authentication is best-effort: a missing, malformed or expired token simply
 * yields `currentUser: null`. It must never throw here — an anonymous request
 * is legitimate (the `me` query answers null for it), and failing at
 * context-build time would turn every such request into a 500 before any
 * resolver could decide whether auth was actually required.
 */
export async function buildContext({
  request,
  prisma = defaultPrisma,
  now = new Date(),
}: BuildContextArgs): Promise<GraphQLContext> {
  const repositories: Repositories = {
    users: createUserRepository(prisma),
    tickets: createTicketRepository(prisma),
    comments: createCommentRepository(prisma),
    holidays: createHolidayRepository(prisma),
  };

  const loaders = createLoaders({
    users: repositories.users,
    comments: repositories.comments,
  });

  // Memoised on the promise, so concurrent field resolvers share one query
  // rather than racing to issue their own.
  let businessHoursPromise: Promise<BusinessHoursContext> | null = null;

  return {
    prisma,
    currentUser: await resolveCurrentUser(request, repositories.users),
    loaders,
    repositories,
    now,
    businessHours(): Promise<BusinessHoursContext> {
      businessHoursPromise ??= loadBusinessHours(repositories.holidays);
      return businessHoursPromise;
    },
  };
}

async function loadBusinessHours(holidays: HolidayRepository): Promise<BusinessHoursContext> {
  const rows = await holidays.listAll();

  return buildBusinessHoursContext(
    rows.map((row) => row.date),
    {
      timezone: env.BUSINESS_TIMEZONE,
      startHour: env.BUSINESS_START_HOUR,
      endHour: env.BUSINESS_END_HOUR,
    },
  );
}

async function resolveCurrentUser(
  request: Request,
  users: UserRepository,
): Promise<CurrentUser | null> {
  const token = extractBearerToken(request.headers.get('authorization'));
  if (token === null) return null;

  const payload = await verifyToken(token);
  if (payload === null) return null;

  // The token is signed, but the user may have been deleted since it was
  // issued, so the role is re-read from the database rather than trusted blind.
  const user = await users.findById(payload.sub);
  if (user === null) return null;

  return { id: user.id, role: user.role };
}
