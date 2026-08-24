import type { Resolvers } from '../../generated/graphql.ts';
import { healthResolvers } from './health.ts';
import { userResolvers } from './user.ts';

/**
 * Root resolver map. Feature resolver modules are merged in here as they land
 * (tickets and comments in task 4).
 */
export const resolvers: Resolvers = {
  Query: {
    ...healthResolvers.Query,
    ...userResolvers.Query,
  },
  Mutation: {
    ...userResolvers.Mutation,
  },
  User: userResolvers.User,
};
