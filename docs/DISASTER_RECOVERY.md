# DentalFlow — Disaster Recovery

This is the canonical disaster recovery document. It supersedes
`docs/disaster-recovery.md` (kept only as a pointer to this file for
history).

Every claim below is labeled **VERIFIED** (actually executed and
observed in this environment), **IMPLEMENTED, NOT YET RUN** (code
exists and is believed correct but has not been exercised end-to-end),
or **TARGET** (a goal, not yet demonstrated). Nothing is described as
working unless it was actually run and observed working.

## 1. Architecture

Two independent backup pipelines, because Supabase's own backup
mechanisms (where available) do not cover Storage:

1. **Database** (`scripts/backup/backup-database.mjs`) — connects
   directly to Postgres (via the `pg` driver; no `pg_dump`/`psql`/Docker
   are available in the environment this was built in), and produces a
   backup from two live sources:
   - **Schema**: real DDL generated from live catalog introspection
     (`pg_catalog`/`information_schema`) — tables, columns, constraints,
     indexes, triggers, functions/RPCs, table grants, RLS enable flags,
     and RLS policies. **Not** sourced from `supabase/migrations/`:
     verified during implementation that several foundational tables
     (`clinics`, `patients`, `dentists`, `appointments`, `clinic_users`,
     `profiles`) predate migration tracking in this repo and are never
     `CREATE TABLE`'d by any migration file — a migrations-only bundle
     would fail to restore. Live introspection reflects whatever is
     actually running in production regardless of migration history.
   - **Data**: every row of every `public`-schema table, read via
     `SELECT *` and serialized to JSON, batched by table in FK-dependency
     order (parents before children) so restore can insert safely.
   - Only the `public` schema is touched. Supabase-managed internal
     schemas (`auth`, `storage`, `realtime`, `supabase_functions`,
     `pgsodium`, `vault`, `extensions`) are deliberately excluded — they
     are provisioned automatically on any Supabase project and are not
     part of this application's own schema.
2. **Storage** (`scripts/backup/backup-storage.mjs`) — Supabase database
   backups do **not** include Storage objects. This walks every bucket
   via the service-role Storage API (list/download only — never
   remove/update on the source) and uploads a copy of every object to
   R2 under `storage/<bucket>/<path>`, with a manifest recording
   bucket, path, size, content-type, and a SHA-256 checksum per object.

Both pipelines: compress (gzip, DB only — Storage objects are already
mostly-compressed binary formats), checksum (SHA-256), optionally
encrypt client-side (§4), upload to the private R2 bucket, and verify
the upload with an independent `HEAD` request comparing size before
declaring success. Both exit non-zero on any failure and never log
credentials or row/file content — only counts, sizes, and checksums.

**Measured, real (most recent run, 2026-08-22)**: production database
is 46 MB (`pg_database_size`), 59 tables, 75,492 rows (74,719 of which
are the imported ICD-10-CM `clinical_codes` reference set — real
clinic/patient/financial data is closer to 800 rows across the
remaining tables). The full backup compresses to 2.48 MB (91% smaller
than the 24.95 MB uncompressed JSON representation) — 2,484,192 bytes
unencrypted, 2,484,231 bytes with client-side encryption enabled (the
39-byte difference is AES-GCM's 12-byte IV + 16-byte auth tag overhead
plus minor gzip variance).

## 2. Backup frequency

**VERIFIED, active**: `.github/workflows/backup-database.yml` is
pushed to the repository and its schedule is live — `cron: "0 3 * * *"`
(03:00 UTC daily), plus `workflow_dispatch` for on-demand runs. A
`concurrency` group (`cancel-in-progress: false`) guarantees two backup
runs never overlap — a trigger that fires while one is in progress
queues behind it rather than racing or cancelling it. The job runs with
least-privilege `permissions: contents: read`.

**VERIFIED**: a real run of this workflow completed successfully
(2026-08-22) against production, producing a real backup that was later
used as the source for every restore drill described in §7–§10. Several
additional real runs were also triggered manually from this environment
during implementation and verification (via `npm run backup:all`,
exercising the exact same scripts the workflow calls).

