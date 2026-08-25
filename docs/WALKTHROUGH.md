# Video walkthrough script (5–10 minutes)

Rough timings in brackets. Bullets are talking points, not a word-for-word
script — say them in your own words.

Before recording: `docker compose up -d --wait`, `bun run gendb` in `server/`,
`bun run dev` in both `server/` and `web/`. Have the app open at
`localhost:5173` signed in as `agent@example.com`, plus an editor.

---

## 1. What it is [0:00 – 0:45]

- Support ticket system with **business-hours-aware SLA tracking**.
- Two roles: reporters raise tickets, agents work them.
- The interesting part isn't CRUD — it's that SLA deadlines respect working
  hours, weekends and public holidays, and that SLA state is **queryable in
  SQL** rather than computed in application code.
- Show the dashboard: counters across the top, ticket list with colour-coded SLA
  badges below.

---

## 2. Architecture [0:45 – 2:00]

Show the `server/src/` tree.

- Strict layering: **resolvers → services → repositories → Postgres**.
- **Resolvers are thin** — open `graphql/resolvers/ticket.ts`. Every one is
  parse input → guard → call service → return. No business rules, and
  deliberately zero date arithmetic.
- **Repositories own every query.** Filters, visibility, SLA predicates, sorting
  and pagination are all Prisma `where` objects that compose into one statement.
- **Schema-first GraphQL**: SDL lives in `.graphql` files, loaded by glob;
  resolvers are separate TypeScript typed against `graphql-codegen` output. Show
  `schema/ticket.graphql` next to `resolvers/ticket.ts`.
- Point out **`services/sla/` imports nothing** — no Prisma, no GraphQL, no env,
  never calls `Date.now()`. Say clearly: *this was a deliberate decision and
  it's the thing I'd defend hardest.*

---

## 3. The SLA engine [2:00 – 3:45]

Open `services/sla/businessHours.ts` and `slaPolicy.ts`.

- Business hours **Mon–Fri 09:00–18:00**, so nine hours a day.
- Budgets in the policy table, stored as **business minutes**:
  URGENT 1/4h, HIGH 4/24h, MEDIUM 8/48h, LOW 24/72h.
- **Anchoring**: a ticket that arrives at 20:00 doesn't start its clock until
  09:00 the next working day. Saturday anchors to Monday.
- **Walk the worked example out loud**: a HIGH ticket created **Friday 17:00**.
  Four business hours. Friday gives one hour before close, the weekend gives
  nothing, so three hours come off Monday morning → **due Monday 12:00**.
- Note `addBusinessMinutes` walks **whole day-windows**, not minute by minute,
  so cost scales with days crossed, not with the size of the budget. There's a
  400-iteration guard that throws rather than spinning.
- **Timezone handling**: everything is stored UTC; only the business-hours
  reasoning happens in `BUSINESS_TIMEZONE` (default Asia/Kolkata). Convert in,
  do the arithmetic, convert back. An unknown zone fails fast instead of
  silently producing invalid dates.
- **Holidays** come from a table and contribute zero minutes. Because `@db.Date`
  is materialised at midnight UTC, the calendar date is read in UTC — reading it
  in a zone behind UTC would shift the holiday a day earlier.

---

## 4. The key design decision [3:45 – 5:15]

This is the centrepiece. Open `prisma/schema.prisma`, show the four
precomputed columns on `Ticket`.

- At creation the engine computes `firstResponseDueAt`, `resolutionDueAt` and
  the two at-risk marks **once**, and they're stored on the row.
- SLA state is then a **plain timestamp comparison**. Open
  `repositories/ticketRepository.ts` → `slaStateWhere`.
- Explain why the alternative fails. Deriving state in JS would mean:
  - filtering by `slaState` requires loading the whole table into memory;
  - the dashboard's five counts become full scans;
  - and — the one that actually kills it — **cursor pagination breaks**, because
    the database can't know how many rows a page should contain, so `LIMIT`
    returns the wrong count.
- Point at the two composite indexes, `(firstResponseAt, firstResponseDueAt)`
  and `(resolvedAt, resolutionDueAt)` — ordered to match those predicates.
- **The 75% boundary**: at-risk at 75% of the budget, and be precise — *at
  exactly 75% the ticket is still ON_TRACK; AT_RISK starts after*. Tested on
  both sides.
- **Clock freezing**: once `firstResponseAt` or `resolvedAt` is stamped that
  clock reads **MET permanently** and can never become BREACHED. A late reply
  still counts as met — the clock stopped when the event happened.
- Corollary worth stating: **reopening never clears `resolvedAt`**, so reopening
  can't retroactively turn a met SLA into a breach.
