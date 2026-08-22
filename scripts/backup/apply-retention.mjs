// Phase 10 - Retention policy.
//
// Policy (starting point, per spec): keep every daily backup for 30
// days, then one backup per week for the next 12 weeks, then one
// backup per month for the next 12 months. Everything older than that
// (and not selected as a weekly/monthly representative) is eligible for
// deletion.
//
// Defaults to --dry-run (prints what WOULD be deleted, deletes
// nothing). Only deletes when called with --execute. This is
// deliberate: retention must not delete anything until upload
// verification and a real restore have both been proven to work first
// (see docs/DISASTER_RECOVERY.md) - this script existing and being
// correct is not the same as retention being "active".
import { r2List, r2Delete } from "./lib/r2.mjs";

const DAY_MS = 24 * 60 * 60 * 1000;
const DAILY_RETENTION_DAYS = 30;
const WEEKLY_RETENTION_WEEKS = 12;
const MONTHLY_RETENTION_MONTHS = 12;

/**
 * Given a list of { key, timestamp: Date } backups (newest first),
 * returns { keep: [...], remove: [...] } per the daily/weekly/monthly
 * policy above. Pure function - no I/O - so it can be unit-tested
 * against synthetic data independent of any real backup.
 */
export function classifyRetention(backups, now = new Date()) {
  const sorted = [...backups].sort((a, b) => b.timestamp - a.timestamp);
  const keep = new Set();
  const dailyCutoff = new Date(now - DAILY_RETENTION_DAYS * DAY_MS);
  const weeklyCutoff = new Date(dailyCutoff - WEEKLY_RETENTION_WEEKS * 7 * DAY_MS);
  const monthlyCutoff = new Date(weeklyCutoff);
  monthlyCutoff.setMonth(monthlyCutoff.getMonth() - MONTHLY_RETENTION_MONTHS);

  for (const b of sorted) {
    if (b.timestamp >= dailyCutoff) keep.add(b.key);
  }

  const seenWeeks = new Set();
  for (const b of sorted) {
    if (b.timestamp >= dailyCutoff || b.timestamp < weeklyCutoff) continue;
    const weekKey = `${b.timestamp.getUTCFullYear()}-W${Math.floor(
      (b.timestamp - new Date(Date.UTC(b.timestamp.getUTCFullYear(), 0, 1))) / (7 * DAY_MS)
    )}`;
    if (!seenWeeks.has(weekKey)) {
      seenWeeks.add(weekKey);
      keep.add(b.key);
    }
  }

  const seenMonths = new Set();
  for (const b of sorted) {
    if (b.timestamp >= weeklyCutoff || b.timestamp < monthlyCutoff) continue;
    const monthKey = `${b.timestamp.getUTCFullYear()}-${b.timestamp.getUTCMonth()}`;
    if (!seenMonths.has(monthKey)) {
      seenMonths.add(monthKey);
      keep.add(b.key);
    }
  }

  const remove = sorted.filter((b) => !keep.has(b.key)).map((b) => b.key);
  return { keep: [...keep], remove };
}

async function listRealBackups(prefix) {
  const metas = (await r2List(prefix)).filter((o) => o.Key.endsWith(".meta.json"));
  return metas.map((o) => ({ key: o.Key, timestamp: o.LastModified }));
}

async function main() {
  const execute = process.argv.includes("--execute");
  console.log(`Retention run - mode: ${execute ? "EXECUTE (will delete)" : "DRY RUN (will only report)"}`);

  const dbBackups = await listRealBackups("db/");
  const { keep, remove } = classifyRetention(dbBackups);

  console.log(`\nDatabase backups: ${dbBackups.length} total, ${keep.length} to keep, ${remove.length} eligible for removal.`);
  for (const key of remove) console.log(`  would remove: ${key}`);

  if (execute && remove.length > 0) {
    for (const key of remove) {
      const dataKey = key.replace(/\.meta\.json$/, "");
      // The exact data-file extension (.json.gz or .json.gz.enc) isn't
      // recoverable from the meta key alone; delete both possibilities,
      // ignoring the one that doesn't exist.
      for (const candidate of [`${dataKey}.json.gz`, `${dataKey}.json.gz.enc`]) {
        try {
          await r2Delete(candidate);
        } catch {
          // best-effort; the meta key deletion below is the source of truth
        }
      }
      await r2Delete(key);
      console.log(`  deleted: ${key}`);
    }
  } else if (remove.length > 0) {
    console.log("\nDry run: nothing was deleted. Re-run with --execute to apply.");
  }
}

const isMain = process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("apply-retention.mjs");
if (isMain) {
  main().catch((e) => {
    console.error("FATAL:", e.message);
    process.exit(1);
  });
}
