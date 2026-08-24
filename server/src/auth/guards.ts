import { forbidden, unauthorized } from '../graphql/errors.ts';
import type { CurrentUser, GraphQLContext } from '../graphql/context.ts';

/** A caller known to be authenticated. */
export type AuthenticatedUser = CurrentUser;

/** A caller known to be authenticated *and* to hold the AGENT role. */
export interface AgentUser extends CurrentUser {
  readonly role: 'AGENT';
}

/**
 * Requires an authenticated caller.
 *
 * Returns the user as a non-nullable value so resolvers get type-safe access
 * without a non-null assertion.
 */
export function requireUser(ctx: Pick<GraphQLContext, 'currentUser'>): AuthenticatedUser {
  if (ctx.currentUser === null) {
    throw unauthorized();
  }
  return ctx.currentUser;
}

/**
 * Requires an authenticated caller holding the AGENT role.
 *
 * Anonymous callers get UNAUTHORIZED (log in and try again); authenticated
 * reporters get FORBIDDEN (logging in again will not help).
 */
export function requireAgent(ctx: Pick<GraphQLContext, 'currentUser'>): AgentUser {
  const user = requireUser(ctx);

  if (user.role !== 'AGENT') {
    throw forbidden('Only agents can perform this action');
  }

  return { ...user, role: 'AGENT' };
}
