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
mostly-compressed binary formats), checksum (SHA-256), upload to the
private R2 bucket, and verify the upload with an independent `HEAD`
request comparing size before declaring success. Both exit non-zero on
any failure and never log credentials or row/file content — only
counts, sizes, and checksums.

**Measured, real (2026-08-21)**: production database is 46 MB
(`pg_database_size`), 59 tables, 75,492 rows (74,719 of which are the
imported ICD-10-CM `clinical_codes` reference set — real
clinic/patient/financial data is closer to 800 rows across the
remaining tables). The full backup compresses to 2.48 MB (91% smaller
than the 24.95 MB uncompressed JSON representation).

## 2. Backup frequency

**TARGET**: daily. **IMPLEMENTED, NOT YET RUN**: a GitHub Actions
workflow (`.github/workflows/backup-database.yml`) exists with a daily
cron trigger, but it is currently **commented out** and the workflow
file has not been pushed to the repository — per this engagement's
constraints (no push/deploy without explicit instruction). Until it is
pushed, its schedule enabled, and at least one scheduled run observed
to succeed, "daily automated backups" is a capability that has been
built, not a fact about what is currently happening. See §8.

## 3. Backup destination

Cloudflare R2, bucket `dentalflow-backups`, private (no public access),
S3-compatible API. Chosen over AWS S3 for a simpler setup (no IAM
policy authoring, no egress fees, free tier covers this project's data
volume many times over) — this is Storage-only usage of Cloudflare, not
a migration of any application infrastructure.

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
- **Client-side (optional, additional layer)**: AES-256-GCM
  (`scripts/backup/lib/crypto.mjs`, Node's built-in `crypto` module — no
  custom cryptography), gated on a `BACKUP_ENCRYPTION_KEY` environment
  variable (32 bytes, base64-encoded). **Current status: NOT
  configured** — `BACKUP_ENCRYPTION_KEY` was not provided during this
  implementation, so backups taken so far rely on R2's native at-rest
  encryption + private bucket + scoped API credentials only, not an
  additional application-level layer.
- **Key storage, if/when configured**: must live only as a secret in
  whatever runs the backup (local `.env.local`, gitignored — see
  `.gitignore:44`; and/or GitHub Actions repository secrets if the
  workflow is activated). Never in source, never in the backup archive
  itself, never logged.
- **What happens if the key is lost**: **a backup encrypted with a lost
  key is not recoverable.** There is no key-recovery mechanism, by
  design (a recoverable key defeats the point of encryption). If
  `BACKUP_ENCRYPTION_KEY` is ever set, it must be stored redundantly in
  a password manager or secrets vault accessible to more than one
  person — losing it is equivalent to losing every backup encrypted
  with it, even though the (still-private, still access-controlled) R2
  copies would still physically exist.

## 5. Retention

**TARGET policy** (`scripts/backup/apply-retention.mjs`): keep every
daily backup for 30 days, then one per week for the next 12 weeks, then
one per month for the next 12 months; everything else eligible for
deletion.

**VERIFIED**: the classification logic itself, against synthetic
timestamped data (not real backups) — 71 synthetic entries in, 47 kept
/ 24 correctly marked for removal, partition correctness confirmed
(every input in exactly one of keep/remove, nothing invented).

**Current real state (2026-08-21)**: 3 database backups exist in R2
(from this implementation's testing), all within the 30-day daily
window — dry-run correctly reports 0 eligible for removal.

**Deliberately not yet enabled for real deletion**: the script defaults
to `--dry-run` (prints what would be deleted, deletes nothing) and
requires an explicit `--execute` flag. Per this project's policy,
retention must not delete anything until upload verification and a
real restore have both been proven — auto-deleting backups before
proving a restore works would risk deleting the only good copy. Once
enough real backup history has accumulated to make retention
meaningful, prefer moving this to R2's own lifecycle rules (provider-
side, cannot be defeated by an application bug) over continuing to run
it as application logic.

## 6. Required credentials / secrets

| Variable | Purpose | Where it should live |
|---|---|---|
| `SUPABASE_DB_URL` | Direct Postgres connection to production, used only for reading during backup | `.env.local` (gitignored) locally; GitHub Actions secret if automation is activated |
| `RESTORE_TEST_DB_URL` | Connection to a disposable, isolated Supabase project used **only** for restore testing | `.env.local` (gitignored), never committed |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME` | R2 destination + scoped credentials (should be an Object Read & Write token scoped to the single `dentalflow-backups` bucket only, not full-account access) | `.env.local` (gitignored); GitHub Actions secret if automation is activated |
| `BACKUP_ENCRYPTION_KEY` (optional) | Client-side AES-256-GCM key | Same as above, if/when configured |
| `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Already-existing app credentials, reused for the Storage backup/restore pipelines | Already present in `.env.local` |

