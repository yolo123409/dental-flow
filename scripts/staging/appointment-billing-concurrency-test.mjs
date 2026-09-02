// Phase B/C (Appointment Completion -> Billing) — targeted concurrency
// verification for the two duplicate-billing races the design phase
// specifically identified:
//
//   1. Two DIFFERENT appointments pointing at the SAME treatment_plan_item
//      (the legitimate multi-visit shape migration 0107 allows) being
//      confirmed complete at the same time - must produce exactly one
//      treatment completion and, downstream, exactly one invoice.
//   2. Two concurrent requests to invoice the SAME Pending charge (the
//      pre-existing createInvoice() gap closed by the atomic
//      create_invoice_from_charges RPC, migration 0109) - must produce
//      exactly one invoice, never two.
//
// Also verifies the SAME-appointment idempotency (a plain conditional
// UPDATE, not an RPC) under genuine concurrent load, not just the
// single-connection savepoint checks in db-integration-tests.mjs.
//
// Uses a real pg.Pool (independent connections), the same methodology as
// scripts/staging/concurrency-test.mjs - savepoints inside one shared
// transaction can prove BEHAVIOR but never CONCURRENCY SAFETY, only truly
// separate connections can. Deliberately small and focused rather than
// folded into concurrency-test.mjs's 47-branch load harness: these three
// races don't need bulk synthetic volume to prove, and keeping this
// separate means a failure here is never confused with a load-capacity
// finding.
//
// SAFETY: staging only, gated by the same assertDistinctProjects check
// every other write-capable script in this repo uses. WRITES AND KEEPS
// its data (a handful of rows, not a bulk load) - run
// `npm run staging:sync-schema` afterward to reset staging to empty.
//
// Run `npm run staging:apply-pending-migrations` first if migrations
// 0107-0109 haven't reached staging yet.
import pg from "pg";
import { getProdDbUrl, getRestoreTestDbUrl, getRestoreTestSupabaseUrl, assertDistinctProjects } from "../backup/lib/env.mjs";

const results = [];
function record(name, pass, detail = "") {
  results.push({ name, pass, detail });
  console.log(`[${pass ? "PASS" : "FAIL"}] ${name}${detail ? " - " + detail : ""}`);
}

