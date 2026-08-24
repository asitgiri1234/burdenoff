import { requireUser } from '../../auth/guards.ts';
import { env } from '../../config/env.ts';
import {
  listVisibleUsers,
  login,
  register,
  toPublicUser,
  type AuthDeps,
} from '../../services/auth/index.ts';
import { loginSchema, parseInput, registerSchema } from '../../validation/index.ts';
import type { GraphQLContext } from '../context.ts';
import type { Resolvers } from '../../generated/graphql.ts';

/** Assembles the collaborators the auth service needs from the request context. */
function authDeps(ctx: GraphQLContext): AuthDeps {
  return {
    users: ctx.repositories.users,
    agentSignupCode: env.AGENT_SIGNUP_CODE,
  };
}

/**
 * Thin resolvers: validate the input, apply the guard, delegate to the service.
 * No business rules live here.
 */
export const userResolvers: Pick<Resolvers, 'Query' | 'Mutation' | 'User'> = {
  Query: {
    me: async (_parent, _args, ctx) => {
      if (ctx.currentUser === null) return null;

      const user = await ctx.loaders.userById.load(ctx.currentUser.id);
      return user === null ? null : toPublicUser(user);
    },

    users: async (_parent, args, ctx) => {
      const viewer = requireUser(ctx);
      return listVisibleUsers(viewer.role, args.role ?? null, authDeps(ctx));
    },
  },

  Mutation: {
    register: async (_parent, args, ctx) => {
      const input = parseInput(registerSchema, args);
      return register(input, authDeps(ctx));
    },

    login: async (_parent, args, ctx) => {
      const input = parseInput(loginSchema, args);
      return login(input, authDeps(ctx));
    },
  },

  User: {
    // Dates are stored and passed around as Date; the API contract is ISO 8601.
    createdAt: (parent) => parent.createdAt.toISOString(),
  },
};
