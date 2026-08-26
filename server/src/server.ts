import { createApp } from './app.ts';
import { env } from './config/env.ts';

const yoga = await createApp();

const server = Bun.serve({
  port: env.PORT,
  fetch: yoga.fetch,
});

console.log(`🚀 GraphQL ready at http://localhost:${server.port}/graphql`);