**Two real bugs in the workflow itself were found and fixed by actually
running it, not by review**:
- The Node.js version originally configured (20) lacks the native
  `WebSocket` global that `@supabase/supabase-js`'s `realtime-js`
  dependency requires, failing the Storage-backup step with `FATAL:
  Node.js 20 detected without native WebSocket support`. Fixed by
  bumping to Node 22 for this workflow only — no `package.json`
  `engines` field pins a version, so the deployed application's own
  runtime is unaffected.
- The workflow's `env:` block was initially missing `RESTORE_TEST_DB_URL`
  and (later) `RESTORE_TEST_SUPABASE_URL` and
  `RESTORE_TEST_SUPABASE_SERVICE_ROLE_KEY` — required by the preflight
  and, for the latter, by an isolated Storage restore test (§8) — which
  would have failed every scheduled run at the first step. Fixed by
  adding all three as required workflow secrets.

**Not yet independently observed**: a second, purely *schedule*-triggered
(not manually dispatched) run from this environment, since the schedule
was only activated recently relative to this document. See §10 for what
that means for RPO specifically — "daily" is the active, correctly-wired
configuration, not yet a multi-day observed cadence from here.

**Retention**: `npm run backup:retention -- --execute` runs
automatically after every successful backup (`if: success()`), applying
the policy in §5 for real, not in dry-run. Whether this step has
actually executed inside a live GitHub Actions run (as opposed to being
correctly wired in the workflow file) has not been independently
confirmed from this environment — this repository has no `gh` CLI
access to query Actions run logs directly.

## 3. Backup destination

Cloudflare R2, bucket `dentalflow-backups`, **private — no public
access**, S3-compatible API. Chosen over AWS S3 for a simpler setup (no
IAM policy authoring, no egress fees, free tier covers this project's
data volume many times over) — this is Storage-only usage of
Cloudflare, not a migration of any application infrastructure. Bucket
privacy and reachability are both re-verified live by
`check-config.mjs` before every backup or restore run, not assumed.

Layout:
```
db/<ISO-timestamp>.json.gz[.enc]       - one full DB backup
db/<ISO-timestamp>.meta.json           - its metadata (size, checksum, row/table counts, duration)
storage/<bucket>/<original-path>[.enc] - one Storage object backup
storage/manifest-<ISO-timestamp>.json  - manifest for one Storage backup run
```

## 4. Encryption

- **In transit**: TLS, both from this environment to Supabase Postgres
  and to R2 (HTTPS). Not configurable/disable-able by this code — it's
  the transport itself.
- **At rest**: Cloudflare R2 encrypts all stored objects at rest by
  default, unconditionally, with no configuration required.
- **Client-side, additional layer — VERIFIED, active**: AES-256-GCM
  (`scripts/backup/lib/crypto.mjs`, Node's built-in `crypto` module
  only — no third-party cryptography library), gated on a
  `BACKUP_ENCRYPTION_KEY` environment variable. **Current status:
  configured.** Real encrypted database and Storage backups have been
  produced, and real encrypted restores (§7, §8) have been performed
  and verified against them.
- **Key requirement**: exactly 32 bytes, base64-encoded (~44 characters
  including padding). `encryptBuffer`/`decryptBuffer` both decode and
  hard-check the length before use and throw immediately if it doesn't
  decode to exactly 32 bytes. **The actual key value is never recorded
  in this document, in source, in any script, or in any log — only its
  required format.**
- **What gets encrypted**: the full database backup payload
  (`backup-database.mjs`) and each individual Storage object
  (`backup-storage.mjs`), independently, both gated on the same
  `BACKUP_ENCRYPTION_KEY`.
- **What does NOT get encrypted, by design**: backup metadata
  (`db/<runId>.meta.json`) and the Storage manifest
  (`storage/manifest-<runId>.json`) are always uploaded as plain JSON,
  encryption key or not. That means table/row counts, per-table
  checksums, timings, bucket names, and — for the Storage manifest
  specifically — every object's **path** (which can embed
  patient-chosen filenames) remain readable without the key. This is
  necessary for the restore procedure itself (the restore script must
  be able to find and validate a backup before it can decrypt it), and
  is an accepted, understood property of the design, not an oversight.
