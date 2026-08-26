import type { Prisma, PrismaClient } from '@prisma/client';
import type { Priority } from '../services/sla/index.ts';
import type { TicketStatus } from '../services/ticket/statusMachine.ts';
import type { UserRole } from './userRepository.ts';

export type SlaStateFilter = 'ON_TRACK' | 'AT_RISK' | 'BREACHED' | 'MET';
export type TicketSortField = 'CREATED_AT' | 'PRIORITY' | 'FIRST_RESPONSE_DUE_AT';
export type SortDirection = 'ASC' | 'DESC';

/** A ticket row as the domain sees it. */
export interface TicketRecord {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly priority: Priority;
  readonly status: TicketStatus;
  readonly reporterId: string;
  readonly assigneeId: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly firstResponseAt: Date | null;
  readonly resolvedAt: Date | null;
  readonly closedAt: Date | null;
  readonly firstResponseDueAt: Date;
  readonly resolutionDueAt: Date;
  readonly firstResponseAtRiskAt: Date;
  readonly resolutionAtRiskAt: Date;
}

/** The caller, used to scope every query to what they may see. */
export interface Viewer {
  readonly id: string;
  readonly role: UserRole;
}

export interface TicketFilters {
  readonly status?: TicketStatus | null;
  readonly priority?: Priority | null;
  readonly assigneeId?: string | null;
  readonly slaState?: SlaStateFilter | null;
}

export interface ListTicketsArgs extends TicketFilters {
  readonly viewer: Viewer;
  readonly now: Date;
  /** Requested page size; clamped into [1, MAX_TAKE]. */
  readonly take?: number | null;
  readonly cursor?: string | null;
  readonly sortBy: TicketSortField;
  readonly sortDirection: SortDirection;
}

export interface TicketPage {
  readonly nodes: TicketRecord[];
  readonly hasNextPage: boolean;
  readonly endCursor: string | null;
}

export interface DashboardCounts {
  readonly openTickets: number;
  readonly inProgressTickets: number;
  readonly resolvedTickets: number;
  readonly atRiskTickets: number;
  readonly breachedTickets: number;
}

/** Default and maximum page sizes. */
export const DEFAULT_TAKE = 20;
export const MAX_TAKE = 100;

/** Priority values in ascending order, matching the Postgres enum declaration. */
const PRIORITY_ASC: readonly Priority[] = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];

/**
 * Visibility, expressed as a WHERE clause rather than a post-filter.
 *
 * Agents see every ticket; reporters see only what they reported. Doing this in
 * SQL is what keeps pagination honest — filtering after the fact would make
 * page sizes unpredictable and let a reporter's cursor skip over rows they were
 * never allowed to see.
 */
export function visibilityWhere(viewer: Viewer): Prisma.TicketWhereInput {
  return viewer.role === 'AGENT' ? {} : { reporterId: viewer.id };
}

/**
 * SLA state as a pure timestamp comparison.
 *
 * This is the payoff for materialising the four deadline columns at write time:
 * SLA state becomes an indexable SQL predicate, so filtering, sorting, counting
 * and cursor pagination all happen in one query. Deriving state in JavaScript
 * would mean loading every ticket into memory to answer "how many are
 * breached?", and would break cursor pagination outright — the database could
 * no longer tell how many rows a page should contain.
 */
export function slaStateWhere(state: SlaStateFilter, now: Date): Prisma.TicketWhereInput {
  // A clock is breached when its event never happened and its deadline passed.
  const breached: Prisma.TicketWhereInput = {
    OR: [
      { firstResponseAt: null, firstResponseDueAt: { lt: now } },
      { resolvedAt: null, resolutionDueAt: { lt: now } },
    ],
  };

  // Past the 75% mark on a clock that is still running.
  const atRisk: Prisma.TicketWhereInput = {
    OR: [
      { firstResponseAt: null, firstResponseAtRiskAt: { lt: now } },
      { resolvedAt: null, resolutionAtRiskAt: { lt: now } },
    ],
  };

  switch (state) {
    case 'BREACHED':
      return breached;

    case 'AT_RISK':
      // At risk but not yet breached — breach takes precedence.
      return { AND: [{ NOT: breached }, atRisk] };

    case 'ON_TRACK':
      // Neither breached nor at risk, with at least one clock still running.
      return {
        AND: [
          { NOT: breached },
          { NOT: atRisk },
          { OR: [{ firstResponseAt: null }, { resolvedAt: null }] },
        ],
      };

    case 'MET':
      // Both clocks stopped; state is frozen regardless of the deadlines.
      return { firstResponseAt: { not: null }, resolvedAt: { not: null } };
  }
}

/** Combines visibility, the plain column filters and the SLA predicate. */
export function buildTicketWhere(
  viewer: Viewer,
  filters: TicketFilters,
  now: Date,
): Prisma.TicketWhereInput {
  const clauses: Prisma.TicketWhereInput[] = [visibilityWhere(viewer)];

  if (filters.status != null) clauses.push({ status: filters.status });
  if (filters.priority != null) clauses.push({ priority: filters.priority });
  if (filters.assigneeId != null) clauses.push({ assigneeId: filters.assigneeId });
  if (filters.slaState != null) clauses.push(slaStateWhere(filters.slaState, now));

  return { AND: clauses };
}

/** Clamps a requested page size into [1, MAX_TAKE]. */
export function clampTake(take: number | null | undefined): number {
  if (take == null || !Number.isFinite(take)) return DEFAULT_TAKE;
  return Math.min(Math.max(Math.trunc(take), 1), MAX_TAKE);
}

