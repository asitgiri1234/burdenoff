# Support Ticket & SLA Tracker

A support ticket system with business-hours-aware SLA tracking: tickets carry
first-response and resolution deadlines computed from working hours, weekends
and public holidays, and their SLA state (OK / at risk / breached) is queryable
directly in SQL.

## Tech stack

| Layer     | Choice                                              |
| --------- | --------------------------------------------------- |
| Runtime   | [Bun](https://bun.sh)                                |
| Language  | TypeScript (strict, `any` banned via ESLint)         |
| API       | [GraphQL Yoga](https://the-guild.dev/graphql/yoga-server) — schema-first (`.graphql` SDL + separate resolvers) |
| Database  | PostgreSQL 16 (Docker Compose)                       |
| ORM       | [Prisma](https://www.prisma.io) with versioned migrations |
| Types     | `graphql-codegen` (`typescript` + `typescript-resolvers`) |
| Validation| [Zod](https://zod.dev)                               |

## Setup

Requires [Bun](https://bun.sh) and Docker.

```bash
# 1. Start Postgres (primary on :5432, test database on :5433)
docker compose up -d

# 2. Install dependencies
cd server
bun install

# 3. Configure environment
cp .env.example .env

# 4. Create the database schema and seed it
bunx prisma migrate dev --name init
bun run seed

# 5. Run the server
bun run dev
```

The GraphQL endpoint is then at <http://localhost:4000/graphql>. Verify it:

```bash
curl -X POST http://localhost:4000/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ health }"}'
# => {"data":{"health":"ok"}}
```

### Seeded accounts

All seeded users share the password `password123`.

| Email                  | Role     |
| ---------------------- | -------- |
| `agent@example.com`    | AGENT    |
| `agent2@example.com`   | AGENT    |
| `reporter@example.com` | REPORTER |
| `reporter2@example.com`| REPORTER |

## Scripts

Run from `server/`:

| Script            | Purpose                                            |
| ----------------- | -------------------------------------------------- |
| `bun run dev`     | Start the server with hot reload                    |
| `bun run gendb`   | `prisma generate` + `migrate dev` + `db seed`       |
| `bun run migrate` | Create/apply a migration                            |
| `bun run seed`    | Seed the database                                   |
| `bun run codegen` | Regenerate GraphQL resolver types                   |
| `bun run typecheck` | Type-check with `tsc --noEmit`                    |
| `bun run lint`    | Lint with ESLint                                    |
| `bun run test`    | Run tests                                           |

> A fuller README — architecture notes, SLA rules and design trade-offs —
> lands at the end of the project.