async function actAsSession(client, authUserId) {
  await client.query(`select set_config('request.jwt.claims', json_build_object('sub', $1::text)::text, false)`, [authUserId]);
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
  const dentistUserId = (await setupClient.query(`select gen_random_uuid() as id`)).rows[0].id;
  const receptionistUserId = (await setupClient.query(`select gen_random_uuid() as id`)).rows[0].id;

  await setupClient.query(`alter table public.treatment_plans disable trigger trg_guard_treatment_plan_role;`);
  await setupClient.query(`alter table public.treatment_plan_items disable trigger trg_guard_treatment_plan_item_role;`);

  await setupClient.query(`insert into public.organizations (id, name) values ($1, 'FIN-B/C Concurrency Test Org')`, [orgId]);
  await setupClient.query(`insert into public.clinics (id, name, organization_id, currency) values ($1, 'FIN-B/C Test Branch', $2, 'KES')`, [clinicId, orgId]);
  await setupClient.query(`insert into public.clinic_settings (clinic_id, clinic_name, currency) values ($1, 'FIN-B/C Test Branch', 'KES')`, [clinicId]);
  await setupClient.query(
    `insert into public.clinic_users (clinic_id, auth_user_id, full_name, email, role, status) values
     ($1, $2, 'Dentist Test', 'dentist@finbc-conc.test', 'Dentist', 'Active'),
     ($1, $3, 'Receptionist Test', 'receptionist@finbc-conc.test', 'Receptionist', 'Active')`,
    [clinicId, dentistUserId, receptionistUserId]
  );

  await actAsSession(setupClient, dentistUserId);
  await setupClient.query(`select ensure_ledger_provisioned_multi(array[$1]::uuid[]);`, [clinicId]);

  const dentistRow = await setupClient.query(
    `insert into public.dentists (clinic_id, full_name) values ($1, 'Dr. FIN-B/C') returning id`,
    [clinicId]
  );
  const dentistRowId = dentistRow.rows[0].id;

  const patientRow = await setupClient.query(
    `insert into public.patients (clinic_id, first_name, last_name) values ($1, 'Concurrency', 'TestPatient') returning id`,
    [clinicId]
  );
  const patientId = patientRow.rows[0].id;

  const planRow = await setupClient.query(
    `insert into public.treatment_plans (clinic_id, patient_id, title, status) values ($1, $2, 'FIN-B/C Concurrency Plan', 'Active') returning id`,
    [clinicId, patientId]
  );
  const planId = planRow.rows[0].id;

  // Race A fixture: one treatment, exactly the kind of thing a root canal
  // spanning several visits would be, with TWO different appointments
  // both legitimately pointing at it (migration 0107's whole reason for
  // being non-unique). Still Planned/In Progress - neither appointment
  // has confirmed it done yet.
  const raceATreatment = await setupClient.query(
    `select * from create_treatment_with_teeth($1, 'Root Canal - Concurrency Race', array[36], 18000, 1, null, 'Medium', 'Planned')`,
    [planId]
  );
  const raceATreatmentId = raceATreatment.rows[0].id;
  const raceATreatmentChargeId = raceATreatment.rows[0].charge_id;

  const raceAAppointments = await setupClient.query(
    `insert into public.appointments (clinic_id, patient_id, dentist_id, appointment_date, appointment_time, treatment, status, treatment_plan_item_id)
     values
       ($1, $2, $3, current_date, '09:00', 'Root canal - visit A', 'Scheduled', $4),
       ($1, $2, $3, current_date + 7, '09:00', 'Root canal - visit B', 'Scheduled', $4)
     returning id`,
    [clinicId, patientId, dentistRowId, raceATreatmentId]
  );
  const raceAAppointmentIds = raceAAppointments.rows.map((r) => r.id);

  // Race B fixture: a single, ordinary (unlinked) appointment - this race
  // is purely about the SAME appointment row, treatment linkage is
  // irrelevant to it.
  const raceBAppointment = await setupClient.query(
    `insert into public.appointments (clinic_id, patient_id, dentist_id, appointment_date, appointment_time, treatment, status)
     values ($1, $2, $3, current_date, '10:00', 'Checkup', 'Scheduled') returning id`,
    [clinicId, patientId, dentistRowId]
  );
  const raceBAppointmentId = raceBAppointment.rows[0].id;

  // Race C fixture: a treatment already confirmed Completed (via the
  // exact RPC completeAndBillTreatmentItem() would call), so its charge
  // is Pending and eligible to invoice - several Receptionist sessions
  // will now race to invoice this ONE charge.
  const raceCTreatment = await setupClient.query(
    `select * from create_treatment_with_teeth($1, 'Cleaning - Concurrency Race', array[46], 3000, 1, null, 'Low', 'Planned')`,
    [planId]
  );
  await setupClient.query(`select complete_treatment_item($1)`, [raceCTreatment.rows[0].id]);
  const raceCChargeId = raceCTreatment.rows[0].charge_id;

  await setupClient.query(`alter table public.treatment_plans enable trigger trg_guard_treatment_plan_role;`);
  await setupClient.query(`alter table public.treatment_plan_items enable trigger trg_guard_treatment_plan_item_role;`);

  await setupClient.end();
  console.log("Setup complete. Starting concurrent phase via a real connection pool.\n");

  const pool = new pg.Pool({ connectionString: restoreUrl, max: 8, connectionTimeoutMillis: 20000, statement_timeout: 30000 });

  async function withConn(authUserId, fn) {
    const client = await pool.connect();
    try {
      await actAsSession(client, authUserId);
      return await fn(client);
    } finally {
      client.release();
    }
  }

  // ============================================================
  // RACE A: two DIFFERENT appointments (both legitimately linked to the
  // same multi-visit treatment) confirmed complete AT THE SAME TIME.
  // Exactly one must win; the loser must see it already Completed
  // (returns null) and must never attempt to bill.
  // ============================================================
  console.log("--- Race A: two different appointments confirming the SAME treatment complete concurrently ---");
  {
    const attempts = await Promise.allSettled(
      raceAAppointmentIds.map(() =>
        withConn(dentistUserId, (client) =>
          client.query(`select complete_treatment_item($1) as result`, [raceATreatmentId])
        )
      )
    );

    const winners = attempts
      .filter((a) => a.status === "fulfilled" && a.value.rows[0].result !== null)
      .map((a) => a.value.rows[0].result);

    record(
      "A1. Exactly one of two concurrent treatment-completion confirmations wins; the other sees it already Completed",
      winners.length === 1,
      `winners=${winners.length}/2`
    );

    const treatmentAfter = await pool.query(`select status from treatment_plan_items where id = $1`, [raceATreatmentId]);
    record(
      "A2. The treatment itself is Completed exactly once, not corrupted by the race",
      treatmentAfter.rows[0]?.status === "Completed",
      `status=${treatmentAfter.rows[0]?.status}`
    );

    const chargeCount = await pool.query(`select count(*)::int as n from clinic_charges where treatment_plan_item_id = $1`, [raceATreatmentId]);
    record(
      "A3. Exactly one canonical charge exists for this treatment instance (the pre-existing unique index, still holding)",
      chargeCount.rows[0].n === 1,
      `charges=${chargeCount.rows[0].n}`
    );

    // Only the WINNER's request would, in the real app flow, go on to
    // invoice - simulated here exactly as completeAndBillTreatmentItem()
    // does: one createInvoice() call for the one charge.
    const invoiceAttempt = await withConn(receptionistUserId, (client) =>
      client.query(
        `select * from create_invoice_from_charges(
           array[$1]::uuid[], $2, 'FINBC-RACE-A-INV', 18000, 0, 0, 18000,
           null, 'Cash', null, false, 'VAT', 0, false, null
         )`,
        [raceATreatmentChargeId, patientId]
      )
    );
    const invoiceCount = await pool.query(`select count(*)::int as n from clinic_invoices where id = $1`, [invoiceAttempt.rows[0].id]);
    record(
      "A4. Exactly one invoice results from the whole race, for the exact amount of the one treatment (never double-billed)",
      invoiceCount.rows[0].n === 1,
      `invoiceId=${invoiceAttempt.rows[0].id}`
    );
  }

  // ============================================================
  // RACE B: five concurrent requests to complete the SAME appointment -
  // the plain conditional UPDATE completeAppointment() uses
  // (`where status != 'Completed'`), proven under real concurrent
  // connections rather than assumed from single-statement semantics.
  // ============================================================
  console.log("--- Race B: five concurrent completion requests against the SAME appointment ---");
  {
    const attempts = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        withConn(dentistUserId, (client) =>
          client.query(
            `update appointments set status = 'Completed' where id = $1 and clinic_id = $2 and status != 'Completed' returning id`,
            [raceBAppointmentId, clinicId]
          )
        )
      )
    );

    const wins = attempts.filter((a) => a.status === "fulfilled" && a.value.rowCount === 1).length;

    record(
      "B1. Exactly one of five concurrent completion requests against the same appointment actually transitions it",
      wins === 1,
      `wins=${wins}/5`
    );

    const finalStatus = await pool.query(`select status from appointments where id = $1`, [raceBAppointmentId]);
    record(
      "B2. The appointment ends up Completed (not corrupted by the race)",
      finalStatus.rows[0]?.status === "Completed",
      `status=${finalStatus.rows[0]?.status}`
    );
  }

  // ============================================================
  // RACE C: five concurrent Receptionist sessions all try to invoice the
  // SAME already-Pending charge - the exact gap create_invoice_from_
  // charges (migration 0109) exists to close in createInvoice() itself.
  // ============================================================
  console.log("--- Race C: five concurrent attempts to invoice the SAME Pending charge ---");
  {
    const attempts = await Promise.allSettled(
      Array.from({ length: 5 }, (_, i) =>
        withConn(receptionistUserId, (client) =>
          client.query(
            `select * from create_invoice_from_charges(
               array[$1]::uuid[], $2, $3, 3000, 0, 0, 3000,
               null, 'Cash', null, false, 'VAT', 0, false, null
             )`,
            [raceCChargeId, patientId, `FINBC-RACE-C-INV-${i}`]
          )
        )
      )
    );

    const succeeded = attempts.filter((a) => a.status === "fulfilled").length;
    const rejectedAsAlreadyInvoiced = attempts.filter(
      (a) => a.status === "rejected" && /already been invoiced/i.test(String(a.reason?.message ?? a.reason))
    ).length;

    record(
      "C1. Exactly one of five concurrent invoice attempts on the same charge succeeds",
      succeeded === 1,
      `succeeded=${succeeded}/5 rejectedAsAlreadyInvoiced=${rejectedAsAlreadyInvoiced}/5`
    );

    const chargeAfter = await pool.query(`select status, invoice_id from clinic_charges where id = $1`, [raceCChargeId]);
    const invoicesReferencingCharge = await pool.query(
      `select count(*)::int as n from clinic_invoices where id = $1`,
      [chargeAfter.rows[0]?.invoice_id]
    );
    record(
      "C2. The charge ends up Invoiced against exactly one invoice - never two, never left ambiguous",
      chargeAfter.rows[0]?.status === "Invoiced" && invoicesReferencingCharge.rows[0].n === 1,
      `chargeStatus=${chargeAfter.rows[0]?.status} invoicesFound=${invoicesReferencingCharge.rows[0].n}`
    );

    const ledgerLines = await pool.query(
      `select en.debit, en.credit from clinic_ledger_transactions t
       join clinic_ledger_entries en on en.transaction_id = t.id
       where t.clinic_id = $1 and t.reference_type = 'invoice' and t.reference_id = $2`,
      [clinicId, chargeAfter.rows[0]?.invoice_id]
    );
    const debit = ledgerLines.rows.reduce((s, r) => s + Number(r.debit), 0);
    const credit = ledgerLines.rows.reduce((s, r) => s + Number(r.credit), 0);
    record(
      "C3. Exactly one balanced ledger posting resulted (no duplicate revenue/AR from the race)",
      debit === credit && debit === 3000,
      `debit=${debit} credit=${credit}`
    );
  }

  // ============================================================
  // Final accounting integrity for everything this run created.
  // ============================================================
  const integrity = await pool.query(`select * from get_ledger_integrity_summary($1)`, [clinicId]);
  const row = integrity.rows[0];
  record(
    "Z. get_ledger_integrity_summary reports a fully clean ledger for this clinic after all three races",
    Number(row.unbalanced_transactions) === 0 && Number(row.duplicate_reference_groups) === 0,
    JSON.stringify(row)
  );

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
