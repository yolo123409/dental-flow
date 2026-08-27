# DentalFlow — Environments

FIN-4.1. Every claim below is labeled the same way `DISASTER_RECOVERY.md`
labels its own: **VERIFIED** (actually run and observed in this
environment), or **GAP — MANUAL STEP REQUIRED** (a real limitation this
repository cannot close on its own). Nothing here is described as done
unless it was actually done.

## 1. What exists today — audited, not assumed

**VERIFIED**: exactly two Supabase projects are referenced anywhere in
this repository or its configuration:

1. **Production** — `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_DB_URL` /
   `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`. This is the project the
   deployed application serves real users from, **and** the project
   `npm run dev` connects to locally, **and** the project every FIN-3
   live-verification test in this codebase's history ran against
   (made safe only by manual `BEGIN`/`ROLLBACK` transaction discipline,
   never by environment isolation).
2. **restore-test** — `RESTORE_TEST_DB_URL` / `RESTORE_TEST_SUPABASE_URL`
   / `RESTORE_TEST_SUPABASE_SERVICE_ROLE_KEY`. Built for disaster-recovery
   restore drills (`docs/DISASTER_RECOVERY.md`) and **live-verified,
   repeatedly, to be a genuinely different physical Postgres cluster**
   from production — not just a different URL — via each cluster's own
   `system_identifier` (`scripts/backup/lib/env.mjs`
   `assertDistinctProjects`). Until this phase, it was used only for DR
   drills: restored with real production data, verified, then wiped
   empty again after every drill.

**There is no third project.** Development and Production are, today,
the same physical database. There is no repo-visible hosting/deploy
configuration (no `vercel.json`, no `.vercel/` link) — if the app is
deployed via a host like Vercel, that host's project settings and
environment variable scoping live outside this repository and were not
discoverable from here. **GAP** — see §4 (unchanged by FIN-4.6; closing
it requires the same external Supabase account action as the
Development tier below).

~~There is also no CI workflow that runs `tsc`, the test suite, or
`next build` on push or PR~~ — **CLOSED by FIN-4.6.** See §6.

## 2. What this phase built

The restore-test project already had the one property that actually
matters — live-proven isolation from production. What it didn't have was
a way to get a **current, real schema onto it without real data** — every
existing path to populate it (the DR restore script) necessarily brings
real patient/financial rows along with the schema, which is exactly what
staging must never hold.

**VERIFIED**: `npm run staging:sync-schema`
(`scripts/staging/sync-schema.mjs`) closes that gap. It:

1. Runs the same `assertDistinctProjects` safety gate the DR restore
   script uses — refuses to run unless the target is live-proven to be a
   different cluster than production.
2. Reads production's schema via **live catalog introspection only**
   (`buildSchemaSql`, extracted from the backup pipeline into
   `scripts/backup/lib/ddl-generator.mjs` in this same phase so both
   scripts share one definition of "the schema" instead of risking two
   copies drifting apart) — no table's row data is ever read.
3. Drops and recreates the restore-test project's `public` schema (the
   same reset the DR restore script already performs at the start of
   every drill), then applies that DDL.

Run for real against the live restore-test project this phase: **61
tables, 84 functions, 0 rows** — confirmed via `pg_stat_user_tables`
after the sync. This picks up every migration through `0098` (the
FIN-3.10 regression fix), including the foundational tables
(`clinics`, `patients`, `dentists`, `appointments`, `clinic_users`,
`profiles`) that predate migration tracking and are not created by any
file in `supabase/migrations/` — because, like the backup pipeline,
this reads what's actually live, not the migration history.

This is compatible with, not disruptive to, the existing DR drill
process: a drill already unconditionally drops and rebuilds this same
schema at the start of every run, so leaving it schema-populated
between syncs changes nothing about that script's behavior.

Also created this phase:
- `.env.example` — every environment variable this repo's app and
  scripts read, documented by purpose and tier, no real values. `.gitignore`
  updated (`!.env.example`) so it's actually committed despite the
  blanket `.env*` ignore rule.
- Noted, not removed: `OPENAI_API_KEY` in `.env.local` is unused —
  no code in this repository reads it (leftover from the removed AI
  receptionist feature). Flagged in `.env.example`, left in place since
  modifying a live credential file wasn't requested.

## 3. Target architecture vs. today

```
Developer workstation
      |
      v
 Development .......... GAP — same project as Production today (see §4)
      |
      v
 Staging / UAT ........ VERIFIED this phase — restore-test project,
      |                 schema-synced from production, zero real data,
      |                 seeded with synthetic data only (FIN-4.2)
      v
 Production ............ unchanged, real users, real data
```

## 4. The gap this phase cannot close from the repository

A genuinely separate **Development** tier — a third Supabase project
individual developers point their local `npm run dev` at, so that even
day-to-day local development never touches real data — requires creating
a new Supabase project. That is an external account action (Supabase
dashboard or CLI login), which this repository and this session cannot
perform. Per this phase's own instruction: documenting the manual steps
here rather than claiming it's done.

**Manual steps to close this gap:**

1. Create a new Supabase project (dashboard: New Project) — this becomes
   Development.
2. Run `npm run staging:sync-schema`'s equivalent against it once
   `RESTORE_TEST_DB_URL`/`RESTORE_TEST_SUPABASE_URL` are pointed at it
   temporarily (or extend the script to accept a target env-var pair as
   an argument, if this becomes a recurring need rather than a one-time
   setup).
3. Seed it with synthetic data (the FIN-3.10 47-branch generator pattern,
   or a smaller fixed dataset) — never restore real production data into
   it.
4. Give each developer their own `.env.local` pointed at this project's
   `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY`/
   `SUPABASE_SERVICE_ROLE_KEY`, instead of production's.
