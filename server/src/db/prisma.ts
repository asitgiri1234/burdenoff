import { PrismaClient } from '@prisma/client';

/**
 * Single shared PrismaClient for the process. Reused across `bun --watch`
 * reloads so we do not exhaust the Postgres connection pool in development.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
