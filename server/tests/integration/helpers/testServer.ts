import { createApp } from '../../../src/app.ts';
import { testPrisma } from './db.ts';

export interface GraphQLResponse<T = Record<string, unknown>> {
  data: T | null | undefined;
  errors?: {
    message: string;
    extensions?: Record<string, unknown>;
  }[];
  /** HTTP status, asserted where the spec cares (a typed error is still 200). */
  status: number;
}

export interface TestServer {
  execute<T = Record<string, unknown>>(
    query: string,
    variables?: Record<string, unknown>,
    token?: string,
  ): Promise<GraphQLResponse<T>>;
}

/**
 * Drives real GraphQL operations through the production Yoga instance
 * in-process via `yoga.fetch()`.
 *
 * No HTTP listener and no network: the request goes straight into the same
 * pipeline the deployed server uses — schema, resolvers, services, Prisma and
 * a real Postgres — which keeps the tests fast and deterministic while still
 * exercising the full stack end to end.
 */
export async function createTestServer(): Promise<TestServer> {
  const yoga = await createApp({ prisma: testPrisma });

  return {
    async execute<T = Record<string, unknown>>(
      query: string,
      variables?: Record<string, unknown>,
      token?: string,
    ): Promise<GraphQLResponse<T>> {
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (token !== undefined) headers['authorization'] = `Bearer ${token}`;

      const response = await yoga.fetch('http://localhost/graphql', {
        method: 'POST',
        headers,
        body: JSON.stringify({ query, variables }),
      });

      const body = (await response.json()) as Omit<GraphQLResponse<T>, 'status'>;

      return { ...body, status: response.status };
    },
  };
}

/** Reads `extensions.code` off the first error, if any. */
export function errorCode(response: GraphQLResponse): string | undefined {
  const code = response.errors?.[0]?.extensions?.['code'];
  return typeof code === 'string' ? code : undefined;
}
