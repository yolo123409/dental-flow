// FIN-4.6 — "which database am I actually about to run SQL against?"
//
// WHY THIS EXISTS: every migration in this repo's history (0001-0101)
// was applied to production by hand, over a raw connection, with no
// tooling step that made a human confirm which project that connection
// string actually pointed at before running anything - the exact kind
// of accidental-mistargeting risk FIN-4.6 was asked to close. This
// script is that confirmation step: point it at any of this repo's
// known DB env vars and it tells you, from a live query (not from the
// variable's name, which could be stale or wrong), which real project
// you're holding.
//
// Usage: node scripts/db/whoami.mjs SUPABASE_DB_URL
//        node scripts/db/whoami.mjs RESTORE_TEST_DB_URL
//
// Prints the project ref (from the matching *_SUPABASE_URL, if set) and
// a truncated Postgres cluster fingerprint (system_identifier - see
// scripts/backup/lib/env.mjs for why this, not the pooler hostname, is
// the only reliable live signal). Never prints a password or connection
// string. Exits non-zero if the variable is unset or unreachable.
import { fetchClusterIdentity, projectRefFromSupabaseUrl, safeHost } from "../backup/lib/env.mjs";

const varName = process.argv[2];
if (!varName) {
  console.error("Usage: node scripts/db/whoami.mjs <ENV_VAR_NAME>   (e.g. SUPABASE_DB_URL or RESTORE_TEST_DB_URL)");
  process.exit(1);
}

const url = process.env[varName];
if (!url) {
  console.error(`FATAL: ${varName} is not set (checked process.env and .env.local).`);
  process.exit(1);
}

const knownProjects = [
  { label: "PRODUCTION", supabaseUrlVar: "NEXT_PUBLIC_SUPABASE_URL" },
  { label: "RESTORE-TEST / STAGING", supabaseUrlVar: "RESTORE_TEST_SUPABASE_URL" },
];

async function main() {
  console.log(`Connecting to ${varName} (${safeHost(url)}) ...`);
  const identity = await fetchClusterIdentity(url);
  console.log(`Live cluster identity (system_identifier): ...${identity.slice(-8)}`);

  const matches = [];
  for (const proj of knownProjects) {
    const projUrl = process.env[proj.supabaseUrlVar];
    if (!projUrl) continue;
    const ref = projectRefFromSupabaseUrl(projUrl);
    try {
      const projIdentity = await fetchClusterIdentity(
        proj.supabaseUrlVar === "NEXT_PUBLIC_SUPABASE_URL" ? process.env.SUPABASE_DB_URL : process.env.RESTORE_TEST_DB_URL
      );
      if (projIdentity === identity) {
        matches.push({ label: proj.label, ref });
      }
    } catch {
      // that known project's own DB URL isn't reachable/set - skip, not fatal to this check
    }
  }

  console.log("");
  if (matches.length === 1) {
    console.log(`>>> ${varName} points at: ${matches[0].label} (project ref: ${matches[0].ref}) <<<`);
    if (matches[0].label === "PRODUCTION") {
      console.log(">>> This is REAL production data. Confirm that is actually intended before running anything against it. <<<");
    }
  } else if (matches.length > 1) {
    console.log(`WARNING: ${varName} matched more than one known project (${matches.map((m) => m.label).join(", ")}) - this should never happen and means two "different" projects share a cluster identity. Investigate before proceeding.`);
    process.exitCode = 1;
  } else {
    console.log(`${varName} does not match any known project (PRODUCTION or RESTORE-TEST). Unknown target - do not assume it is safe.`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error("FATAL:", e.message);
  process.exit(1);
});
