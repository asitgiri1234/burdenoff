import { createSchema, createYoga } from 'graphql-yoga';
import { env } from './config/env.ts';
import { resolvers } from './graphql/resolvers/index.ts';
import { loadTypeDefs } from './graphql/schema/index.ts';

const typeDefs = await loadTypeDefs();

const yoga = createYoga({
  schema: createSchema({ typeDefs, resolvers }),
  graphqlEndpoint: '/graphql',
  landingPage: false,
});

const server = Bun.serve({
  port: env.PORT,
  fetch: yoga.fetch,
});

console.log(`🚀 GraphQL ready at http://localhost:${server.port}/graphql`);
