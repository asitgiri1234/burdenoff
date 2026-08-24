import { PrismaClient, UserRole } from '@prisma/client';

const prisma = new PrismaClient();

const SEED_PASSWORD = 'password123';

interface SeedUser {
  name: string;
  email: string;
  role: UserRole;
}

const users: SeedUser[] = [
  { name: 'Ava Agent', email: 'agent@example.com', role: UserRole.AGENT },
  { name: 'Ben Agent', email: 'agent2@example.com', role: UserRole.AGENT },
  { name: 'Rhea Reporter', email: 'reporter@example.com', role: UserRole.REPORTER },
  { name: 'Raj Reporter', email: 'reporter2@example.com', role: UserRole.REPORTER },
];

const holidays: { date: string; name: string }[] = [
  { date: '2026-08-15', name: 'Independence Day' },
  { date: '2026-10-02', name: 'Gandhi Jayanti' },
];

async function main(): Promise<void> {
  // argon2id is Bun's default for Bun.password.hash.
  const passwordHash = await Bun.password.hash(SEED_PASSWORD, 'argon2id');

  for (const user of users) {
    await prisma.user.upsert({
      where: { email: user.email },
      update: { name: user.name, role: user.role, passwordHash },
      create: { ...user, passwordHash },
    });
  }
  console.log(`Seeded ${users.length} users (password: ${SEED_PASSWORD})`);

  for (const holiday of holidays) {
    // @db.Date columns store midnight UTC; build the date that way explicitly.
    const date = new Date(`${holiday.date}T00:00:00.000Z`);
    await prisma.holiday.upsert({
      where: { date },
      update: { name: holiday.name },
      create: { date, name: holiday.name },
    });
  }
  console.log(`Seeded ${holidays.length} holidays`);

  // TODO(task-4): seed tickets once the SLA engine exists. Tickets cannot be
  // inserted before then because firstResponseDueAt / resolutionDueAt /
  // firstResponseAtRiskAt / resolutionAtRiskAt are non-nullable and must be
  // computed from business hours + holidays rather than hardcoded.
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    console.error('Seed failed:', error);
    await prisma.$disconnect();
    process.exit(1);
  });
