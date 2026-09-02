// Critical Safety Closure (Audit II, Critical #3) — genuine concurrent-
// connection proof that suspending a staff member revokes their access
// immediately, on their SAME still-open session, with no re-login
// involved. This is the one fix in this pass that a single shared
// transaction (db-integration-tests.mjs, which already spot-checks the
// Tier 1/Tier 2 functions via actAs()) cannot actually prove: everything
// there runs inside one transaction on one connection, so it can show
// the functions return the right thing when called AS a suspended user,
// but not that an ALREADY-CONNECTED, ALREADY-AUTHENTICATED session loses
// access mid-session, without disconnecting or re-authenticating.
//
// Uses a real pg.Pool (independent connections) - same methodology as
// billing-audit-concurrency-test.mjs. Two connections are opened and
// held open throughout: one acting as a real Owner (who suspends and
// later reactivates), one acting as the person being suspended - that
// second connection is opened BEFORE the suspend happens and is NEVER
// closed or reconnected for the entire test, exactly simulating a
// browser tab that was already open when an admin suspends the account.
//
// SAFETY: staging only, gated by the same assertDistinctProjects check
// every other write-capable script in this repo uses. WRITES AND KEEPS
// its data - run `npm run staging:sync-schema` afterward to reset
// staging to empty.
//
// Run `npm run staging:apply-pending-migrations` first if migrations
// 0130/0131 haven't reached staging yet.
import pg from "pg";
import { getProdDbUrl, getRestoreTestDbUrl, getRestoreTestSupabaseUrl, assertDistinctProjects } from "../backup/lib/env.mjs";

const results = [];
function record(name, pass, detail = "") {
  results.push({ name, pass, detail });
  console.log(`[${pass ? "PASS" : "FAIL"}] ${name}${detail ? " - " + detail : ""}`);
}

async function actAsSession(client, authUserId, { rls = false } = {}) {
  if (rls) {
    await client.query(
      `select set_config('request.jwt.claims', json_build_object('sub', $1::text, 'role', 'authenticated')::text, false)`,
      [authUserId]
    );
    await client.query(`SET ROLE authenticated`);
  } else {
    await client.query(`select set_config('request.jwt.claims', json_build_object('sub', $1::text)::text, false)`, [authUserId]);
  }
}

