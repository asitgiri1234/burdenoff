import DataLoader from 'dataloader';
import type { UserRecord, UserRepository } from '../repositories/userRepository.ts';

/**
 * Per-request DataLoader bag.
 *
 * Loaders are built fresh for every request and never at module level: they
 * cache, so a module-level loader would serve one user stale data belonging to
 * another and would never see writes made during the request.
 */
export interface Loaders {
  readonly userById: DataLoader<string, UserRecord | null>;
}

export interface LoaderDeps {
  readonly users: UserRepository;
}

export function createLoaders(deps: LoaderDeps): Loaders {
  return {
    userById: new DataLoader<string, UserRecord | null>(async (ids) => {
      const found = await deps.users.findManyByIds(ids);
      const byId = new Map(found.map((user) => [user.id, user]));

      // DataLoader requires one result per key, in the order the keys arrived.
      return ids.map((id) => byId.get(id) ?? null);
    }),
  };
}