None of these are printed, logged, or committed anywhere by any script
in `scripts/backup/`. `check-config.mjs` verifies presence and shape
(hostnames, bucket name) without ever printing a secret value.

## 7. Database restore procedure

1. Run `npm run backup:restore-test` (`scripts/backup/restore-database-test.mjs`).
2. The script **refuses to run** unless `RESTORE_TEST_DB_URL` resolves
   to a different host than `SUPABASE_DB_URL` (`assertDistinctProjects`
   in `lib/env.mjs`) — it will not restore into production under any
   circumstance, by construction, not just by convention.
3. It downloads the most recent backup from R2, verifies its checksum,
   decompresses (and decrypts, if `BACKUP_ENCRYPTION_KEY` is set), then:
   a. Applies the generated schema DDL to the restore-target database.
   b. Inserts every row of every table, in FK-safe order.
4. It then runs verification (see §9) and prints a PASS/FAIL report.
5. The restored database is left in place in the disposable project
   afterward for manual inspection if needed — it is never connected to
   production users, the app is never pointed at it, and no emails are
   sent from it (the script only issues raw SQL; no application/email
   code path runs).

**Status: VERIFIED** (2026-08-21, real production data, real restore
into the disposable project) — 32/32 automated checks passed: all 59
tables, 64 functions, 171 RLS policies, 268 constraints, 186 indexes,
and 146 foreign keys matched production exactly; all 75,492 rows
restored with exact per-table row-count matches; multi-branch and
financial integrity checks (§9) all passed. Full detail in the
accompanying final report.

One structural detail surfaced by this real run and handled explicitly
rather than silently: three tables (`orders`, `profiles`, `purchases`)
have a foreign key to `auth.users(id)`. Since `auth.users` is
deliberately excluded from this backup (see §1), those three specific
constraints are dropped immediately before the data-restore step (after
first confirming, in the structural verification, that they *were*
correctly created by the schema DDL — proving schema fidelity before
removing them for data-loading purposes only). This is an inherent,
correct consequence of scoping the backup to `public` only, not a
defect.

## 8. Storage restore procedure

1. Run `npm run backup:storage-restore-test`
   (`scripts/backup/restore-storage-test.mjs`).
2. It reads the most recent Storage manifest from R2, creates a
   brand-new, empty, **private** bucket in the same Supabase project
   (named `dr-restore-test-<timestamp>`), and restores every backed-up
   object into it **from the R2 copy** (not re-copied from the live
   source — this also proves the R2 copy itself is intact).
3. For each object: verifies the checksum recorded at backup time,
   re-downloads after restore and verifies the checksum again, and
   confirms the size matches.
4. Verifies the bucket itself is private and that an **unauthenticated**
   request to the object's public URL does not serve content.
5. Deletes every restored object and the temporary bucket, regardless
   of pass/fail, leaving zero residue in production.

**Important scope note**: a separate disposable Supabase project's
*Storage* API credentials (project URL + key) were not made available —
only a second project's *Postgres* connection string was, for the
database restore test (§7). Supabase Storage has no "restore into a raw
Postgres connection" path; it requires the Storage REST API of a
specific project. So this restores into an isolated bucket in the
*same* production project rather than a fully separate project. This is
a real, verified, non-simulated restore-and-integrity-check — but it is
not the same isolation boundary as §7's database restore. If full
second-project isolation for Storage is required, provide that
project's Storage URL + service-role key and this script can be
re-pointed at it.

**Status: VERIFIED** — see §13.J.

## 9. Post-restore verification (what "restored successfully" means here)

Run automatically by `restore-database-test.mjs`:

- **Schema fidelity**: re-introspects the restored database and diffs
  its table list, function/RPC list, RLS policy list, RLS-enabled table
  list, constraint list, index list, and foreign key list against the
  snapshot taken at backup time. Any missing or unexpected item fails
  the check by name, not just a boolean.
- **Data fidelity**: per-table row counts compared exactly against the
  backup's recorded counts.
- **Named critical tables present**: `organizations`,
  `organization_users`, `clinics`, `clinic_users`, `patients`,
  `appointments`, `dentists`, `clinic_invoices`, `clinic_ledger_entries`,
  `clinic_ledger_transactions`, `clinic_expenses`, `staff_invitations`,
  `organization_invitations`.
