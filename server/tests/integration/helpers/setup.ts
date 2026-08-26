/**
 * Applies migrations to the test database before the integration suite runs.
 *
 * Uses `migrate deploy` rather than `db push` on purpose: it replays the
 * committed migration files, so the suite verifies the migrations themselves —
 * not just that the schema file and the database happen to agree.
 */
const url = process.env['TEST_DATABASE_URL'];

if (url === undefined || url.length === 0) {
  console.error(
    'TEST_DATABASE_URL is not set.\n' +
      'Copy server/.env.test.example to server/.env.test, then run `docker compose up -d`.',
  );
  process.exit(1);
}

console.log('Applying migrations to the test database...');

const result = Bun.spawnSync(['bunx', 'prisma', 'migrate', 'deploy'], {
  // Prisma reads DATABASE_URL; point it at the test database for this call only.
  env: { ...process.env, DATABASE_URL: url },
  stdout: 'inherit',
  stderr: 'inherit',
});

if (result.exitCode !== 0) {
  console.error(
    '\nMigrations failed. Is the test database running? Try `docker compose up -d --wait`.',
  );
}

process.exit(result.exitCode);
