import { DateTime } from 'luxon';
import { requireAgent, requireUser } from '../../auth/guards.ts';
import type { Resolvers } from '../../generated/graphql.ts';
import { ticketNotFound, userNotFound } from '../errors.ts';
import { toPublicUser } from '../../services/auth/index.ts';
import {
  addComment,
  assignTicket,
  changeTicketStatus,
  createTicket,
  getTicket,
  listTickets,
  resolveTicket,
  toSlaView,
  type TicketDeps,
} from '../../services/ticket/index.ts';
import {
  addCommentSchema,
  assignTicketSchema,
  changeTicketStatusSchema,
  createTicketSchema,
  parseInput,
  resolveTicketSchema,
  ticketFiltersSchema,
} from '../../validation/index.ts';
import type { GraphQLContext } from '../context.ts';

/** Assembles the ticket service's collaborators from the request context. */
async function ticketDeps(ctx: GraphQLContext): Promise<TicketDeps> {
  return {
    prisma: ctx.prisma,
    tickets: ctx.repositories.tickets,
    users: ctx.repositories.users,
    now: ctx.now,
    businessHours: await ctx.businessHours(),
  };
}

/** Serialises a nullable Date as an ISO 8601 string. */
function iso(date: Date | null): string | null {
  return date === null ? null : date.toISOString();
}

/**
 * Thin resolvers: validate the input, apply the guard, delegate to the service.
 * No business rules and no date arithmetic live here.
 */
export const ticketResolvers: Pick<
  Resolvers,
  'Query' | 'Mutation' | 'Ticket' | 'Comment' | 'Holiday'
> = {
  Query: {
    tickets: async (_parent, args, ctx) => {
      const viewer = requireUser(ctx);
      const filters = parseInput(ticketFiltersSchema, args);

      const page = await listTickets(
        {
          viewer,
          status: filters.status,
          priority: filters.priority,
          assigneeId: filters.assigneeId,
          slaState: filters.slaState,
          take: filters.take ?? null,
          cursor: filters.cursor,
          sortBy: filters.sortBy ?? 'CREATED_AT',
          sortDirection: filters.sortDirection ?? 'DESC',
        },
        await ticketDeps(ctx),
      );

      return {
        nodes: page.nodes,
        pageInfo: { hasNextPage: page.hasNextPage, endCursor: page.endCursor },
      };
    },

    ticket: async (_parent, args, ctx) => {
      const viewer = requireUser(ctx);
      return getTicket(args.id, viewer, await ticketDeps(ctx));
    },

    dashboard: async (_parent, _args, ctx) => {
      const viewer = requireUser(ctx);
      return ctx.repositories.tickets.dashboard(viewer, ctx.now);
    },

    holidays: async (_parent, _args, ctx) => {
      requireUser(ctx);
      return ctx.repositories.holidays.listAll();
    },
  },

  Mutation: {
    createTicket: async (_parent, args, ctx) => {
      const viewer = requireUser(ctx);
      const input = parseInput(createTicketSchema, args);
      return createTicket(input, viewer, await ticketDeps(ctx));
    },

    assignTicket: async (_parent, args, ctx) => {
      requireAgent(ctx);
      const input = parseInput(assignTicketSchema, args);
      return assignTicket(input, await ticketDeps(ctx));
    },

    changeTicketStatus: async (_parent, args, ctx) => {
      requireAgent(ctx);
      const input = parseInput(changeTicketStatusSchema, args);
      return changeTicketStatus(input, await ticketDeps(ctx));
    },

    resolveTicket: async (_parent, args, ctx) => {
      requireAgent(ctx);
      const input = parseInput(resolveTicketSchema, args);
      return resolveTicket(input.ticketId, await ticketDeps(ctx));
    },

    addComment: async (_parent, args, ctx) => {
      const viewer = requireUser(ctx);
      const input = parseInput(addCommentSchema, args);
      return addComment(input, viewer, await ticketDeps(ctx));
    },
  },

  Ticket: {
    createdAt: (ticket) => ticket.createdAt.toISOString(),
    firstResponseAt: (ticket) => iso(ticket.firstResponseAt),
    resolvedAt: (ticket) => iso(ticket.resolvedAt),
    closedAt: (ticket) => iso(ticket.closedAt),

    // Batched through DataLoader: a page of 20 tickets costs one user query,
    // not 40.
    reporter: async (ticket, _args, ctx) => {
      const user = await ctx.loaders.userById.load(ticket.reporterId);
      if (user === null) throw userNotFound(ticket.reporterId);
      return toPublicUser(user);
    },

    assignee: async (ticket, _args, ctx) => {
      if (ticket.assigneeId === null) return null;
      const user = await ctx.loaders.userById.load(ticket.assigneeId);
      return user === null ? null : toPublicUser(user);
    },

    comments: async (ticket, _args, ctx) => ctx.loaders.commentsByTicketId.load(ticket.id),

    // Derived entirely from columns already on the row — no database access.
    sla: async (ticket, _args, ctx) => toSlaView(ticket, ctx.now, await ctx.businessHours()),
  },

  Comment: {
    createdAt: (comment) => comment.createdAt.toISOString(),

    author: async (comment, _args, ctx) => {
      const user = await ctx.loaders.userById.load(comment.authorId);
      if (user === null) throw userNotFound(comment.authorId);
      return toPublicUser(user);
    },

    ticket: async (comment, _args, ctx) => {
      const ticket = await ctx.repositories.tickets.findById(comment.ticketId);
      if (ticket === null) throw ticketNotFound(comment.ticketId);
      return ticket;
    },
  },

  Holiday: {
    // Stored as a DATE column, so it is rendered as a calendar day rather than
    // an instant — reading it in UTC, which is how the driver materialises it.
    date: (holiday) =>
      DateTime.fromJSDate(holiday.date, { zone: 'utc' }).toFormat('yyyy-MM-dd'),
  },
};
