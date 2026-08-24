import type { Resolvers } from '../../generated/graphql.ts';
import { healthResolvers } from './health.ts';
import { ticketResolvers } from './ticket.ts';
import { userResolvers } from './user.ts';

/** Root resolver map, assembled from the per-feature resolver modules. */
export const resolvers: Resolvers = {
  Query: {
    ...healthResolvers.Query,
    ...userResolvers.Query,
    ...ticketResolvers.Query,
  },
  Mutation: {
    ...userResolvers.Mutation,
    ...ticketResolvers.Mutation,
  },
  User: userResolvers.User,
  Ticket: ticketResolvers.Ticket,
  Comment: ticketResolvers.Comment,
  Holiday: ticketResolvers.Holiday,
};
