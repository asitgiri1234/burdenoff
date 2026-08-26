import {
  EmailAlreadyExistsError,
  type CreateUserData,
  type UserRecord,
  type UserRepository,
  type UserRole,
} from '../../src/repositories/userRepository.ts';

/**
 * In-memory UserRepository for unit tests.
 *
 * Implements the same port the Prisma-backed repository does, including the
 * unique-email constraint, so the auth service can be exercised end to end
 * without a database.
 */
export class FakeUserRepository implements UserRepository {
  private readonly rows = new Map<string, UserRecord>();
  private nextId = 1;

  async findById(id: string): Promise<UserRecord | null> {
    return this.rows.get(id) ?? null;
  }

  async findByEmail(email: string): Promise<UserRecord | null> {
    for (const row of this.rows.values()) {
      if (row.email === email) return row;
    }
    return null;
  }

  async findManyByIds(ids: readonly string[]): Promise<UserRecord[]> {
    return ids.flatMap((id) => {
      const row = this.rows.get(id);
      return row === undefined ? [] : [row];
    });
  }

  async listByRole(role: UserRole | null): Promise<UserRecord[]> {
    return [...this.rows.values()]
      .filter((row) => role === null || row.role === role)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async create(data: CreateUserData): Promise<UserRecord> {
    if ((await this.findByEmail(data.email)) !== null) {
      throw new EmailAlreadyExistsError(data.email);
    }

    const row: UserRecord = {
      id: `user-${String(this.nextId++)}`,
      name: data.name,
      email: data.email,
      passwordHash: data.passwordHash,
      role: data.role,
      createdAt: new Date('2026-03-02T04:30:00.000Z'),
    };

    this.rows.set(row.id, row);
    return row;
  }
}
