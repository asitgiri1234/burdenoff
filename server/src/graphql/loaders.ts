import DataLoader from 'dataloader';
import type { CommentRecord, CommentRepository } from '../repositories/commentRepository.ts';
import type { UserRecord, UserRepository } from '../repositories/userRepository.ts';

/**
 * Per-request DataLoader bag.
 *
 * These exist to collapse the N+1 that field resolvers naturally create: a page
 * of 20 tickets asking for `reporter` and `assignee` would otherwise issue 40
 * user queries. Batched through `userById` it is one.
 *
 * Loaders are built fresh for every request and never at module level: they
 * cache, so a module-level loader would serve one user stale data belonging to
 * another and would never see writes made during the request.
 */
export interface Loaders {
  readonly userById: DataLoader<string, UserRecord | null>;
  readonly commentsByTicketId: DataLoader<string, CommentRecord[]>;
}

export interface LoaderDeps {
  readonly users: UserRepository;
  readonly comments: CommentRepository;
}

export function createLoaders(deps: LoaderDeps): Loaders {
  return {
    userById: new DataLoader<string, UserRecord | null>(async (ids) => {
      const found = await deps.users.findManyByIds(ids);
      const byId = new Map(found.map((user) => [user.id, user]));

      // DataLoader requires one result per key, in the order the keys arrived.
      return ids.map((id) => byId.get(id) ?? null);
    }),

    commentsByTicketId: new DataLoader<string, CommentRecord[]>(async (ticketIds) => {
      const found = await deps.comments.findManyByTicketIds(ticketIds);

      const byTicket = new Map<string, CommentRecord[]>(ticketIds.map((id) => [id, []]));
      for (const comment of found) {
        byTicket.get(comment.ticketId)?.push(comment);
      }

      return ticketIds.map((id) => byTicket.get(id) ?? []);
    }),
  };
}
