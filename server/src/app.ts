import type { PrismaClient } from '@prisma/client';
import { createSchema, createYoga, maskError } from 'graphql-yoga';
import { env } from './config/env.ts';
import { buildContext } from './graphql/context.ts';
import { isApiError } from './graphql/errors.ts';
import { resolvers } from './graphql/resolvers/index.ts';
import { loadTypeDefs } from './graphql/schema/index.ts';

export interface CreateAppOptions {
  /** Overrides the default client — integration tests point this at db_test. */
  readonly prisma?: PrismaClient;
  /** Fixes the request clock; used by tests that assert on SLA state. */
  readonly now?: () => Date;
}

/**
 * Builds the Yoga instance.
 *
 * Extracted from `server.ts` so integration tests drive the exact same wiring —
 * schema, resolvers, context and error mask — through `yoga.fetch()` rather
 * than a reimplementation that could drift from production.
 */
// The return type is inferred: Yoga's generics are resolved from the options
// object, and restating them here only over-constrains the context type.
export async function createApp(options: CreateAppOptions = {}) {
  const typeDefs = await loadTypeDefs();
  const isProduction = env.NODE_ENV === 'production';

  return createYoga({
    schema: createSchema({ typeDefs, resolvers }),
    graphqlEndpoint: '/graphql',
    landingPage: false,
    context: ({ request }) =>
      buildContext({
        request,
        ...(options.prisma === undefined ? {} : { prisma: options.prisma }),
        ...(options.now === undefined ? {} : { now: options.now() }),
      }),
    maskedErrors: {
      /**
       * Errors this API raised deliberately are already safe to show and must
       * keep their `extensions.code`, so they pass straight through. Anything
       * else is an internal detail (a Prisma failure, a TypeError) and is
       * masked in production while staying visible in development.
       */
      maskError: (error, message, isDev) =>
        isApiError(error) ? error : maskError(error, message, isDev ?? !isProduction),
    },
  });
}
