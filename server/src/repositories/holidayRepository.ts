import type { PrismaClient } from '@prisma/client';

export interface HolidayRecord {
  readonly id: string;
  readonly date: Date;
  readonly name: string;
}

export interface HolidayRepository {
  listAll(): Promise<HolidayRecord[]>;
}

export function createHolidayRepository(prisma: PrismaClient): HolidayRepository {
  return {
    async listAll() {
      return prisma.holiday.findMany({ orderBy: { date: 'asc' } });
    },
  };
}