- **AI receptionist tables correctly absent** (`ai_conversations`,
  `ai_receptionists` were intentionally dropped by migration `0069` —
  their absence after restore is the correct, expected result, not a
  gap).
- **Multi-branch relationships (Phase 4)**: organization/branch/
  clinic-user row counts match the backup exactly; a referential check
  confirms no `clinics` row references a nonexistent `organizations`
  row.
- **Financial integrity (Phase 5)**: total debits equal total credits
  in the restored `clinic_ledger_entries`, plus row-count checks on
  `clinic_invoices` and `clinic_expenses`. No financial data is
  modified by any part of this pipeline — only read (at backup time)
  and inserted as-is (at restore time).

Run automatically by `restore-storage-test.mjs`: per-object checksum
before and after restore, bucket privacy, and unauthenticated-access
denial (see §8).

**Behavioral RLS check (VERIFIED, 2026-08-21, ad hoc against the
restored database)**: beyond confirming RLS policies exist and match
production exactly (structural, above), a real access-control test was
run: connected as the `authenticated` Postgres role with a spoofed
`request.jwt.claims` GUC for one real restored clinic user (no live
API/JWT involved — this simulates what PostgREST does at the database
level). As an unrestricted connection, 165 patients existed across all
clinics (1 in that user's own clinic, 164 in others). Under RLS as that
user, exactly 1 patient was visible — the user's own clinic only, zero
leakage of the other 164. Confirms RLS isolation survives the restore
process itself, not merely that policy objects were recreated.

## 10. RPO / RTO

- **RPO target**: ≤ 24 hours (one daily backup cycle), once automation
  (§2) is actually scheduled and running.
- **RTO target**: ≤ 4 hours, covering: identify the incident, provision
  or reuse a target database, run the restore script, run verification,
  redeploy the application pointed at the restored database.
- **RPO achieved**: not yet measurable as an ongoing guarantee —
  automation (§2) is implemented but not scheduled/active, so there is
  currently no recurring backup cadence to derive a real RPO from. A
  single successful backup was taken on 2026-08-21
  (`db/2026-08-21T23-57-56-785Z`), so today's actual RPO is "however
  long ago that one backup was," not a maintained ≤24h window.
- **RTO measured (VERIFIED, real run, 2026-08-21)**: database backup
  generation 68.6s + upload/verify (included in that figure) → schema
  DDL restore 2.0s + data restore (75,492 rows) 66.9s → full
  restore-and-verify script wall time 80.5s. **Total backup-to-verified-
  restore time: under 3 minutes**, well inside the 4-hour target — but
  this measures the scripted database portion only. It does not include
  incident detection/triage time, Storage restore time (also measured,
  see §13.J of the final report), or redeploying/cutting the
  application over, all of which are part of a real incident's RTO and
  were not exercised as a full end-to-end drill in this session.

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

Every failure path exits non-zero, prints a clear error, and never logs
a credential or patient data value, real or synthetic.

## 12. Emergency recovery procedure (runbook)

1. Confirm the incident: what was lost/corrupted, and the last known
   good time.
2. Do **not** attempt to fix forward against production data if there
   is any doubt about integrity — stop writes if possible.
3. Identify the most recent backup: list `db/*.meta.json` in the R2
   bucket, pick the newest (or the one before the incident, if the
   incident itself is time-bound, e.g. a bad migration).
4. Provision or reuse an isolated Supabase project — **never** restore
   directly over the live project.
5. Run `npm run backup:restore-test` against that project's connection
   string (temporarily set as `RESTORE_TEST_DB_URL`).
6. Run the full verification suite (§9) and read the PASS/FAIL report
   in full — do not proceed past any FAIL without understanding it.
7. Restore Storage the same way (`npm run backup:storage-restore-test`,
   adapted to the recovery target — see the scope note in §8).
8. Run this repo's own test suite (`npx tsc --noEmit`, `npm test --
   --run`, `npm run build`) against the restored project's credentials
   as an additional smoke test before cutting over.
9. Only after every check in §9 passes and the smoke tests in step 8
   pass: update the application's environment variables to point at the
   restored project, redeploy.
10. Declare recovery complete only after a real user-facing smoke test
    against the newly-live environment (login, view a patient, view the
    ledger) — not before.

## 13. What is proven vs. what is designed

This document intentionally distinguishes the two everywhere above.
See the accompanying final report for the current, dated PASS/FAIL
status of every phase and the exact remaining manual steps.
