import { createSchema, createYoga, maskError } from 'graphql-yoga';
import { env } from './config/env.ts';
import { buildContext } from './graphql/context.ts';
import { isApiError } from './graphql/errors.ts';
import { resolvers } from './graphql/resolvers/index.ts';
import { loadTypeDefs } from './graphql/schema/index.ts';

const typeDefs = await loadTypeDefs();

const isProduction = env.NODE_ENV === 'production';

const yoga = createYoga({
  schema: createSchema({ typeDefs, resolvers }),
  graphqlEndpoint: '/graphql',
  landingPage: false,
  context: ({ request }) => buildContext({ request }),
  maskedErrors: {
    /**
     * Errors this API raised deliberately are already safe to show and must
     * keep their `extensions.code`, so they pass straight through. Anything
     * else is an internal detail (a Prisma failure, a TypeError) and is masked
     * in production while staying visible in development for debugging.
     */
    maskError: (error, message, isDev) =>
      isApiError(error) ? error : maskError(error, message, isDev ?? !isProduction),
  },
});

const server = Bun.serve({
  port: env.PORT,
  fetch: yoga.fetch,
});

console.log(`🚀 GraphQL ready at http://localhost:${server.port}/graphql`);
