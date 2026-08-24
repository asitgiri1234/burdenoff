import { env } from '../../../src/config/env.ts';
import { createUserRepository } from '../../../src/repositories/userRepository.ts';
import { register, type PublicUser } from '../../../src/services/auth/index.ts';
import type { UserRole } from '../../../src/repositories/userRepository.ts';
import { testPrisma } from './db.ts';

export interface TestUser {
  readonly user: PublicUser;
  readonly token: string;
}

let sequence = 0;

export interface CreateTestUserOptions {
  readonly role: UserRole;
  readonly name?: string;
  readonly email?: string;
  readonly password?: string;
}

export const TEST_PASSWORD = 'password123';

/**
 * Creates a user through the real auth service.
 *
 * Going through `register` rather than inserting a row means the password hash
 * and the JWT are genuine, so tests authenticate exactly as a client would.
 */
export async function createTestUser(options: CreateTestUserOptions): Promise<TestUser> {
  sequence += 1;

  const email = options.email ?? `${options.role.toLowerCase()}${String(sequence)}@example.com`;
  const name = options.name ?? `Test ${options.role} ${String(sequence)}`;

  return register(
    {
      name,
      email,
      password: options.password ?? TEST_PASSWORD,
      role: options.role,
      // Only consulted for AGENT registrations.
      agentSignupCode: env.AGENT_SIGNUP_CODE,
    },
    {
      users: createUserRepository(testPrisma),
      agentSignupCode: env.AGENT_SIGNUP_CODE,
    },
  );
}

/** Inserts a holiday on the given `yyyy-MM-dd` calendar date. */
export async function createTestHoliday(date: string, name = 'Test Holiday'): Promise<void> {
  // @db.Date columns are materialised at midnight UTC.
  await testPrisma.holiday.create({
    data: { date: new Date(`${date}T00:00:00.000Z`), name },
  });
}