async function main() {
  const prodUrl = getProdDbUrl();
  const restoreUrl = getRestoreTestDbUrl();
  const prodSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const restoreSupabaseUrl = getRestoreTestSupabaseUrl();
  await assertDistinctProjects({ prodDbUrl: prodUrl, prodSupabaseUrl, restoreDbUrl: restoreUrl, restoreSupabaseUrl });
  console.log("Safety check passed: target is a live-verified, different Postgres cluster than production.\n");

  const setupClient = new pg.Client({ connectionString: restoreUrl, connectionTimeoutMillis: 15000, statement_timeout: 60000 });
  await setupClient.connect();
  console.log("Connected to staging (restore-test project) for setup.\n");

  const orgId = (await setupClient.query(`select gen_random_uuid() as id`)).rows[0].id;
  const clinicId = (await setupClient.query(`select gen_random_uuid() as id`)).rows[0].id;
  const ownerUserId = (await setupClient.query(`select gen_random_uuid() as id`)).rows[0].id;
  const suspendMeId = (await setupClient.query(`select gen_random_uuid() as id`)).rows[0].id;

  await setupClient.query(`insert into public.organizations (id, name) values ($1, 'Suspended-User Concurrency Test Org')`, [orgId]);
  await setupClient.query(`insert into public.clinics (id, name, organization_id, currency) values ($1, 'Suspend Test Branch', $2, 'KES')`, [clinicId, orgId]);
  await setupClient.query(`insert into public.clinic_settings (clinic_id, clinic_name, currency) values ($1, 'Suspend Test Branch', 'KES')`, [clinicId]);
  await setupClient.query(
    `insert into public.clinic_users (clinic_id, auth_user_id, full_name, email, role, status) values
     ($1, $2, 'Owner Test', 'owner@suspend-conc.test', 'Owner', 'Active'),
     ($1, $3, 'Suspend Me', 'suspendme@suspend-conc.test', 'Owner', 'Active')`,
    [clinicId, ownerUserId, suspendMeId]
  );

  await actAsSession(setupClient, ownerUserId);
  await setupClient.query(`select ensure_ledger_provisioned_multi(array[$1]::uuid[]);`, [clinicId]);

  const patientRow = await setupClient.query(
    `insert into public.patients (clinic_id, first_name, last_name) values ($1, 'Concurrency', 'TestPatient') returning id`,
    [clinicId]
  );
  const patientId = patientRow.rows[0].id;

  await setupClient.query(`alter table public.treatment_plans disable trigger trg_guard_treatment_plan_role;`);
  await setupClient.query(`alter table public.treatment_plan_items disable trigger trg_guard_treatment_plan_item_role;`);
  await setupClient.query(`alter table public.treatment_teeth disable trigger trg_guard_treatment_teeth_role;`);

  const planRow = await setupClient.query(
    `insert into public.treatment_plans (clinic_id, patient_id, title, status) values ($1, $2, 'Suspend Test Plan', 'Active') returning id`,
    [clinicId, patientId]
  );
  const planId = planRow.rows[0].id;

  const treatment = await setupClient.query(
    `select * from create_treatment_with_teeth($1, 'Voidable Root Canal - Suspend Test', array[46], 12000, 1, null, 'Medium', 'Planned')`,
    [planId]
  );

  await setupClient.query(`alter table public.treatment_plans enable trigger trg_guard_treatment_plan_role;`);
  await setupClient.query(`alter table public.treatment_plan_items enable trigger trg_guard_treatment_plan_item_role;`);
  await setupClient.query(`alter table public.treatment_teeth enable trigger trg_guard_treatment_teeth_role;`);

  const invoice = await setupClient.query(
    `select * from create_invoice_from_charges(
       array[$1]::uuid[], $2, 'SUSPEND-TEST-INV', 12000, 0, 0, 12000,
       null, 'Cash', null, false, 'VAT', 0, false, null
     )`,
    [treatment.rows[0].charge_id, patientId]
  );
  const invoiceId = invoice.rows[0].id;

  await setupClient.end();
  console.log("Setup complete. Opening two independent, long-lived connections for the concurrent phase.\n");

  const pool = new pg.Pool({ connectionString: restoreUrl, max: 4, connectionTimeoutMillis: 20000, statement_timeout: 30000 });

  // Connection A: the real Owner, used to suspend/reactivate suspendMeId.
  const connA = await pool.connect();
  await actAsSession(connA, ownerUserId);

  // Connection B: opened acting as suspendMeId BEFORE any suspension
  // happens - simulating a browser tab that was already logged in. This
  // connection is never closed or re-authenticated for the rest of the
  // test.
  const connB = await pool.connect();
  await actAsSession(connB, suspendMeId);

  console.log("--- Baseline: connection B has normal Owner access before any suspension ---");
  {
    const role = await connB.query(`select _caller_role($1) as role`, [clinicId]);
    record(
      "1. Before suspension, connection B's identity resolves as Owner",
      role.rows[0]?.role === "Owner",
      `role=${role.rows[0]?.role}`
    );
  }

  console.log("--- Connection A suspends connection B's identity ---");
  await connA.query(`update clinic_users set status = 'Suspended' where auth_user_id = $1 and clinic_id = $2`, [suspendMeId, clinicId]);

  console.log("--- Connection B (SAME connection, never reconnected) is now rejected ---");
  {
    const role = await connB.query(`select _caller_role($1) as role`, [clinicId]);
    record(
      "2. Immediately after suspension, the SAME still-open connection B's identity resolves to null - no re-login involved",
      role.rows[0]?.role === null,
      `role=${role.rows[0]?.role}`
    );

    let voidResult = { ok: true, message: null };
    try {
      await connB.query(`select * from void_invoice($1, 'suspended user attempt')`, [invoiceId]);
    } catch (error) {
      voidResult = { ok: false, message: error.message };
    }
    record(
      "3. Connection B can no longer call void_invoice on a real invoice in its own clinic",
      !voidResult.ok,
      voidResult.ok ? "unexpectedly succeeded" : voidResult.message
    );

    const invoiceAfter = await pool.query(`select status from clinic_invoices where id = $1`, [invoiceId]);
    record(
      "4. The invoice was NOT voided by the rejected attempt - no partial/unauthorized effect leaked through",
      invoiceAfter.rows[0]?.status !== "Voided",
      `status=${invoiceAfter.rows[0]?.status}`
    );

    await actAsSession(connB, suspendMeId, { rls: true });
    const patientsUnderRls = await connB.query(`select id from patients where clinic_id = $1`, [clinicId]);
    await connB.query(`RESET ROLE`);
    record(
      "5. Under real RLS, connection B's own SELECT sees zero rows for its own clinic's patients",
      patientsUnderRls.rows.length === 0,
      `saw=${patientsUnderRls.rows.length}`
    );
  }

  console.log("--- Connection A reactivates connection B's identity ---");
  await connA.query(`update clinic_users set status = 'Active' where auth_user_id = $1 and clinic_id = $2`, [suspendMeId, clinicId]);

  console.log("--- Connection B (still the SAME connection) regains access immediately ---");
  {
    await actAsSession(connB, suspendMeId);
    const role = await connB.query(`select _caller_role($1) as role`, [clinicId]);
    record(
      "6. Reactivation restores access on the same still-open connection immediately - a live per-query check, not something needing a fresh login",
      role.rows[0]?.role === "Owner",
      `role=${role.rows[0]?.role}`
    );

    const voidAfterReactivate = await connB.query(`select * from void_invoice($1, 'reactivated user retry')`, [invoiceId]);
    record(
      "7. Once reactivated, the same connection CAN void the invoice - confirms the earlier rejection was genuinely about suspension, not some other unrelated problem",
      voidAfterReactivate.rows[0]?.status === "Voided",
      `status=${voidAfterReactivate.rows[0]?.status}`
    );
  }

  connA.release();
  connB.release();
  await pool.end();

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  console.log(
    `\nThis run's data was left in staging (clinic_id=${clinicId}, org_id=${orgId}) - run \`npm run staging:sync-schema\` to reset staging to empty before/after further use.`
  );
  if (failed.length > 0) {
    console.error(`FAILED CHECKS: ${failed.map((f) => f.name).join("; ")}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
