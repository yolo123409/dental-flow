// Billing audit fixes #1 and #3 — targeted concurrency verification for
// the two genuinely concurrent races these RPCs introduce:
//
//   1. Two Owner/Admin sessions both trying to void the SAME invoice at
//      the same time (void_invoice, migration 0110) - the `for update`
//      lock on the invoice row must serialize them so exactly one
//      actually voids and posts the one ledger reversal; the loser must
//      see it already Voided, never post a second reversal.
//   2. Same shape for void_payment on the SAME payment.
//   3. Two sessions both trying to split the SAME treatment into a
//      deposit + balance at the same time (add_treatment_deposit,
//      migration 0112) - the `for update` lock on the treatment_plan_
//      items row must serialize them so exactly one split succeeds,
//      never two deposit charges for one treatment.
//
// Uses a real pg.Pool (independent connections) - the same methodology
// as scripts/staging/appointment-billing-concurrency-test.mjs.
// Savepoints inside one shared transaction (db-integration-tests.mjs)
// can prove BEHAVIOR but never CONCURRENCY SAFETY.
//
// SAFETY: staging only, gated by the same assertDistinctProjects check
// every other write-capable script in this repo uses. WRITES AND KEEPS
// its data - run `npm run staging:sync-schema` afterward to reset
// staging to empty.
//
// Run `npm run staging:apply-pending-migrations` first if migrations
// 0110-0113 haven't reached staging yet.
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
  const ownerUserId = (await setupClient.query(`select gen_random_uuid() as id`)).rows[0].id;
  const dentistUserId = (await setupClient.query(`select gen_random_uuid() as id`)).rows[0].id;
  const receptionistUserId = (await setupClient.query(`select gen_random_uuid() as id`)).rows[0].id;

  await setupClient.query(`alter table public.treatment_plans disable trigger trg_guard_treatment_plan_role;`);
  await setupClient.query(`alter table public.treatment_plan_items disable trigger trg_guard_treatment_plan_item_role;`);
  await setupClient.query(`alter table public.treatment_teeth disable trigger trg_guard_treatment_teeth_role;`);

  await setupClient.query(`insert into public.organizations (id, name) values ($1, 'Billing Audit Concurrency Test Org')`, [orgId]);
  await setupClient.query(`insert into public.clinics (id, name, organization_id, currency) values ($1, 'Billing Audit Test Branch', $2, 'KES')`, [clinicId, orgId]);
  await setupClient.query(`insert into public.clinic_settings (clinic_id, clinic_name, currency) values ($1, 'Billing Audit Test Branch', 'KES')`, [clinicId]);
  await setupClient.query(
    `insert into public.clinic_users (clinic_id, auth_user_id, full_name, email, role, status) values
     ($1, $2, 'Owner Test', 'owner@billingaudit-conc.test', 'Owner', 'Active'),
     ($1, $3, 'Dentist Test', 'dentist@billingaudit-conc.test', 'Dentist', 'Active'),
     ($1, $4, 'Receptionist Test', 'receptionist@billingaudit-conc.test', 'Receptionist', 'Active')`,
    [clinicId, ownerUserId, dentistUserId, receptionistUserId]
  );

  await actAsSession(setupClient, ownerUserId);
  await setupClient.query(`select ensure_ledger_provisioned_multi(array[$1]::uuid[]);`, [clinicId]);

  const patientRow = await setupClient.query(
    `insert into public.patients (clinic_id, first_name, last_name) values ($1, 'Concurrency', 'TestPatient') returning id`,
    [clinicId]
  );
  const patientId = patientRow.rows[0].id;

  const planRow = await setupClient.query(
    `insert into public.treatment_plans (clinic_id, patient_id, title, status) values ($1, $2, 'Billing Audit Concurrency Plan', 'Active') returning id`,
    [clinicId, patientId]
  );
  const planId = planRow.rows[0].id;

  // Race D fixture: an unpaid, Invoiced-from-a-charge invoice - two Owner
  // sessions will race to void it.
  const raceDTreatment = await setupClient.query(
    `select * from create_treatment_with_teeth($1, 'Voidable Root Canal - Race D', array[36], 18000, 1, null, 'Medium', 'Planned')`,
    [planId]
  );
  await actAsSession(setupClient, receptionistUserId);
  const raceDInvoice = await setupClient.query(
    `select * from create_invoice_from_charges(
       array[$1]::uuid[], $2, 'RACE-D-INV', 18000, 0, 0, 18000,
       null, 'Cash', null, false, 'VAT', 0, false, null
     )`,
    [raceDTreatment.rows[0].charge_id, patientId]
  );
  const raceDInvoiceId = raceDInvoice.rows[0].id;

  // Race E fixture: an invoice with exactly one payment recorded - two
  // Owner sessions will race to void THAT payment.
  const raceETreatment = await setupClient.query(
    `select * from create_treatment_with_teeth($1, 'Filling - Race E', array[37], 5000, 1, null, 'Low', 'Planned')`,
    [planId]
  );
  const raceEInvoice = await setupClient.query(
    `select * from create_invoice_from_charges(
       array[$1]::uuid[], $2, 'RACE-E-INV', 5000, 0, 0, 5000,
       null, 'Cash', null, false, 'VAT', 0, false, null
     )`,
    [raceETreatment.rows[0].charge_id, patientId]
  );
  const racePayment = await setupClient.query(
    `select * from record_payment($1, 5000, 'Cash', null, null, null)`,
    [raceEInvoice.rows[0].id]
  );
  const racePaymentRow = await setupClient.query(
    `select id from clinic_payments where invoice_id = $1`,
    [raceEInvoice.rows[0].id]
  );
  const racePaymentId = racePaymentRow.rows[0].id;

  // Race F fixture: a fresh, unsplit Pending treatment - two sessions
  // will race to split it into a deposit + balance at the same time.
  await actAsSession(setupClient, dentistUserId);
  const raceFTreatment = await setupClient.query(
    `select * from create_treatment_with_teeth($1, 'Implant - Race F', array[38], 50000, 1, null, 'High', 'Planned')`,
    [planId]
  );
  const raceFItemId = raceFTreatment.rows[0].id;

  await setupClient.query(`alter table public.treatment_plans enable trigger trg_guard_treatment_plan_role;`);
  await setupClient.query(`alter table public.treatment_plan_items enable trigger trg_guard_treatment_plan_item_role;`);
  await setupClient.query(`alter table public.treatment_teeth enable trigger trg_guard_treatment_teeth_role;`);

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
  // RACE D: two Owner sessions both void the SAME invoice at once.
  // ============================================================
  console.log("--- Race D: two concurrent void_invoice calls on the SAME invoice ---");
  {
    const attempts = await Promise.allSettled(
      Array.from({ length: 2 }, () =>
        withConn(ownerUserId, (client) =>
          client.query(`select * from void_invoice($1, 'concurrency race D')`, [raceDInvoiceId])
        )
      )
    );

    const succeeded = attempts.filter((a) => a.status === "fulfilled").length;
    const rejectedAsAlreadyVoided = attempts.filter(
      (a) => a.status === "rejected" && /already been voided/i.test(String(a.reason?.message ?? a.reason))
    ).length;

    record(
      "D1. Exactly one of two concurrent void_invoice calls on the same invoice succeeds",
      succeeded === 1 && rejectedAsAlreadyVoided === 1,
      `succeeded=${succeeded}/2 rejectedAsAlreadyVoided=${rejectedAsAlreadyVoided}/2`
    );

    const invoiceAfter = await pool.query(`select status, balance from clinic_invoices where id = $1`, [raceDInvoiceId]);
    record(
      "D2. The invoice ends up Voided with a zeroed balance, not corrupted by the race",
      invoiceAfter.rows[0]?.status === "Voided" && Number(invoiceAfter.rows[0]?.balance) === 0,
      `status=${invoiceAfter.rows[0]?.status} balance=${invoiceAfter.rows[0]?.balance}`
    );

    const reversals = await pool.query(
      `select count(*)::int as n from clinic_ledger_transactions t
       where t.clinic_id = $1 and t.transaction_type = 'Reversal' and t.reverses_transaction_id = (
         select id from clinic_ledger_transactions where reference_type = 'invoice' and reference_id = $2
       )`,
      [clinicId, raceDInvoiceId]
    );
    record(
      "D3. Exactly one reversal transaction was posted, never two, for the one void that actually won",
      reversals.rows[0].n === 1,
      `reversals=${reversals.rows[0].n}`
    );
  }

  // ============================================================
  // RACE E: two Owner sessions both void the SAME payment at once.
  // ============================================================
  console.log("--- Race E: two concurrent void_payment calls on the SAME payment ---");
  {
    const attempts = await Promise.allSettled(
      Array.from({ length: 2 }, () =>
        withConn(ownerUserId, (client) =>
          client.query(`select * from void_payment($1, 'concurrency race E')`, [racePaymentId])
        )
      )
    );

    const succeeded = attempts.filter((a) => a.status === "fulfilled").length;
    const rejectedAsAlreadyVoided = attempts.filter(
      (a) => a.status === "rejected" && /already been voided/i.test(String(a.reason?.message ?? a.reason))
    ).length;

    record(
      "E1. Exactly one of two concurrent void_payment calls on the same payment succeeds",
      succeeded === 1 && rejectedAsAlreadyVoided === 1,
      `succeeded=${succeeded}/2 rejectedAsAlreadyVoided=${rejectedAsAlreadyVoided}/2`
    );

    const invoiceAfter = await pool.query(
      `select amount_paid, balance, status from clinic_invoices where id = $1`,
      [raceEInvoice.rows[0].id]
    );
    record(
      "E2. The invoice's amount_paid/balance were decremented exactly ONCE by the payment's amount, not twice",
      Number(invoiceAfter.rows[0]?.amount_paid) === 0 &&
        Number(invoiceAfter.rows[0]?.balance) === 5000 &&
        invoiceAfter.rows[0]?.status === "Unpaid",
      `amount_paid=${invoiceAfter.rows[0]?.amount_paid} balance=${invoiceAfter.rows[0]?.balance} status=${invoiceAfter.rows[0]?.status}`
    );
  }

  // ============================================================
  // RACE F: two sessions both try to split the SAME treatment into a
  // deposit + balance at the same time.
  // ============================================================
  console.log("--- Race F: two concurrent add_treatment_deposit calls on the SAME treatment ---");
  {
    const attempts = await Promise.allSettled([
      withConn(dentistUserId, (client) => client.query(`select * from add_treatment_deposit($1, 15000)`, [raceFItemId])),
      withConn(dentistUserId, (client) => client.query(`select * from add_treatment_deposit($1, 20000)`, [raceFItemId])),
    ]);

    const succeeded = attempts.filter((a) => a.status === "fulfilled").length;
    const rejectedAsAlreadySplit = attempts.filter(
      (a) => a.status === "rejected" && /already on a deposit/i.test(String(a.reason?.message ?? a.reason))
    ).length;

    record(
      "F1. Exactly one of two concurrent add_treatment_deposit calls on the same treatment succeeds",
      succeeded === 1 && rejectedAsAlreadySplit === 1,
      `succeeded=${succeeded}/2 rejectedAsAlreadySplit=${rejectedAsAlreadySplit}/2`
    );

    const chargesForItem = await pool.query(
      `select count(*)::int as n from clinic_charges where treatment_plan_item_id = $1`,
      [raceFItemId]
    );
    record(
      "F2. Exactly two charges exist for this treatment afterward (one deposit, one balance) - never three from a lost race",
      chargesForItem.rows[0].n === 2,
      `charges=${chargesForItem.rows[0].n}`
    );

    const totalAmount = await pool.query(
      `select coalesce(sum(amount), 0) as total from clinic_charges where treatment_plan_item_id = $1`,
      [raceFItemId]
    );
    record(
      "F3. The two charges' amounts still sum to exactly the original 50000 - the race never lost or duplicated money",
      Number(totalAmount.rows[0].total) === 50000,
      `total=${totalAmount.rows[0].total}`
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