- Honest trade-off: policy changes aren't retroactive. Arguably right — a ticket
  should be held to the SLA that applied when it was raised — but a retroactive
  change needs a backfill.

---

## 5. Status transitions [5:15 – 6:00]

Open `services/ticket/statusMachine.ts`.

- Explicit table, enforced server-side, not trusted from the client.
- `CLOSED` is near-terminal: the only exit is an explicit reopen to `OPEN`.
- **Demo it live**: on a closed ticket, pick "In progress" from the status
  dropdown. Show the red banner reading
  *"Ticket cannot transition from CLOSED to IN_PROGRESS."*
- Make the point: that's **HTTP 200 with a typed error**, not a 500. The code is
  `INVALID_STATUS_TRANSITION`, and the frontend renders the server's message
  verbatim because the server owns the rules.
- Same-status transitions are rejected too — usually a double-submitted
  mutation.

---

## 6. First response tracking [6:00 – 6:45]

Open a ticket in the UI with a thread.

- The first-response clock stops on the first comment **from somebody other than
  the reporter**. A reporter chasing their own ticket isn't a response.
- Comment insert and the stamp run **in one transaction** — otherwise a crash
  between them leaves a ticket whose SLA says unanswered while a reply is
  visible.
- The stamp is an `updateMany` guarded on `firstResponseAt: null`, so it's
  atomic: two agents replying at once can't both stamp. Mention you found that
  race by inspection, not from a failing test.

---

## 7. Testing strategy [6:45 – 8:15]

Run `bun run test` and let it finish while you talk.

- **183 tests: 138 unit, 45 integration.**
- Unit tests for the SLA engine use **fixed, hand-computed dates** — no clock
  stubbing, no mocks, no database. That's the payoff for keeping the module
  pure. Show a couple in `tests/unit/businessHours.test.ts`, e.g. the Friday
  17:59 + 2h → Monday 10:59 case and the holiday worked example.
- Mention the guard test that pins the weekdays of the reference week, so a bad
  calendar assumption fails loudly instead of as a confusing off-by-a-day.
- **Integration tests hit real Postgres in Docker with nothing mocked.** They
  drive real GraphQL through the production Yoga instance in-process via
  `yoga.fetch()` — no HTTP listener — so it's schema → resolvers → services →
  Prisma → Postgres.
- Open `tests/integration/firstResponse.test.ts`: assertions are against the
  **database**, read back with Prisma, not just the API response. It proves the
  four SLA timestamps round-trip through Postgres and match the engine exactly.
- The suite runs `prisma migrate deploy` first, so the **migrations** are
  verified, not just the schema file.
- N+1: DataLoaders batch `reporter`, `assignee`, `comments` and comment authors.
  Measured — a page of tickets expanding all of those runs **4 queries**, not one
  per row.
- CI runs lint, typecheck and both suites against a `postgres:16` service.

---

## 8. Frontend [8:15 – 9:00]

- Vite + React + TypeScript, hand-written CSS, **no component library and no
  state-management library** — the spec asked for correctness, not polish.
- **Hard rule**: the frontend never computes SLA anything. Open
  `components/SlaBadge.tsx` and read the comment — it renders the state and
  remaining minutes the API returns, and must never flip ON_TRACK to BREACHED on
  its own. It refetches instead.
- Timestamps render in the viewer's local timezone via `toLocaleString()`.
- Shared error renderer keyed on `extensions.code`: validation errors go inline
  next to fields, permission problems get a banner, transition errors show the
  server's wording.
- **Resize to 375px**: the table collapses to stacked cards, filters stack
  vertically. One breakpoint at 768px.
- Sign in as `reporter@example.com` and show the agent controls are gone and
  only their own tickets are listed — enforced in the **WHERE clause**, not
  hidden in the UI.

---

## 9. Trade-offs and what's next [9:00 – 10:00]

Be direct about what you didn't build and why.

- **Biggest omission: pausing the SLA while waiting on the customer.** Explain
  why it's genuinely hard rather than just unfinished — a deadline stops being a
  single stored timestamp, you need a paused-minutes accumulator plus an open
  pause marker, the SQL predicates gain a term (which is what currently makes
  them indexable), and it roughly doubles the engine's test surface.
- Others, briefly: escalation on at-risk, notifications via an outbox table,
  per-team calendars (the context is already a parameter), an append-only audit
  trail, agent metrics, recurring holidays.
- Limitations worth owning: no live updates, no refresh tokens, no rate
  limiting, unpaginated comment threads, `AGENT_SIGNUP_CODE` is one shared
  secret, and no automated frontend tests.
- Close on the through-line: **the SLA rules are the product, so they live in one
  pure, heavily tested module, and the database — not the client, and not the
  resolvers — is the source of truth for SLA state.**
