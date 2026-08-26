# Support Ticket & SLA Tracker

A support ticket system with business-hours-aware SLA tracking. Tickets carry
first-response and resolution deadlines computed from working hours, weekends
and public holidays, and their SLA state (on track / at risk / breached / met)
is queryable, filterable and countable directly in SQL.

---

## Tech stack

| Layer      | Choice                                                                 |
| ---------- | ---------------------------------------------------------------------- |
| Runtime    | [Bun](https://bun.sh)                                                   |
| Language   | TypeScript, `strict` everywhere, `any` banned by ESLint                 |
| API        | [GraphQL Yoga](https://the-guild.dev/graphql/yoga-server), schema-first |
| Database   | PostgreSQL 16 via Docker Compose                                        |
| ORM        | [Prisma](https://www.prisma.io) with versioned migrations               |
| Types      | `graphql-codegen` (`typescript` + `typescript-resolvers`)               |
| Validation | [Zod](https://zod.dev)                                                  |
| Dates      | [Luxon](https://moment.github.io/luxon/) for timezone-aware arithmetic  |
| Auth       | `Bun.password` (argon2id) + `jose` (HS256 JWT)                          |
| Frontend   | Vite + React 18 + TypeScript, hand-written CSS, no component library    |

---

## Architecture overview

The server is layered, and each layer is only allowed to know about the one
below it:

```
GraphQL resolvers    thin: parse input -> guard -> call service -> return
        |            no business rules, no date arithmetic
        v
   services/         all business logic
   ├── auth/         registration, login, tokens, password hashing
   ├── ticket/       status machine, ticket lifecycle, comments, SLA view
   └── sla/          pure business-hours + SLA engine (no I/O at all)
        |
        v
  repositories/      all Prisma access, query building, pagination
        |
        v
     Postgres
```

**Resolvers are deliberately thin.** A resolver validates its arguments through
`parseInput`, applies an auth guard, calls a service and returns. If you find a
business rule in a resolver, it is in the wrong place.

**Repositories own every query.** Visibility rules, filters, SLA predicates,
sorting and cursor pagination are all expressed as Prisma `where` objects, so
they compose into a single SQL statement rather than being applied in memory.

**The SLA engine is pure and isolated.** `src/services/sla/` imports nothing
from Prisma, GraphQL or the environment, and never calls `Date.now()`. Every
function takes the current time and the holiday calendar as parameters:

```ts
addBusinessMinutes(start: Date, minutes: number, ctx: BusinessHoursContext): Date
resolveSlaState({ eventAt, dueAt, atRiskAt, now }): SlaState
```

That isolation is a deliberate design decision, and it buys three things:

1. **Testability.** The 53 SLA unit tests use fixed, hand-computed dates and
   need no database, no clock stubbing and no mocking framework.
2. **Determinism.** The same inputs always produce the same output, so a test
   that passes today still passes next Tuesday, and on a machine in another
   timezone.
3. **Reuse.** The seed script back-dates demo tickets through the exact same
   functions the API uses, so seeded data cannot drift from real behaviour.

The frontend mirrors this discipline: **it never computes SLA anything.** It
renders the states and remaining-minute counts the API returns.

---

## Database schema

Four models. Prisma schema: [`server/prisma/schema.prisma`](server/prisma/schema.prisma).

### `User`

`id` (cuid), `name`, `email` (unique), `passwordHash`, `role`, `createdAt`.

Relations: `reportedTickets`, `assignedTickets`, `comments`. Reporter and
assignee are two separate named relations to the same table.

### `Ticket`

`id`, `title`, `description`, `priority`, `status` (default `OPEN`),
`reporterId`, `assigneeId?`, `createdAt`, `updatedAt`, plus two groups of
timestamps:

| Actual events (nullable) | Meaning                          |
| ------------------------ | -------------------------------- |
| `firstResponseAt`        | when a non-reporter first replied |
| `resolvedAt`             | when it was first resolved        |
| `closedAt`               | when it was first closed          |

| Precomputed targets (non-null) | Meaning                          |
| ------------------------------ | -------------------------------- |
| `firstResponseDueAt`           | first-response deadline          |
| `resolutionDueAt`              | resolution deadline              |
| `firstResponseAtRiskAt`        | 75% of the first-response budget |
| `resolutionAtRiskAt`           | 75% of the resolution budget     |

### `Comment`

`id`, `ticketId` (cascade delete), `authorId`, `content`, `createdAt`.

### `Holiday`

`id`, `date` (`@db.Date`, unique), `name`, `createdAt`.

### Indexes, and why each one exists

| Index                                       | Reason                                                              |
| ------------------------------------------- | ------------------------------------------------------------------- |
| `User.email` (unique)                       | Login looks users up by email; also enforces one account per address |
| `Ticket.status`                             | Status is the most common list filter and drives 3 dashboard counts  |
| `Ticket.priority`                           | Priority filter, and the priority sort option                        |
| `Ticket.assigneeId`                         | "My tickets" / per-agent filtering                                   |
| `Ticket.createdAt`                          | Default sort order, and the keyset cursor column                     |
| `Ticket(firstResponseAt, firstResponseDueAt)` | Composite: the exact pair the first-response SLA predicate compares |
| `Ticket(resolvedAt, resolutionDueAt)`       | Composite: same, for the resolution clock                            |
| `Comment(ticketId, createdAt)`              | Loading a thread in chronological order is a covered index scan      |
| `Holiday.date` (unique)                     | Holiday lookup, and prevents duplicate calendar entries              |

The two composite SLA indexes are the ones that matter most: they are ordered to
match the predicates in the next section, so "which tickets are breached?" stays
an index scan rather than a sequential scan as the table grows.

---

## SLA calculation approach

### Business hours

- **Monday to Friday, 09:00–18:00** — nine business hours per day.
- Timezone comes from `BUSINESS_TIMEZONE` (default `Asia/Kolkata`).
- **All timestamps are stored in UTC.** Only the business-hours reasoning
  happens in the configured zone: an instant is converted into that zone, the
  working-window arithmetic runs there, and the result converts back to UTC.
- Weekends contribute zero minutes.
- Dates in the `Holiday` table contribute zero minutes.

### Policy table

Budgets are stored in **business minutes**, not wall-clock time:

| Priority | First response | Resolution |
| -------- | -------------- | ---------- |
| `URGENT` | 1 h  (60)      | 4 h  (240) |
| `HIGH`   | 4 h  (240)     | 24 h (1440)|
| `MEDIUM` | 8 h  (480)     | 48 h (2880)|
| `LOW`    | 24 h (1440)    | 72 h (4320)|

### Anchoring

If a ticket arrives outside working hours, the clock does not start until the
next opening:

| Created           | Clock starts   |
| ----------------- | -------------- |
| Monday 07:00      | Monday 09:00   |
| Monday 20:00      | Tuesday 09:00  |
| Saturday, any time| Monday 09:00   |

### Worked example (from the spec)

**A `HIGH` ticket created Friday 17:00 is due for first response Monday 12:00.**

`HIGH` allows 4 business hours. Friday 17:00 → 18:00 contributes 1 hour, leaving
3. Saturday and Sunday contribute nothing. The remaining 3 hours are consumed
from Monday 09:00, giving **Monday 12:00**.

### The key decision: deadlines are stored, not derived

When a ticket is created, the engine computes all four timestamps **once** and
they are written to the row. SLA state is then a plain timestamp comparison.

This is the single most consequential design choice in the project. The
alternative — deriving state in application code on read — breaks down badly:

- **Filtering.** `tickets(slaState: BREACHED)` becomes a `WHERE` clause. Derived
  in JS, it would mean loading every ticket into memory and filtering after the
  fact.
- **Counting.** The dashboard runs five `COUNT` queries in one transaction.
  Derived in JS, "how many are breached?" would require a full table scan into
  application memory on every dashboard load.
- **Pagination.** This is the one that actually makes the alternative
  unworkable. With in-memory filtering the database cannot know how many rows a
  page should contain, so `LIMIT` returns the wrong number of results and cursor
  pagination silently breaks.
- **Indexing.** A stored timestamp can be indexed. A function of the current
  time computed in JavaScript cannot.

The trade-off is that changing a policy budget does not retroactively move
existing deadlines. That is arguably correct behaviour — a ticket should be held
to the SLA that applied when it was raised — but a policy change intended to
apply retroactively would need a backfill migration.

The predicates, exactly as built in
[`ticketRepository.ts`](server/src/repositories/ticketRepository.ts):

```
BREACHED  (firstResponseAt IS NULL AND firstResponseDueAt    < now)
       OR (resolvedAt      IS NULL AND resolutionDueAt       < now)

AT_RISK   NOT breached
      AND ((firstResponseAt IS NULL AND firstResponseAtRiskAt < now)
        OR (resolvedAt      IS NULL AND resolutionAtRiskAt    < now))

ON_TRACK  NOT breached AND NOT at-risk
      AND (firstResponseAt IS NULL OR resolvedAt IS NULL)

MET       firstResponseAt IS NOT NULL AND resolvedAt IS NOT NULL
```

### The 75% boundary

At-risk marks sit at **75% of the budget**, measured in business minutes and
floored to a whole minute.

> **The boundary is strictly greater-than.** At *exactly* 75% consumed a ticket
> is still `ON_TRACK`. `AT_RISK` begins only *after* the mark is passed.

The same rule applies at the deadline: exactly at `dueAt` is not yet a breach.
Both boundaries are covered by tests on each side.

### SLA clock freezing

> Once `firstResponseAt` or `resolvedAt` is stamped, that clock reads **`MET`
> permanently** and can never become `BREACHED`.

`MET` takes precedence over every other state. A ticket answered *late* still
reports `MET`, because the clock stopped the moment the event happened — the
SLA records what actually occurred, not a running judgement of it.

Two consequences follow deliberately:

- **Reopening never clears `resolvedAt`.** Moving a resolved ticket back to
  `OPEN` starts a new working period; it does not rewrite history, and it cannot
  retroactively turn a met SLA into a breach.
- **Resolving twice never moves `resolvedAt`.** The first stamp wins.

The first-response stamp is written with an `updateMany` guarded on
`firstResponseAt: null`, so it is atomic: two agents replying simultaneously
cannot both stamp, and the earliest response stands.

### First response rule

The first-response clock stops on the first comment **from somebody other than
the reporter**. A reporter adding detail to their own ticket is not a response.
The comment insert and the stamp run in one transaction, so a crash between them
cannot leave a ticket whose SLA claims it is unanswered while a reply is visible.

---

## Status transition rules

Transitions are enforced server-side from an explicit table.

| From          | Allowed to                      |
| ------------- | ------------------------------- |
| `OPEN`        | `IN_PROGRESS`, `RESOLVED`, `CLOSED` |
| `IN_PROGRESS` | `RESOLVED`, `OPEN`, `CLOSED`    |
| `RESOLVED`    | `CLOSED`, `IN_PROGRESS`, `OPEN` |
| `CLOSED`      | `OPEN` only                     |

**Rejected**, with `INVALID_STATUS_TRANSITION`:

- `CLOSED → IN_PROGRESS` and `CLOSED → RESOLVED`. `CLOSED` is near-terminal: the
  only way out is an explicit reopen to `OPEN`. Letting a closed ticket resume
  work without re-entering the queue would hide it from triage.
- **Any same-status transition** (`OPEN → OPEN`, etc.). These carry no meaning
  and almost always indicate a double-submitted mutation worth surfacing.

The error message names both states verbatim, e.g.
`Ticket cannot transition from CLOSED to IN_PROGRESS.`, and the frontend shows
it unmodified rather than paraphrasing rules it does not own.

Side effects: assigning an `OPEN` ticket also moves it to `IN_PROGRESS` (work
has started). `resolvedAt` and `closedAt` are stamped on first entry only.

---

## Authentication and authorization

- **Passwords** are hashed with `Bun.password` using **argon2id** — memory-hard,
  so it degrades GPU cracking far better than a SHA-family hash. Hashes are
  never logged and never cross the service boundary.
- **Sessions** are HS256 JWTs with `{ sub, role }` claims and a 7-day expiry.
  Verification returns `null` for every failure mode rather than throwing,
  because "no valid token" is an anonymous request, not an error.
- The context **re-reads the role from the database** rather than trusting the
  signed token, so a user deleted after their token was issued stops being
  authenticated.
- **Login is uniform.** An unknown email and a wrong password return the
  identical `UNAUTHORIZED` / "Invalid email or password" response, and the
  unknown-email path still performs the hashing work so response timing cannot
  be used to enumerate registered addresses.

### Roles

| Role       | Can                                                                  |
| ---------- | -------------------------------------------------------------------- |
| `REPORTER` | Create tickets, see and comment on **only their own** tickets         |
| `AGENT`    | See all tickets, assign, change status, resolve, comment on any       |

### Why agent registration requires a signup code

Agents can read and modify **every ticket in the system**. If agent registration
were open, any visitor could grant themselves full access to all customer data
by picking a value from a dropdown. Registering as a `REPORTER` is open; creating
an `AGENT` requires `AGENT_SIGNUP_CODE`, which keeps agent provisioning with
whoever operates the deployment. A mismatch returns `FORBIDDEN`.

### Error codes

Every deliberate error carries a machine-readable `extensions.code`:

`VALIDATION_ERROR`, `TICKET_NOT_FOUND`, `USER_NOT_FOUND`, `UNAUTHORIZED`,
`FORBIDDEN`, `INVALID_STATUS_TRANSITION`, `INVALID_PRIORITY`, `INVALID_COMMENT`.

`UNAUTHORIZED` means *not signed in* (signing in will help). `FORBIDDEN` means
*signed in but not permitted* (signing in again will not). `VALIDATION_ERROR`
additionally carries `extensions.fieldErrors` as `{ path, message }` pairs so
the UI can attach messages to individual inputs.

Unexpected internal errors are masked in production; deliberate ones always pass
through with their codes intact. **No validation failure ever surfaces as a 500.**

---

## Environment variables

`server/.env` — copy from [`server/.env.example`](server/.env.example):

| Variable              | Meaning                                                             |
| --------------------- | ------------------------------------------------------------------- |
| `DATABASE_URL`        | Postgres connection string for the app database                     |
| `TEST_DATABASE_URL`   | Connection string for the integration-test database (port 5433)     |
| `JWT_SECRET`          | HMAC key for signing JWTs; minimum 16 characters                    |
| `BUSINESS_TIMEZONE`   | IANA zone the business operates in (default `Asia/Kolkata`)         |
| `BUSINESS_START_HOUR` | Hour the working day opens (default `9`)                            |
| `BUSINESS_END_HOUR`   | Hour the working day closes (default `18`)                          |
| `AGENT_SIGNUP_CODE`   | Invite code required to register as an `AGENT`                      |
| `PORT`                | HTTP port for the GraphQL server (default `4000`)                   |
| `NODE_ENV`            | `development` \| `test` \| `production`; controls error masking     |

`web/.env` — copy from [`web/.env.example`](web/.env.example):

| Variable       | Meaning                                                    |
| -------------- | ---------------------------------------------------------- |
| `VITE_API_URL` | GraphQL endpoint (default `http://localhost:4000/graphql`) |

Configuration is parsed and validated with Zod at boot and exported as a frozen
object, so a missing or malformed variable fails immediately with a readable
message instead of surfacing deep inside a request.

`server/.env.test` (from `.env.test.example`) is optional — it overrides the above
for the integration suite. `server/.env` already carries `TEST_DATABASE_URL`, so the
tests run without it; add it only if you want the test run pointed somewhere else.

---

## Setup

Requires [Bun](https://bun.sh) and Docker.

```bash
# 1. Start Postgres (app database on :5432, test database on :5433)
#    --wait blocks until both databases actually accept connections; without it
#    `up -d` returns several seconds early and the next step can fail to connect
docker compose up -d --wait

# 2. Backend
cd server
cp .env.example .env
bun install
bun run gendb        # prisma generate + migrate dev + db seed
bun run dev          # http://localhost:4000/graphql
```

```bash
# 3. Frontend, in a second terminal
cd web
cp .env.example .env
bun install
bun run dev          # http://localhost:5173
```

### Migrations

```bash
cd server
bunx prisma migrate dev --name <name>   # create and apply a new migration
bunx prisma migrate deploy              # apply existing migrations (CI, prod)
bun run codegen                         # regenerate GraphQL resolver types
```

### Seeding

```bash
cd server
bun run seed
```

The seed is idempotent — it truncates and rebuilds — and creates four users, two
holidays and six tickets deliberately spread across **all four SLA states**,
including one breached, one at risk, one on track and one met with a full
comment thread. Deadlines are computed by the real SLA engine, and `createdAt`
values are back-dated **in business minutes** so the intended states are
reproducible regardless of which day you run it.

### Seeded credentials

All seeded accounts use the password `password123`.

| Email                   | Role       |
| ----------------------- | ---------- |
| `agent@example.com`     | `AGENT`    |
| `agent2@example.com`    | `AGENT`    |
| `reporter@example.com`  | `REPORTER` |
| `reporter2@example.com` | `REPORTER` |

---

## Running the tests

```bash
cd server

bun run test:unit          # 138 tests, no database required
bun run test:integration   # 45 tests against real Postgres on :5433
bun run test               # both
```

**Unit tests** cover the SLA engine against fixed hand-computed dates, the
status machine, auth, and the ticket services via in-memory test doubles.

**Integration tests** run against a **real PostgreSQL** in Docker with nothing
mocked. They drive real GraphQL operations through the production Yoga instance
in-process via `yoga.fetch()` — no HTTP listener, no network — so a request goes
through schema → resolvers → services → Prisma → Postgres exactly as it would in
production. Assertions are made against the **database**, not just the API
response. The suite applies migrations with `prisma migrate deploy` first, so the
committed migration files are verified too, not just the schema.

**Frontend tests** use Vitest and React Testing Library:

```bash
cd web
bun run test         # 70 tests, jsdom, no server required
bun run test:watch
```

They cover the formatting and error-mapping helpers, the API client (bearer
token handling, typed `ApiError` conversion, session clearing on
`UNAUTHORIZED`), and the components: the SLA badge, the error and field-error
renderers, the sign-in/register form, and the ticket detail page's role-gated
controls. A dedicated group asserts that `SlaBadge` renders whatever state the
API returned even when the remaining minutes would suggest otherwise — the
regression guard for the rule that the backend owns SLA state.

Quality gates, run in CI on every push and PR:

```bash
cd server && bun run lint && bun run typecheck && bun run test
cd web    && bun run lint && bun run typecheck && bun run test
```

---

## Example GraphQL operations

All are copy-pasteable into the endpoint at `http://localhost:4000/graphql`.
Every request except `login`, `register` and `health` needs
`Authorization: Bearer <token>`.

### 1. Log in

```graphql
mutation {
  login(email: "agent@example.com", password: "password123") {
    token
    user { id name role }
  }
}
```

### 2. Register a reporter

```graphql
mutation {
  register(
    name: "Sam Reporter"
    email: "sam@example.com"
    password: "password123"
    role: REPORTER
  ) {
    token
    user { id role }
  }
}
```

### 3. Create a ticket

```graphql
mutation {
  createTicket(
    title: "Checkout fails on card payment"
    description: "A 500 is returned at the final step."
    priority: URGENT
  ) {
    id
    status
    sla {
      firstResponseDueAt
      resolutionDueAt
      firstResponseState
    }
  }
}
```

### 4. Filtered, sorted and paginated ticket list

```graphql
query {
  tickets(
    slaState: BREACHED
    priority: URGENT
    sortBy: FIRST_RESPONSE_DUE_AT
    sortDirection: ASC
    take: 3
  ) {
    nodes {
      id
      title
      status
      assignee { name }
      sla {
        firstResponseState
        resolutionState
        firstResponseRemainingMinutes
      }
    }
    pageInfo { hasNextPage endCursor }
  }
}
```

Follow the cursor for the next page:

```graphql
query ($cursor: String) {
  tickets(slaState: BREACHED, take: 3, cursor: $cursor) {
    nodes { id title }
    pageInfo { hasNextPage endCursor }
  }
}
```

### 5. Dashboard counts

```graphql
query {
  dashboard {
    openTickets
    inProgressTickets
    resolvedTickets
    atRiskTickets
    breachedTickets
  }
}
```

### 6. Ticket detail with its comment thread

```graphql
query ($id: ID!) {
  ticket(id: $id) {
    title
    description
    status
    firstResponseAt
    resolvedAt
    reporter { name role }
    assignee { name }
    comments { content createdAt author { name role } }
    sla { firstResponseState resolutionState resolutionRemainingMinutes }
  }
}
```

### 7. Add a comment (stops the first-response clock if an agent sends it)

```graphql
mutation ($id: ID!) {
  addComment(ticketId: $id, content: "Looking into this now.") {
    id
    createdAt
    author { name role }
  }
}
```

### 8. An operation that returns an error

Closing a ticket and then trying to move it straight to `IN_PROGRESS`:

```graphql
mutation ($id: ID!) {
  changeTicketStatus(ticketId: $id, status: IN_PROGRESS) { id status }
}
```

Returns **HTTP 200** with a typed error, not a 500:

```json
{
  "errors": [
    {
      "message": "Ticket cannot transition from CLOSED to IN_PROGRESS.",
      "path": ["changeTicketStatus"],
      "extensions": {
        "code": "INVALID_STATUS_TRANSITION",
        "from": "CLOSED",
        "to": "IN_PROGRESS"
      }
    }
  ],
  "data": null
}
```

A validation failure carries field-level detail:

```json
{
  "errors": [
    {
      "message": "Invalid input",
      "extensions": {
        "code": "VALIDATION_ERROR",
        "fieldErrors": [
          { "path": "password", "message": "Password must be at least 8 characters" }
        ]
      }
    }
  ]
}
```

---

## How I'd extend this

**Pause the SLA while `WAITING_ON_CUSTOMER`.** The most valuable missing
feature, and deliberately scoped out. Today's model assumes a clock, once
started, runs continuously until its event. Pausing breaks that assumption: a
deadline can no longer be a single stored timestamp, because the remaining
budget changes every time the ticket is paused or resumed. It needs a
`pausedMinutes` accumulator plus a `pausedAt` marker, every read has to account
for an *open* pause, and the SQL predicates gain a term — which is exactly the
property that currently makes `slaState` filtering indexable. It roughly doubles
the test surface of the engine, since every existing case needs a paused
variant. Correct to build; wrong to bolt on in a hurry.

**Escalation rules.** Auto-reassign or notify a lead when a ticket crosses its
at-risk mark. The data is already there — `firstResponseAtRiskAt` is indexed —
so this is a scheduled job querying the same predicate the filter uses.

**Notifications.** Email or Slack on assignment, first response and breach. Best
driven off an outbox table written in the same transaction as the state change,
so a delivery failure cannot lose the event.

**Per-team business calendars.** `BusinessHoursContext` is already a parameter
rather than a global, so this is mostly a schema change: a `Team` model owning
its own hours and holiday set, and building the context per ticket instead of
per request.

**Audit trail.** An append-only `TicketEvent` log of every status change,
assignment and SLA transition, with actor and timestamp. Needed for any real
support organisation, and it would make "why did this breach?" answerable.

**Agent performance metrics.** Median first-response time, breach rate per
agent, throughput per week. Straightforward aggregate queries once the audit
trail exists.

**Recurring holidays.** `Holiday` currently stores concrete dates, so 15 August
must be re-seeded each year. A recurrence rule (or a generator that materialises
N years ahead) would remove that annual chore.

**Frontend polish.** Optimistic updates, a real toast system rather than inline
banners, keyboard navigation for the ticket list, and generated types from the
schema instead of hand-written response interfaces.

---

## Known limitations

Stated honestly:

- **Ticket list refetches rather than live-updating.** There are no
  subscriptions or polling, so a ticket that breaches while you are looking at
  the dashboard will not change colour until you refilter or reload. The
  frontend deliberately will not flip that state locally.
- **Policy changes are not retroactive.** Stored deadlines mean editing
  `SLA_POLICIES` affects only tickets created afterwards. Applying a change to
  existing tickets needs a backfill migration.
- **`AGENT_SIGNUP_CODE` is a single shared secret.** It cannot be rotated per
  invite or revoked individually. Real deployments want per-invite tokens or
  admin-initiated provisioning.
- **No refresh tokens.** A 7-day JWT cannot be revoked before it expires; a
  compromised token stays valid. Logout only clears client-side storage.
- **No rate limiting** on login or registration, so the API is open to
  brute-force attempts at the network level.
- **Comment threads are unpaginated.** A ticket with thousands of comments would
  load them all. The `(ticketId, createdAt)` index is in place for when this
  needs fixing.
- **`endCursor` follows the Relay convention**, returning the last node's cursor
  even on a final page. Following it yields an empty page rather than `null`.
- **No file attachments**, no rich text, and no full-text search over ticket
  bodies.
- **No committed end-to-end tests.** The frontend has 70 committed component
  and unit tests, but the full-stack click-through (real browser against a
  running API) was scripted ad hoc rather than committed, so it does not run in
  CI.
- **`bun.lock` is generated in a Linux container.** Bun on the Windows host used
  for development cannot write a lockfile (`EINVAL` on the atomic replace), so
  it is produced via `docker run oven/bun`. CI uses it normally.
