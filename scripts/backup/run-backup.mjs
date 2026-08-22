// Phase 9 - Automation entrypoint.
//
// Runs the preflight check, then database backup, then storage backup,
// each as an isolated subprocess so one step's crash can't corrupt
// another's state. Exits non-zero if ANY step fails - this is the
// single command a scheduler (cron, GitHub Actions) should invoke.
// Retention is NOT run automatically here: it stays a separate, opt-in
// step (see apply-retention.mjs) until upload verification and a real
// restore have both been proven, per project policy.
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function run(script) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(__dirname, script)], { stdio: "inherit" });
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${script} exited with code ${code}`))));
    child.on("error", reject);
  });
}

async function main() {
  const startedAt = Date.now();
  console.log(`=== DentalFlow backup run starting: ${new Date().toISOString()} ===\n`);

  console.log("--- Step 1/3: preflight checks ---");
  await run("check-config.mjs");

  console.log("\n--- Step 2/3: database backup ---");
  await run("backup-database.mjs");

  console.log("\n--- Step 3/3: storage backup ---");
  await run("backup-storage.mjs");

  console.log(`\n=== Backup run completed successfully in ${Date.now() - startedAt}ms ===`);
}

main().catch((e) => {
  console.error(`\n=== Backup run FAILED: ${e.message} ===`);
  process.exit(1);
});
