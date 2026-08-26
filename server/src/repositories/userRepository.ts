import { Prisma, type PrismaClient } from '@prisma/client';

/** Roles a user can hold, mirroring the Prisma UserRole enum. */
export type UserRole = 'REPORTER' | 'AGENT';

/** A user row as the domain sees it. */
export interface UserRecord {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly passwordHash: string;
  readonly role: UserRole;
  readonly createdAt: Date;
}

export interface CreateUserData {
  readonly name: string;
  readonly email: string;
  readonly passwordHash: string;
  readonly role: UserRole;
}

/**
 * Everything the auth service needs from storage.
 *
 * Declared as a port so the service depends on this interface rather than on
 * PrismaClient: the unit tests inject an in-memory implementation and never
 * need a database.
 */
export interface UserRepository {
  findById(id: string): Promise<UserRecord | null>;
  findByEmail(email: string): Promise<UserRecord | null>;
  findManyByIds(ids: readonly string[]): Promise<UserRecord[]>;
  listByRole(role: UserRole | null): Promise<UserRecord[]>;
  create(data: CreateUserData): Promise<UserRecord>;
}

/**
 * Raised when a create violates the unique email constraint.
 *
 * The repository translates Prisma's P2002 into this domain error so callers
 * never have to know about Prisma error codes — and so the in-memory test
 * double can reproduce the same behaviour faithfully.
 */
export class EmailAlreadyExistsError extends Error {
  constructor(public readonly email: string) {
    super(`Email already registered: ${email}`);
    this.name = 'EmailAlreadyExistsError';
  }
}

/** Prisma's unique-constraint violation code. */
const UNIQUE_VIOLATION = 'P2002';

export function createUserRepository(prisma: PrismaClient): UserRepository {
  return {
    async findById(id) {
      return prisma.user.findUnique({ where: { id } });
    },

    async findByEmail(email) {
      return prisma.user.findUnique({ where: { email } });
    },

    async findManyByIds(ids) {
      return prisma.user.findMany({ where: { id: { in: [...ids] } } });
    },

    async listByRole(role) {
      return prisma.user.findMany({
        where: role === null ? {} : { role },
        orderBy: { name: 'asc' },
      });
    },

    async create(data) {
      try {
        return await prisma.user.create({ data });
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === UNIQUE_VIOLATION
        ) {
          throw new EmailAlreadyExistsError(data.email);
        }
        throw error;
      }
    },
  };
}
