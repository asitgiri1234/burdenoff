import type { Resolvers } from '../../generated/graphql.ts';
import { healthResolvers } from './health.ts';

/**
 * Root resolver map. Feature resolver modules are merged in here as they land
 * (auth in task 2, tickets in task 3, SLA in task 4).
 */
export const resolvers: Resolvers = {
  Query: {
    ...healthResolvers.Query,
  },
};