- **Checksum convention — the two pipelines differ, documented exactly
  because this is easy to get wrong**:
  - **Database backup**: SHA-256 is computed on the upload body
    **after** encryption — the checksum is of the ciphertext.
    `restore-database-test.mjs` mirrors this: it hashes the raw
    downloaded bytes *before* decrypting and compares against
    `meta.sha256`.
  - **Storage backup**: SHA-256 is computed on each object's buffer
    **before** encryption — the checksum is of the plaintext.
    `restore-storage-test.mjs` mirrors this: it decrypts first, then
    hashes the plaintext and compares against the manifest's recorded
    `sha256`.
  - Each pipeline is internally self-consistent with its own restore
    path (both have been verified to correctly detect a mismatch, see
    §11), but the two conventions are not the same as each other. A
    future engineer comparing a Storage object's checksum against a
    database backup's checksum semantics (or vice versa) would be
    comparing different things.
- **Key storage — VERIFIED, three independent locations as of
  2026-08-22**: local `.env.local` (gitignored — see `.gitignore:34`,
  never committed), the `BACKUP_ENCRYPTION_KEY` GitHub Actions
  repository secret (referenced by the workflow, §2), and an
  independent secure password manager / secrets vault, added
  specifically as a recovery copy separate from the two operational
  locations above. **Recovery-key verification was performed and
  passed** (2026-08-22): the key loaded from the operational locations
  was confirmed to still successfully decrypt and fully restore a real
  encrypted backup, without rotating or replacing it.
- **Key-loss safety, VERIFIED**: decrypting with an intentionally
  incorrect key was tested directly against a real encrypted backup
  object. It failed cleanly with AES-GCM's authentication-tag rejection
  (`Unsupported state or unable to authenticate data`) — no bytes were
  returned, nothing partially decrypted, nothing that could be mistaken
  for a usable (if corrupted) restore.
- **What happens if the real key is lost**: **a backup encrypted with a
  lost key is not recoverable.** There is no key-recovery mechanism, by
  design (a recoverable key defeats the point of encryption) — the
  three-location redundancy above reduces the *likelihood* of losing
  the key, it does not change this fact. Losing all three copies is
  equivalent to losing every backup encrypted with that key, even
  though the (still-private, still access-controlled) R2 copies would
  still physically exist as undecipherable ciphertext.
- **Key recovery procedure** (what to do if the *operational* copies —
  local `.env.local` and the GitHub Actions secret — are lost, but the
  independent recovery copy is not): retrieve the key from the secure
  password manager / secrets vault, add it back to `.env.local` locally
  and/or re-add the `BACKUP_ENCRYPTION_KEY` GitHub Actions secret. Never
  place the retrieved key in source control, in this document, in a
  commit message, in a script, or in any log output.

## 5. Retention

**Policy** (`scripts/backup/apply-retention.mjs`): keep every daily
backup for 30 days, then one per week for the next 12 weeks, then one
per month for the next 12 months; everything else eligible for
deletion.

**VERIFIED**: the classification logic itself, against synthetic
timestamped data (not real backups) — 71 synthetic entries in, 47 kept
/ 24 correctly marked for removal, partition correctness confirmed
(every input in exactly one of keep/remove, nothing invented).

**Current real state (2026-08-22)**: real database backups in R2 are
all within the 30-day daily window — dry-run correctly reports 0
eligible for removal. Given how recently automation was activated (§2),
this has not yet been exercised against a backup old enough to actually
require deletion.

**Now enabled for real deletion in the automated workflow** (`--execute`,
not `--dry-run` — see §2), once upload verification and a real restore
had both been proven, per this project's policy: auto-deleting backups
before proving a restore works would have risked deleting the only good
copy. Running `npm run backup:retention` manually (without `--execute`)
still defaults to a safe dry-run for ad hoc use outside the automated
workflow. Once enough real backup history has accumulated to make
retention meaningful at scale, prefer moving this to R2's own lifecycle
rules (provider-side, cannot be defeated by an application bug) over
continuing to run it as application logic.

