import type { PrismaClient } from '@prisma/client';
import { prisma as defaultPrisma } from '../db/prisma.ts';
import {
  createUserRepository,
  type UserRepository,
  type UserRole,
} from '../repositories/userRepository.ts';
import { extractBearerToken, verifyToken } from '../services/auth/tokens.ts';
import { createLoaders, type Loaders } from './loaders.ts';

/** The authenticated caller, or null for an anonymous request. */
export interface CurrentUser {
  readonly id: string;
  readonly role: UserRole;
}

export interface GraphQLContext {
  readonly prisma: PrismaClient;
  readonly currentUser: CurrentUser | null;
  readonly loaders: Loaders;
  /** Repositories, exposed so resolvers and services share one instance. */
  readonly repositories: {
    readonly users: UserRepository;
  };
}

export interface BuildContextArgs {
  readonly request: Request;
  readonly prisma?: PrismaClient;
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
}: BuildContextArgs): Promise<GraphQLContext> {
  const users = createUserRepository(prisma);
  const loaders = createLoaders({ users });

  return {
    prisma,
    currentUser: await resolveCurrentUser(request, users),
    loaders,
    repositories: { users },
  };
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
