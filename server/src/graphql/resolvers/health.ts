import type { Resolvers } from '../../generated/graphql.ts';

export const healthResolvers: Pick<Resolvers, 'Query'> = {
  Query: {
    health: () => 'ok',
  },
};