/** The Prisma column a sort field maps to. */
function sortColumn(sortBy: TicketSortField): 'createdAt' | 'priority' | 'firstResponseDueAt' {
  switch (sortBy) {
    case 'CREATED_AT':
      return 'createdAt';
    case 'PRIORITY':
      return 'priority';
    case 'FIRST_RESPONSE_DUE_AT':
      return 'firstResponseDueAt';
  }
}

/** The sort value of a row, serialised for the cursor. */
function sortValueOf(ticket: TicketRecord, sortBy: TicketSortField): string {
  switch (sortBy) {
    case 'CREATED_AT':
      return ticket.createdAt.toISOString();
    case 'PRIORITY':
      return ticket.priority;
    case 'FIRST_RESPONSE_DUE_AT':
      return ticket.firstResponseDueAt.toISOString();
  }
}

/**
 * Cursors encode `${sortValue}|${id}` rather than an offset.
 *
 * Keyset pagination stays correct when rows are inserted or deleted between
 * pages, which an OFFSET would not — a new high-priority ticket would shift
 * every subsequent page and silently duplicate or skip rows.
 */
export function encodeCursor(ticket: TicketRecord, sortBy: TicketSortField): string {
  return Buffer.from(`${sortValueOf(ticket, sortBy)}|${ticket.id}`).toString('base64url');
}

export function decodeCursor(cursor: string): { sortValue: string; id: string } | null {
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    const separator = decoded.indexOf('|');
    if (separator <= 0) return null;

    const sortValue = decoded.slice(0, separator);
    const id = decoded.slice(separator + 1);
    if (id.length === 0) return null;

    return { sortValue, id };
  } catch {
    return null;
  }
}

/**
 * The keyset predicate: rows strictly after the cursor in the sort order.
 *
 * Priority is handled with `in` over the remaining enum values because Prisma
 * exposes no `lt`/`gt` for enum columns; with only four values the set is exact
 * and stays a single indexable condition.
 */
function cursorWhere(
  cursor: { sortValue: string; id: string },
  sortBy: TicketSortField,
  direction: SortDirection,
): Prisma.TicketWhereInput | null {
  const after = direction === 'ASC';

  if (sortBy === 'PRIORITY') {
    const index = PRIORITY_ASC.indexOf(cursor.sortValue as Priority);
    if (index === -1) return null;

    const beyond = after ? PRIORITY_ASC.slice(index + 1) : PRIORITY_ASC.slice(0, index);
    const tie: Prisma.TicketWhereInput = {
      priority: cursor.sortValue as Priority,
      id: after ? { gt: cursor.id } : { lt: cursor.id },
    };

    return beyond.length === 0 ? tie : { OR: [{ priority: { in: [...beyond] } }, tie] };
  }

  const column = sortColumn(sortBy);
  const value = new Date(cursor.sortValue);
  if (Number.isNaN(value.getTime())) return null;

  return {
    OR: [
      { [column]: after ? { gt: value } : { lt: value } },
      { [column]: value, id: after ? { gt: cursor.id } : { lt: cursor.id } },
    ],
  };
}

export interface TicketRepository {
  findById(id: string): Promise<TicketRecord | null>;
  list(args: ListTicketsArgs): Promise<TicketPage>;
  dashboard(viewer: Viewer, now: Date): Promise<DashboardCounts>;
}

export function createTicketRepository(prisma: PrismaClient): TicketRepository {
  return {
    async findById(id) {
      return prisma.ticket.findUnique({ where: { id } });
    },

    async list(args) {
      const take = clampTake(args.take);
      const order = args.sortDirection === 'ASC' ? 'asc' : 'desc';

      const clauses: Prisma.TicketWhereInput[] = [
        buildTicketWhere(args.viewer, args, args.now),
      ];

      if (args.cursor != null) {
        const decoded = decodeCursor(args.cursor);
        const keyset = decoded === null ? null : cursorWhere(decoded, args.sortBy, args.sortDirection);
        // An unreadable cursor is ignored rather than fatal: it degrades to the
        // first page instead of failing the whole query.
        if (keyset !== null) clauses.push(keyset);
      }

      // `id` is always the tiebreaker so the total order is deterministic.
      const orderBy: Prisma.TicketOrderByWithRelationInput[] = [
        { [sortColumn(args.sortBy)]: order },
        { id: order },
      ];

      // One extra row tells us whether another page exists, without a count.
      const rows = await prisma.ticket.findMany({
        where: { AND: clauses },
        orderBy,
        take: take + 1,
      });

      const hasNextPage = rows.length > take;
      const nodes = hasNextPage ? rows.slice(0, take) : rows;
      const last = nodes.at(-1);

      return {
        nodes,
        hasNextPage,
        endCursor: last === undefined ? null : encodeCursor(last, args.sortBy),
      };
    },

    async dashboard(viewer, now) {
      const scoped = (extra: Prisma.TicketWhereInput): Prisma.TicketWhereInput => ({
        AND: [visibilityWhere(viewer), extra],
      });

      // Counted in the database in a single round trip — never by loading rows.
      const [openTickets, inProgressTickets, resolvedTickets, atRiskTickets, breachedTickets] =
        await prisma.$transaction([
          prisma.ticket.count({ where: scoped({ status: 'OPEN' }) }),
          prisma.ticket.count({ where: scoped({ status: 'IN_PROGRESS' }) }),
          prisma.ticket.count({ where: scoped({ status: 'RESOLVED' }) }),
          prisma.ticket.count({ where: scoped(slaStateWhere('AT_RISK', now)) }),
          prisma.ticket.count({ where: scoped(slaStateWhere('BREACHED', now)) }),
        ]);

      return { openTickets, inProgressTickets, resolvedTickets, atRiskTickets, breachedTickets };
    },
  };
}
