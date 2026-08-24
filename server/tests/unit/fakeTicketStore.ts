import type {
  DashboardCounts,
  ListTicketsArgs,
  TicketPage,
  TicketRecord,
  TicketRepository,
  Viewer,
} from '../../src/repositories/ticketRepository.ts';
import {
  clampTake,
  decodeCursor,
  encodeCursor,
} from '../../src/repositories/ticketRepository.ts';
import type { CommentRecord } from '../../src/repositories/commentRepository.ts';
import type { TicketDeps } from '../../src/services/ticket/index.ts';

type TicketCreateArgs = { data: Record<string, unknown> };
type TicketUpdateArgs = { where: { id: string }; data: Record<string, unknown> };
type CommentCreateArgs = { data: Record<string, unknown> };

/**
 * In-memory stand-in for the slice of PrismaClient the ticket service uses.
 *
 * Only `ticket.create`, `ticket.update`, `comment.create` and `$transaction`
 * are touched by the service, so those are the only operations modelled. This
 * keeps the service tests free of a database while still exercising the real
 * code paths, including the transaction used for the first-response stamp.
 */
export class FakeTicketStore {
  readonly tickets = new Map<string, TicketRecord>();
  readonly comments: CommentRecord[] = [];
  private nextTicket = 1;
  private nextComment = 1;

  /** The PrismaClient-shaped facade handed to the service. */
  get prisma(): TicketDeps['prisma'] {
    const facade = {
      ticket: {
        create: ({ data }: TicketCreateArgs): Promise<TicketRecord> => {
          const row: TicketRecord = {
            id: `ticket-${String(this.nextTicket++)}`,
            title: String(data['title']),
            description: String(data['description']),
            priority: data['priority'] as TicketRecord['priority'],
            status: (data['status'] as TicketRecord['status'] | undefined) ?? 'OPEN',
            reporterId: String(data['reporterId']),
            assigneeId: (data['assigneeId'] as string | null | undefined) ?? null,
            createdAt: data['createdAt'] as Date,
            updatedAt: data['createdAt'] as Date,
            firstResponseAt: null,
            resolvedAt: null,
            closedAt: null,
            firstResponseDueAt: data['firstResponseDueAt'] as Date,
            resolutionDueAt: data['resolutionDueAt'] as Date,
            firstResponseAtRiskAt: data['firstResponseAtRiskAt'] as Date,
            resolutionAtRiskAt: data['resolutionAtRiskAt'] as Date,
          };
          this.tickets.set(row.id, row);
          return Promise.resolve(row);
        },

        update: ({ where, data }: TicketUpdateArgs): Promise<TicketRecord> => {
          const existing = this.tickets.get(where.id);
          if (existing === undefined) throw new Error(`No such ticket: ${where.id}`);

          const updated = { ...existing, ...data } as TicketRecord;
          this.tickets.set(updated.id, updated);
          return Promise.resolve(updated);
        },
      },

      comment: {
        create: ({ data }: CommentCreateArgs): Promise<CommentRecord> => {
          const row: CommentRecord = {
            id: `comment-${String(this.nextComment++)}`,
            ticketId: String(data['ticketId']),
            authorId: String(data['authorId']),
            content: String(data['content']),
            createdAt: (data['createdAt'] as Date | undefined) ?? new Date(),
          };
          this.comments.push(row);
          return Promise.resolve(row);
        },
      },

      // The service passes already-invoked promises, matching Prisma's array
      // form of $transaction.
      $transaction: (operations: readonly Promise<unknown>[]): Promise<unknown[]> =>
        Promise.all(operations),
    };

    return facade as unknown as TicketDeps['prisma'];
  }

  /** The TicketRepository port, backed by the same in-memory rows. */
  get repository(): TicketRepository {
    return {
      findById: (id: string): Promise<TicketRecord | null> =>
        Promise.resolve(this.tickets.get(id) ?? null),

      list: (args: ListTicketsArgs): Promise<TicketPage> => {
        const take = clampTake(args.take);

        let rows = [...this.tickets.values()].filter((ticket) =>
          args.viewer.role === 'AGENT' ? true : ticket.reporterId === args.viewer.id,
        );

        if (args.status != null) rows = rows.filter((t) => t.status === args.status);
        if (args.priority != null) rows = rows.filter((t) => t.priority === args.priority);
        if (args.assigneeId != null) rows = rows.filter((t) => t.assigneeId === args.assigneeId);

        const direction = args.sortDirection === 'ASC' ? 1 : -1;
        rows.sort((a, b) => {
          const delta = a.createdAt.getTime() - b.createdAt.getTime();
          return (delta !== 0 ? delta : a.id.localeCompare(b.id)) * direction;
        });

        if (args.cursor != null) {
          const decoded = decodeCursor(args.cursor);
          if (decoded !== null) {
            const index = rows.findIndex((row) => row.id === decoded.id);
            rows = index === -1 ? rows : rows.slice(index + 1);
          }
        }

        const hasNextPage = rows.length > take;
        const nodes = rows.slice(0, take);
        const last = nodes.at(-1);

        return Promise.resolve({
          nodes,
          hasNextPage,
          endCursor: last === undefined ? null : encodeCursor(last, args.sortBy),
        });
      },

      dashboard: (viewer: Viewer): Promise<DashboardCounts> => {
        const rows = [...this.tickets.values()].filter((ticket) =>
          viewer.role === 'AGENT' ? true : ticket.reporterId === viewer.id,
        );
        const count = (status: TicketRecord['status']): number =>
          rows.filter((row) => row.status === status).length;

        return Promise.resolve({
          openTickets: count('OPEN'),
          inProgressTickets: count('IN_PROGRESS'),
          resolvedTickets: count('RESOLVED'),
          atRiskTickets: 0,
          breachedTickets: 0,
        });
      },
    };
  }
}
