import { PrismaClient } from '@prisma/client';

/**
 * The database URL integration tests run against.
 *
 * Read explicitly rather than relying on the ambient DATABASE_URL, so a
 * misconfigured environment fails loudly here instead of quietly truncating a
 * development database.
 */
function testDatabaseUrl(): string {
  const url = process.env['TEST_DATABASE_URL'];

  if (url === undefined || url.length === 0) {
    throw new Error(
      'TEST_DATABASE_URL is not set. Copy server/.env.test.example to server/.env.test ' +
        'and start the databases with `docker compose up -d`.',
    );
  }

  if (!url.includes('test')) {
    // Cheap guard against pointing the truncating helper at a real database.
    throw new Error(`Refusing to run integration tests against a non-test database: ${url}`);
  }

  return url;
}

/** A single client shared by the whole integration suite. */
export const testPrisma = new PrismaClient({ datasourceUrl: testDatabaseUrl() });

/**
 * Empties every table between tests.
 *
 * TRUNCATE ... RESTART IDENTITY CASCADE in one statement is both faster than a
 * chain of deleteMany calls and immune to their ordering problem: CASCADE
 * handles the foreign keys instead of the caller having to get the sequence
 * right every time a relation is added.
 */
export async function resetDatabase(): Promise<void> {
  await testPrisma.$executeRawUnsafe(
    'TRUNCATE TABLE "Comment", "Ticket", "Holiday", "User" RESTART IDENTITY CASCADE',
  );
}

export async function disconnectDatabase(): Promise<void> {
  await testPrisma.$disconnect();
}