## 6. Required credentials / secrets

| Variable | Purpose | Where it lives |
|---|---|---|
| `SUPABASE_DB_URL` | Direct Postgres connection to production, used only for reading during backup | `.env.local` (gitignored) locally; GitHub Actions secret |
| `RESTORE_TEST_DB_URL` | Postgres connection to a disposable, isolated Supabase project used **only** for restore testing — must be live-verified (§7) to be a genuinely different cluster than production before any restore proceeds | `.env.local` (gitignored), never committed; GitHub Actions secret |
| `RESTORE_TEST_SUPABASE_URL` | That same disposable project's public Supabase project URL (`https://<ref>.supabase.co`) — used to establish project identity, since Session/Transaction pooler hostnames are region-based and do not contain the project ref | `.env.local` (gitignored); GitHub Actions secret |
| `RESTORE_TEST_SUPABASE_SERVICE_ROLE_KEY` | That same disposable project's Storage API service-role key — lets the isolated Storage restore test (§8) target the disposable project's own Storage, not production's | `.env.local` (gitignored); GitHub Actions secret |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME` | R2 destination + scoped credentials (should be an Object Read & Write token scoped to the single `dentalflow-backups` bucket only, not full-account access) | `.env.local` (gitignored); GitHub Actions secret |
| `BACKUP_ENCRYPTION_KEY` | Client-side AES-256-GCM key (§4) — configured | `.env.local` (gitignored); GitHub Actions secret; independent secure recovery vault |
| `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Already-existing app credentials (production), reused for the Storage *backup* pipeline only | Already present in `.env.local`; GitHub Actions secret |

None of these are printed, logged, or committed anywhere by any script
in `scripts/backup/`. `check-config.mjs` verifies presence and shape
(project refs, bucket name) without ever printing a secret value.

## 7. Database restore procedure

**Production must never be used as a restore target — this is enforced
by the code, not just documented as a rule.**

1. Run `npm run backup:restore-test` (`scripts/backup/restore-database-test.mjs`).
2. **Preflight identity check**: the script refuses to run unless two
   independent proofs both hold (`assertDistinctProjects` in
   `lib/env.mjs`):
   - **Declared identity**: `NEXT_PUBLIC_SUPABASE_URL` (production) and
     `RESTORE_TEST_SUPABASE_URL` (disposable) name different project
     refs — cheap, no network call.
   - **Actual identity, live**: `SUPABASE_DB_URL` and
     `RESTORE_TEST_DB_URL` are each connected to and their Postgres
     `system_identifier` (a globally-unique per-cluster fingerprint from
     `pg_control_system()`) is compared. This, not pooler hostname
     comparison, is what actually proves two connection strings reach
     genuinely different physical clusters — Session/Transaction pooler
     hostnames are region-based (e.g.
     `aws-0-eu-west-1.pooler.supabase.com`) and do not contain the
     project ref, so two unrelated projects in the same region can share
     one. An earlier version of this check compared pooler hostnames
     directly and was a real, confirmed bug for exactly that reason —
     fixed and replaced with the live `system_identifier` check
     described here.
   It will not restore into production under any circumstance this
   check can detect, by construction, not just by convention.
3. It downloads the most recent backup from R2 and verifies its
   checksum (§4 — before decryption, since the DB pipeline's checksum is
   of the ciphertext), decompresses (and decrypts first, if the backup
   is encrypted — detected automatically from the backup's own
   metadata, no manual step required), then:
   a. Applies the generated schema DDL to the restore-target database.
   b. **Disables application-side triggers before loading data**
      (`ALTER TABLE ... DISABLE TRIGGER USER` on every table, `ENABLE
      TRIGGER USER` in a `finally` block guaranteed to run even on
      failure). `USER`, deliberately not `ALL`: Postgres's own internal
      foreign-key-enforcement triggers are excluded from `USER` and stay
      active for the whole data-load phase, so referential integrity is
      never weakened. See the explanation of *why* this exists below.
   c. Inserts every row of every table, in FK-safe order, with triggers
      disabled.
   d. Re-enables every trigger.
4. It then runs verification (§9) and prints a PASS/FAIL report.
5. **Cleanup, required after every restore test**: once verification is
   complete and results have been recorded, drop and recreate the
   restore-target's `public` schema (`drop schema public cascade;
   create schema public; ...`), re-confirming the live
   `system_identifier` distinctness check immediately beforehand as an
   extra safety margin. The disposable project should be left empty
   between drills, not accumulating restored data — it is never
   connected to production users, the app is never pointed at it, and
   no emails are sent from it (the script only issues raw SQL; no
   application/email code path runs).

### Why triggers are disabled during data load

Several tables carry application-side `AFTER INSERT` triggers with real
side effects — most importantly, `clinic_invoices`, `clinic_payments`,
and `clinic_expenses` each post entries into `clinic_ledger_entries` as
part of normal application behavior. A real restore drill (2026-08-22)
found that restoring their backed-up rows via plain `INSERT` re-fired
those triggers, generating *new* ledger entries on top of the 16
original entries the backup also restores verbatim:

| State | `clinic_ledger_entries` rows | Sum(debit) | Sum(credit) |
|---|---|---|---|
| Production (live, read-only) | 16 | 206,400.00 | 206,400.00 |
| Restored, defect present | 72 | 616,640.00 | 616,640.00 |
| Restored, fix applied | 16 | 206,400.00 | 206,400.00 |

The pre-existing "debits equal credits" check passed in **both** the
correct and the corrupted state, because each duplicated posting is
itself a balanced debit/credit pair — a real blind spot in that check
alone, not a false alarm. Fixed as described in step 3b above, and
independently re-verified with three further full real restores (two
unencrypted-path, one encrypted-path, plus a separate recovery-key
verification) — all four showing exact ledger fidelity.

**Status: VERIFIED, real production data, four real end-to-end restores
into the disposable project (2026-08-22)** — most recently 34/34
automated checks passed each time: all 59 tables, 64 functions, 171 RLS
policies, 268 constraints, 186 indexes, and 146 foreign keys matched
production exactly; a live post-restore `SELECT COUNT(*)` reconciliation
(not the restore script's own tally of rows it inserted — see below)
confirmed every table's row count matches the backup exactly; financial
integrity (below) confirmed exactly; multi-branch integrity checks all
passed.

**Post-restore reconciliation, live, not self-reported**: row-count
verification runs a `SELECT COUNT(*)` per table against the restored
database after the full data-load phase completes, and compares it to
the backup's recorded count. This replaced an earlier version of the
check that only compared the number of rows the script itself issued
`INSERT` statements for — which is exactly the mechanism that let the
ledger-duplication defect above pass unnoticed the first time, since a
trigger-generated row is not something the script itself inserted.

**Financial reconciliation, specifically** (run as part of §9):
- `clinic_ledger_entries` row count must match the backup's recorded
  count exactly.
- Total debits and total credits within the restored ledger must be
  equal to each other (**internal consistency** — necessary but, as
  shown above, not sufficient on its own).
- Total debits and total credits must **also** match the backup's own
  *true* totals — computed from the backup's already-downloaded row
  data via a Postgres-side `unnest(...)::numeric[]` sum (avoiding
  JS floating-point risk on currency values, and never re-reading the
  backup file itself).
- Every `clinic_ledger_entries.transaction_id` must resolve to a real
  `clinic_ledger_transactions` row — zero orphaned ledger entries.

One structural detail surfaced by the first real run and handled
explicitly rather than silently: three tables (`orders`, `profiles`,
`purchases`) have a foreign key to `auth.users(id)`. Since `auth.users`
is deliberately excluded from this backup (see §1), those three
specific constraints are dropped immediately before the data-restore
step (after first confirming, in the structural verification, that they
*were* correctly created by the schema DDL — proving schema fidelity
before removing them for data-loading purposes only). This is an
inherent, correct consequence of scoping the backup to `public` only,
not a defect.

## 8. Storage restore procedure

1. Run `npm run backup:storage-restore-test`
   (`scripts/backup/restore-storage-test.mjs`).
2. It reads the most recent Storage manifest from R2, creates a
   brand-new, empty, **private** bucket **inside the disposable
   restore-test Supabase project** (named `dr-restore-test-<timestamp>`,
   using `RESTORE_TEST_SUPABASE_URL` +
   `RESTORE_TEST_SUPABASE_SERVICE_ROLE_KEY` — never production's
   credentials), and restores every backed-up object into it **from the
   R2 copy** (not re-copied from the live source — this also proves the
   R2 copy itself is intact, and decrypts automatically first if the
   object was encrypted).
3. For each object: verifies the checksum recorded at backup time
   (against the *decrypted plaintext* — see §4's checksum-convention
   note), re-downloads after restore and verifies the checksum again,
   and confirms the size matches.
4. Verifies the bucket itself is private and that an **unauthenticated**
   request to the object's public URL does not serve content.
5. Deletes every restored object and the temporary bucket, regardless
   of pass/fail, leaving zero residue in the restore-test project.

**Isolation, now genuinely a separate project**: an earlier version of
this script had no Storage API credentials for the disposable project —
only its Postgres connection string was available — so it created its
temporary test bucket *inside the production project* instead. That was
a real, documented scope limitation, and it directly conflicted with
"never modify production Storage" once that became an explicit
requirement. Fixed by adding `RESTORE_TEST_SUPABASE_SERVICE_ROLE_KEY`
and repointing the script at the disposable project's own Storage API.
**Production Storage is not read from or written to by this script at
all**, in the current version.

**Status: VERIFIED, real production Storage data, three real
end-to-end restores (2026-08-22)** — most recently 8/8 real objects
(61.7 MB, all from the `patient-files` bucket) restored into the
disposable project, every checksum and size verified before and after,
bucket confirmed private, an unauthenticated request to a restored
object's public URL correctly returned HTTP 400, and the temporary
bucket and all its objects were fully deleted afterward.

## 9. Post-restore verification (what "restored successfully" means here)

Run automatically by `restore-database-test.mjs`:

- **Schema fidelity**: re-introspects the restored database and diffs
  its table list, function/RPC list, RLS policy list, RLS-enabled table
  list, constraint list, index list, and foreign key list against the
  snapshot taken at backup time. Any missing or unexpected item fails
  the check by name, not just a boolean.
- **Data fidelity**: a live post-restore `SELECT COUNT(*)` per table,
  compared exactly against the backup's recorded counts (§7 explains
  why this replaced an earlier, weaker self-reported version).
- **Named critical tables present**: `organizations`,
  `organization_users`, `clinics`, `clinic_users`, `patients`,
  `appointments`, `dentists`, `clinic_invoices`, `clinic_ledger_entries`,
  `clinic_ledger_transactions`, `clinic_expenses`, `staff_invitations`.
- **AI receptionist tables correctly absent** (`ai_conversations`,
  `ai_receptionists` were intentionally dropped by migration `0069` —
  their absence after restore is the correct, expected result, not a
  gap).
- **Multi-branch relationships**: organization/branch/clinic-user row
  counts match the backup exactly; a referential check confirms no
  `clinics` row references a nonexistent `organizations` row.
- **Financial integrity**: see the dedicated subsection in §7 — ledger
  row count, internal debit=credit consistency, debit/credit vs. the
  backup's true totals, and the ledger→transaction orphan check.

Run automatically by `restore-storage-test.mjs`: per-object checksum
before and after restore, bucket privacy, and unauthenticated-access
denial (see §8).

**Behavioral RLS and multi-branch verification (VERIFIED, 2026-08-22,
ad hoc against the restored database, run three times)**: beyond
confirming RLS policies exist and match production exactly (structural,
above), a real access-control test suite is run: connected as the
`authenticated` Postgres role with a spoofed `request.jwt.claims` GUC
for real restored identities, inside a transaction rolled back after
each check (no live API/JWT involved — this simulates what PostgREST
does at the database level). Nine scenarios, all passing on the most
recent two runs:

1. Clinic staff see only their own clinic's patients.
2. Clinic staff see only their own clinic's invoices.
3. Clinic staff see only their own clinic's pending invitations.
4. A non-owner, single-branch staff member sees only their own staff
   record, not colleagues.
5. That same non-owner sees zero staff from a different branch of the
   same organization.
6. That same non-owner sees zero patients from a different branch of
   the same organization.
7. An organization's CEO sees both of that organization's branches.
8. The CEO's org-wide invoice total is the correct sum across both
   branches.
9. The CEO cannot see an unrelated, independent (non-org) clinic's
   patients.

The first real run of this suite (2026-08-22) initially showed 7/9,
with 2 apparent failures that looked like an RLS leak — a branch
owner appeared to see the *other* branch's entire staff roster.
Investigated rather than assumed broken: the real production data has
the *same person* recorded as Owner of both of that organization's
branches (a genuine small multi-branch operator running both locations
themselves), so the access-control function correctly grants them
visibility into both — the test's assumption (two different people, one
per branch) was wrong, not the policy. Re-run with a genuinely isolated,
single-branch, non-owner identity confirmed true isolation, and all
subsequent runs used that corrected design from the start.

## 10. RPO / RTO

RPO and RTO measure different things and should not be conflated:
**RPO** (Recovery Point Objective) is how much data could be lost —
governed by backup *frequency*. **RTO** (Recovery Time Objective) is
how long recovery *takes* — governed by restore speed plus everything
around it (detection, provisioning, verification, cutover).

- **RPO target**: ≤ 24 hours (one daily backup cycle).
- **RPO achieved**: not yet measurable as an ongoing guarantee. The
  daily schedule (§2) is correctly configured and has been observed to
  produce at least one real successful backup, but this environment has
  not independently observed a second, purely schedule-triggered run —
  so today's actual RPO is "however long ago the most recent backup
  was," not yet a demonstrated, maintained ≤24h rolling window. That
  becomes verifiable once several consecutive scheduled runs have
  actually landed and been observed.
- **RTO target**: ≤ 4 hours, covering: identify the incident, provision
  or reuse a target database, run the restore script, run verification,
  redeploy the application pointed at the restored database.
- **RTO measured — real, both encrypted and unencrypted, four real
  drills (2026-08-22)**. This is the scripted restore-and-verify portion
  only; it does **not** include incident detection/triage time or
  application cutover/redeploy time, and it does not include a real
  application-level smoke test (see the gap noted at the end of this
  section):

  | Drill | DB restore (wall) | Storage restore (wall) | Combined |
  |---|---|---|---|
  | 1 — unencrypted, defect present | 93.1 s | 165.4 s | ~258.5 s (4.3 min) |
  | 2 — unencrypted, fix verified | 127.9 s | 150.3 s | ~278.2 s (4.6 min) |
  | 3 — encrypted | 234.0 s | 170.8 s | ~404.8 s (6.75 min) |
  | 4 — recovery-key verification (encrypted, DB only) | 116.6 s | not run | 116.6 s |

  All four are **well inside** the 4-hour target, with real variance
  between runs (roughly 4.3 to 6.75 minutes for a full DB+Storage
  restore) reflecting network conditions on the day, not a fixed
  constant — AES-256-GCM encryption/decryption of payloads this size is
  itself sub-second, so the encrypted drill's longer time is not
  attributed to the cryptography.
- **What this measurement does NOT cover, and therefore does not
  prove about real-incident RTO**: incident detection/triage time,
  provisioning a *new* target project during a real incident (the
  disposable project used above already exists and is reused, not
  created fresh each time), and — most importantly — **a real
  application-level smoke test against a restored environment has never
  been performed**. This is not a missing credential; it is a
  structural consequence of §1's design: `auth.users` is deliberately
  excluded from every backup (it holds real password hashes), so no
  restored `clinic_users`/`organization_users` row has a corresponding
  real login in the disposable project, and there is currently no way
  to sign in as a restored user through the normal application UI.
  Closing this gap would require a deliberate, separate
  auth-provisioning step for the restore-test project — a real design
  decision for a future pass, not something to improvise.

## 11. Failure handling

Verified with `scripts/backup/failure-tests.mjs` (5/5 passed, against
real R2, using deliberately wrong or absent test-only credentials —
never the real ones):

- Invalid R2 credentials → upload rejected, error surfaced, nothing
  marked as a successful backup.
- Upload to a nonexistent/wrong-scope bucket → rejected the same way.
- An object that never finished uploading is correctly detected as
  absent (the same `HEAD`-based check both backup scripts use before
  declaring success).
- A corrupted archive (one flipped byte) is correctly detected by
  SHA-256 checksum comparison — the exact mechanism
  `restore-database-test.mjs` runs before touching the restore target.

**Additional failure scenario verified since encryption was configured
(2026-08-22)**: decrypting a real encrypted backup with an
intentionally incorrect key fails cleanly via AES-GCM authentication-tag
rejection — see §4's key-loss safety note for detail. No usable or
silently-corrupted output is ever produced from a wrong key.

Every failure path exits non-zero, prints a clear error, and never logs
a credential or patient data value, real or synthetic.

## 12. Emergency recovery procedure (runbook)

1. Confirm the incident: what was lost/corrupted, and the last known
   good time.
2. Do **not** attempt to fix forward against production data if there
   is any doubt about integrity — stop writes if possible.
3. Identify the most recent backup: list `db/*.meta.json` in the R2
   bucket, pick the newest (or the one before the incident, if the
   incident itself is time-bound, e.g. a bad migration). Metadata is
   always readable without the encryption key (§4), so this step works
   regardless of whether the backup itself is encrypted.
4. Provision or reuse an isolated Supabase project — **never** restore
   directly over the live project. This requires that project's Postgres
   connection string, its public Supabase URL, and (if a Storage restore
   is also needed) its Storage service-role key — see §6.
5. Run `npm run backup:restore-test` against that project's credentials
   (temporarily set as `RESTORE_TEST_DB_URL` /
   `RESTORE_TEST_SUPABASE_URL`). If the selected backup is encrypted,
   `BACKUP_ENCRYPTION_KEY` must be available in the environment running
   the restore — retrieve it from the independent secure recovery copy
   (§4) if the operational copies are unavailable. Decryption and
   trigger-safe data loading (§7) both happen automatically; no manual
   step is required for either.
6. Run the full verification suite (§9) and read the PASS/FAIL report
   in full — do not proceed past any FAIL without understanding it,
   especially the financial-integrity checks (§7).
7. Restore Storage the same way (`npm run backup:storage-restore-test`,
   against that same project's `RESTORE_TEST_SUPABASE_SERVICE_ROLE_KEY`
   — see §8).
8. Run this repo's own test suite (`npx tsc --noEmit`, `npm test --
   --run`, `npm run build`) against the restored project's credentials
   as an additional smoke test before cutting over.
9. Clean up the disposable/recovery project's restored data once
   verification is recorded and before it is reused for another drill
   (§7 step 5) — unless this *is* the real recovery target, in which
   case skip cleanup and proceed to cutover instead.
10. Only after every check in §9 passes and the smoke tests in step 8
    pass: update the application's environment variables to point at the
    restored project, redeploy.
11. Declare recovery complete only after a real user-facing smoke test
    against the newly-live environment (login, view a patient, view the
    ledger) — not before. As noted in §10, this specific step has never
    been exercised in this environment, because the current backup
    design has no restorable login for any user by default; provisioning
    one for a real incident is a decision to make at that time, not a
    pre-built shortcut.

## 13. What is proven vs. what is designed

This document intentionally distinguishes the two everywhere above.
As of 2026-08-22: automated daily backups, client-side encryption,
database restore (including the trigger-handling and financial-fidelity
fixes described in §7), and Storage restore into a genuinely isolated
project are all **VERIFIED** with real production data. RPO as an
ongoing rolling guarantee, and a real application-level smoke test
against a restored environment, remain **TARGET** — not yet
demonstrated, for the specific reasons given in §10.
