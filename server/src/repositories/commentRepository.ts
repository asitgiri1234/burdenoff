import type { PrismaClient } from '@prisma/client';

export interface CommentRecord {
  readonly id: string;
  readonly ticketId: string;
  readonly authorId: string;
  readonly content: string;
  readonly createdAt: Date;
}

export interface CommentRepository {
  findManyByTicketIds(ticketIds: readonly string[]): Promise<CommentRecord[]>;
}

export function createCommentRepository(prisma: PrismaClient): CommentRepository {
  return {
    async findManyByTicketIds(ticketIds) {
      // Oldest first so a thread reads top to bottom; the composite index on
      // (ticketId, createdAt) covers this exactly.
      return prisma.comment.findMany({
        where: { ticketId: { in: [...ticketIds] } },
        orderBy: { createdAt: 'asc' },
      });
    },
  };
}