5. Until this is done, treat every local `npm run dev` session as if it
   were running against production — because it is.

**What this phase deliberately did not do**: change `.env.local`'s
existing `NEXT_PUBLIC_SUPABASE_URL`/`SUPABASE_DB_URL` to point away from
production. That file is the user's live, working configuration; silently
repointing it would break the running application without a replacement
project to point it at instead. Closing this gap for real is a decision
for whoever owns the Supabase account, not something to improvise here.

## 5. Preventing accidental production testing, going forward

- Every script that can write anywhere (`restore-database-test.mjs`,
  `restore-storage-test.mjs`, and now `sync-schema.mjs`) refuses to run
  unless `assertDistinctProjects` passes first — this is enforced in
  code, not left to operator discipline.
- `sync-schema.mjs` never reads a row of production data, by
  construction (only catalog/introspection queries touch the production
  connection).
- FIN-4.2's database integration tests run against `RESTORE_TEST_DB_URL`,
  never `SUPABASE_DB_URL` — the first time this codebase's automated
  tests, rather than manual rollback discipline alone, are the thing
  keeping verification off production.
- **FIN-4.6**: `scripts/db/whoami.mjs` (`npm run db:whoami -- <ENV_VAR>`)
  live-verifies which real project any of this repo's DB env vars
  actually points at, before a human runs manual SQL against it — see
  §6.3. `npm run dev` now prints a loud, non-blocking banner
  (`scripts/dev-safety-check.mjs`, wired as `predev`) naming the project
  it's about to connect to, since it cannot yet be stopped from
  defaulting to production (§4 is still open).

## 6. FIN-4.6 — CI pipeline and migration safety

**VERIFIED**: `.github/workflows/ci.yml` now runs on every pull request
and every push to `main`:

```
checkout -> npm ci -> tsc --noEmit -> vitest -> staging:sync-schema
  -> staging:apply-pending-migrations -> test:db-integration -> build
```

If any step fails, the workflow fails — including the database
integration step. The exact FIN-3.8 regression class (scenario 1 in
`scripts/staging/db-integration-tests.mjs`, "Invoice creation with
invoice items succeeds") runs on every single PR now, not only when
someone remembers to run it by hand.

**Required GitHub Actions secrets** (repository settings → Actions →
secrets — this session cannot set these itself, only reference them by
name in the workflow file): `SUPABASE_DB_URL`, `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `RESTORE_TEST_DB_URL`,
`RESTORE_TEST_SUPABASE_URL`. The first four already exist as secrets on
this repository if `.github/workflows/backup-database.yml` has ever run
successfully — only `NEXT_PUBLIC_SUPABASE_ANON_KEY` is new (needed only
so `next build`'s static analysis can construct a Supabase client
without throwing; it is the public anon key, already shipped inside the
production browser bundle — not a service-role credential). **This
session cannot confirm from the repository whether these secrets are
actually configured on GitHub, or whether the workflow has actually run
once green** — that verification requires access to the GitHub repo's
Actions tab. **GAP — MANUAL VERIFICATION REQUIRED.**

### 6.1 Why `staging:sync-schema` alone isn't enough for CI

`sync-schema.mjs` mirrors production's *current, already-live* schema.
A migration added in an open PR, not yet applied to production, is
invisible to a fresh sync — so testing only against a synced staging
database would never actually exercise a new migration before it ships.

### 6.2 `staging:apply-pending-migrations` and `.production-baseline`

`supabase/migrations/.production-baseline` is a plain text file
containing the number of the last migration verified live in production
(`0101` as of FIN-4.6). `npm run staging:apply-pending-migrations`
applies every migration file numbered higher than that, in order, onto
staging (and only staging — this script has no production target at
all, not a flag, not an env var). This is what lets CI behaviorally
test a new migration's real SQL before it is ever applied to
production.

**This baseline file must be bumped by hand, in the same PR, whenever a
migration is actually applied to production** — it is a deliberate,
reviewable marker, not an automated tracking table. No such tracking
table exists in production itself: every migration in this repo's
history (0001-0101) was applied by hand over a raw connection, and
FIN-4.6 did not invent new production-side infrastructure to replace
that — see §6.4.

### 6.3 `scripts/db/whoami.mjs` — explicit environment confirmation

`npm run db:whoami -- SUPABASE_DB_URL` (or any other `*_DB_URL`)
live-queries that connection string's Postgres cluster identity and
reports, from real data, whether it is PRODUCTION, RESTORE-TEST/STAGING,
or unknown — never from the variable's name alone, which could be
stale, typo'd, or copy-pasted wrong. Meant to be run by a human before
pasting SQL into any ad hoc script against a `*_DB_URL`, closing the gap
that let every prior migration in this repo be applied without any
tooling-enforced confirmation step at all.

### 6.4 What FIN-4.6 deliberately did not build

- **A production migration-tracking table.** Would be a production
  schema change beyond what this phase's brief asked for, and risks
  silently mis-marking a migration as "already applied" if built wrong.
  Applying a migration to production remains a manual, human-reviewed
  act — `db:whoami` (§6.3) makes that act safer, not automatic.
- **A `--target=production` mode for any staging script.** Every
  script this phase touched or added has exactly one non-production
  target, by construction — there is no flag that could send it to
  production by mistake.
- **Per-PR ephemeral staging databases.** CI's `concurrency: group:
  ci-staging-db` setting means two CI runs never touch staging at the
  same time — a second PR's CI queues behind the first rather than
  running in parallel. This is a real limitation, not a false one: true
  per-run isolation needs either a second Supabase project (the same
  external-account-action gap as the Development tier, §4) or a
  database-per-branch strategy this phase didn't build. Today's
  trade-off is correctness over speed: serialized, not corrupted.
