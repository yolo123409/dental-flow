// FIN-4.2 — permanent database/RLS/trigger regression suite.
//
// WHY THIS EXISTS: FIN-3.8 shipped a database trigger that broke every
// invoice creation with line items in production, and DentalFlow's 418
// passing vitest tests caught none of it - that suite mocks the Supabase
// client, so it can never observe a SQL trigger's own behavior. This
// script is real: it runs actual INSERT/UPDATE/DELETE/RPC statements
// against a real Postgres database and checks what the database itself
// does, the same live-verification methodology FIN-3 used ad hoc against
// production, formalized here against staging instead.
//
// SAFETY: refuses to run unless the target is live-proven (via
// system_identifier, not just a different URL) to be a different
// physical cluster than production - the same assertDistinctProjects
// gate every other write-capable script in this repo uses. Everything
// below runs inside ONE transaction, ROLLBACK'd unconditionally at the
// end (success or failure) - staging always ends the run exactly as
// empty as sync-schema.mjs left it.
//
// Run `npm run staging:sync-schema` first if staging's schema might be
// behind the latest migration - this script does not do that itself
// (kept separate: syncing schema and running behavioral tests are
// different concerns, and re-running DDL on every test invocation would
// make failures harder to isolate).
import pg from "pg";
import { getProdDbUrl, getRestoreTestDbUrl, getRestoreTestSupabaseUrl, assertDistinctProjects } from "../backup/lib/env.mjs";
import { actAs, actAsWithRls, resetRole, attemptWithSavepoint } from "./lib/roleSession.mjs";

const results = [];
function record(name, pass, detail = "") {
  results.push({ name, pass, detail });
  console.log(`[${pass ? "PASS" : "FAIL"}] ${name}${detail ? " - " + detail : ""}`);
}

function uuid(seed) {
  // Fixed, readable synthetic UUIDs - easier to debug a failed run than
  // random ones, and collision-safe since this whole run is rolled back.
  return `a1000000-0000-4000-8000-${seed.padStart(12, "0")}`;
}

const ORG_ID = uuid("000000000001");
const CLINIC_A = uuid("00000000000a");
const CLINIC_B = uuid("00000000000b");
const OWNER_A = uuid("0000000000a1");
const ADMIN_A = uuid("0000000000a2");
const DENTIST_A = uuid("0000000000a3");
const RECEPTIONIST_A = uuid("0000000000a4");
const OWNER_B = uuid("0000000000b1");
const CEO_ID = uuid("0000000000c1");

async function main() {
  const prodUrl = getProdDbUrl();
  const restoreUrl = getRestoreTestDbUrl();
  const prodSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const restoreSupabaseUrl = getRestoreTestSupabaseUrl();
  await assertDistinctProjects({ prodDbUrl: prodUrl, prodSupabaseUrl, restoreDbUrl: restoreUrl, restoreSupabaseUrl });
  console.log("Safety check passed: test target is a live-verified, different Postgres cluster than production.\n");

  const client = new pg.Client({ connectionString: restoreUrl, connectionTimeoutMillis: 15000 });
  await client.connect();
  console.log("Connected to staging (restore-test project).\n");

  try {
    await client.query("BEGIN");

    // ============================================================
    // Setup: 2 clinics, 1 organization, 6 role identities, ledger
    // provisioning. Everything here uses tables with no role-guard
    // trigger EXCEPT clinic_inventory_items, which is created as
    // Owner A below.
    // ============================================================
    console.log("--- Setup ---");
    await client.query(`insert into organizations (id, name) values ($1, 'FIN-4.2 test org')`, [ORG_ID]);
    await client.query(
      `insert into clinics (id, name, organization_id, currency) values ($1, 'FIN-4.2 Branch A', $2, 'KES'), ($3, 'FIN-4.2 Branch B', $2, 'KES')`,
      [CLINIC_A, ORG_ID, CLINIC_B]
    );
    await client.query(
      `insert into clinic_settings (clinic_id, clinic_name, currency) values ($1, 'Branch A', 'KES'), ($2, 'Branch B', 'KES')`,
      [CLINIC_A, CLINIC_B]
    );

    const dentistARow = await client.query(
      `insert into dentists (clinic_id, full_name) values ($1, 'Dr. Test A') returning id`,
      [CLINIC_A]
    );
    const dentistAId = dentistARow.rows[0].id;

    const patientARow = await client.query(
      `insert into patients (clinic_id, first_name, last_name) values ($1, 'Test', 'PatientA') returning id`,
      [CLINIC_A]
    );
    const patientAId = patientARow.rows[0].id;

    await client.query(
      `insert into clinic_users (clinic_id, auth_user_id, full_name, email, role, status) values
       ($1, $2, 'Owner A', 'owner-a@fin42.test', 'Owner', 'Active'),
       ($1, $3, 'Admin A', 'admin-a@fin42.test', 'Admin', 'Active'),
       ($1, $4, 'Dentist A', 'dentist-a@fin42.test', 'Dentist', 'Active'),
       ($1, $5, 'Receptionist A', 'receptionist-a@fin42.test', 'Receptionist', 'Active'),
       ($1, $6, 'CEO', 'ceo@fin42.test', 'Owner', 'Active'),
       ($7, $8, 'Owner B', 'owner-b@fin42.test', 'Owner', 'Active'),
       ($7, $6, 'CEO', 'ceo@fin42.test', 'Owner', 'Active')`,
      [CLINIC_A, OWNER_A, ADMIN_A, DENTIST_A, RECEPTIONIST_A, CEO_ID, CLINIC_B, OWNER_B]
    );

    await client.query(
      `insert into organization_users (organization_id, auth_user_id, role, active_clinic_id) values ($1, $2, 'CEO', $3)`,
      [ORG_ID, CEO_ID, CLINIC_A]
    );

    const categoryRow = await client.query(
      `insert into clinic_expense_categories (clinic_id, name) values ($1, 'Supplies') returning id`,
      [CLINIC_A]
    );
    const categoryId = categoryRow.rows[0].id;

    await actAs(client, OWNER_A);
    await client.query(`select ensure_ledger_provisioned_multi($1)`, [[CLINIC_A, CLINIC_B]]);

    const invItemRow = await client.query(
      `insert into clinic_inventory_items (clinic_id, name, quantity, unit, cost_per_unit) values ($1, 'Test Gloves', 100, 'box', 50) returning id`,
      [CLINIC_A]
    );
    const inventoryItemId = invItemRow.rows[0].id;
    console.log("Setup complete.\n");

    // ============================================================
    // 1. Invoice creation with invoice items - THE 0097/0098 REGRESSION
    // ============================================================
    let invoiceId;
    {
      await actAs(client, OWNER_A);
      const r = await attemptWithSavepoint(client, async () => {
        const inv = await client.query(
          `insert into clinic_invoices (clinic_id, patient_id, invoice_number, subtotal, tax, total, amount_paid, balance, status)
           values ($1, $2, 'FIN42-INV-001', 1000, 160, 1160, 0, 1160, 'Unpaid') returning id`,
          [CLINIC_A, patientAId]
        );
        invoiceId = inv.rows[0].id;
        await client.query(
          `insert into clinic_invoice_items (invoice_id, treatment_name, quantity, unit_price, total_price) values ($1, 'Test Treatment', 1, 1000, 1000)`,
          [invoiceId]
        );
      });
      record(
        "1. Invoice creation with invoice items succeeds (the exact 0097/0098 regression)",
        r.ok,
        r.ok ? "" : r.error.message
      );
    }

    // ============================================================
    // 2. Invoice item INSERT - Receptionist allowed, Dentist not
    // ============================================================
    let receptionistItemId;
    {
      await actAs(client, RECEPTIONIST_A);
      const r1 = await attemptWithSavepoint(client, async () => {
        const row = await client.query(
          `insert into clinic_invoice_items (invoice_id, treatment_name, quantity, unit_price, total_price) values ($1, 'Item by Receptionist', 1, 50, 50) returning id`,
          [invoiceId]
        );
        receptionistItemId = row.rows[0].id;
      });
      record("2a. Receptionist can INSERT an invoice item", r1.ok, r1.ok ? "" : r1.error.message);

      await actAs(client, DENTIST_A);
      const r2 = await attemptWithSavepoint(client, async () => {
        await client.query(
          `insert into clinic_invoice_items (invoice_id, treatment_name, quantity, unit_price, total_price) values ($1, 'Item by Dentist', 1, 50, 50)`,
          [invoiceId]
        );
      });
      record("2b. Dentist is blocked from INSERTing an invoice item", !r2.ok, r2.ok ? "unexpectedly succeeded" : r2.error.message);
    }

    // ============================================================
    // 3. Invoice item UPDATE
    // ============================================================
    {
      await actAs(client, OWNER_A);
      const r1 = await attemptWithSavepoint(client, async () => {
        await client.query(`update clinic_invoice_items set quantity = 2, total_price = 100 where id = $1`, [receptionistItemId]);
      });
      record("3a. Owner can UPDATE an invoice item", r1.ok, r1.ok ? "" : r1.error.message);

      await actAs(client, DENTIST_A);
      const r2 = await attemptWithSavepoint(client, async () => {
        await client.query(`update clinic_invoice_items set quantity = 3 where id = $1`, [receptionistItemId]);
      });
      record("3b. Dentist is blocked from UPDATEing an invoice item", !r2.ok, r2.ok ? "unexpectedly succeeded" : r2.error.message);
    }

    // ============================================================
    // 4. Invoice item DELETE where legitimately permitted
    // ============================================================
    {
      await actAs(client, ADMIN_A);
      const r1 = await attemptWithSavepoint(client, async () => {
        await client.query(`delete from clinic_invoice_items where id = $1`, [receptionistItemId]);
      });
      record("4a. Admin can DELETE an invoice item", r1.ok, r1.ok ? "" : r1.error.message);

      await actAs(client, DENTIST_A);
      const r2 = await attemptWithSavepoint(client, async () => {
        await client.query(`delete from clinic_invoice_items where invoice_id = $1`, [invoiceId]);
      });
      record("4b. Dentist is blocked from DELETEing an invoice item", !r2.ok, r2.ok ? "unexpectedly succeeded" : r2.error.message);
    }

    // ============================================================
    // 5. Payment creation
    // ============================================================
    let paymentId, paymentTransactionId;
    {
      await actAs(client, RECEPTIONIST_A);
      const r = await attemptWithSavepoint(client, async () => {
        const row = await client.query(
          `insert into clinic_payments (invoice_id, clinic_id, patient_id, amount, payment_method) values ($1, $2, $3, 500, 'Cash') returning id`,
          [invoiceId, CLINIC_A, patientAId]
        );
        paymentId = row.rows[0].id;
      });
      record("5. Receptionist can create a payment", r.ok, r.ok ? "" : r.error.message);

      const txn = await client.query(
        `select id from clinic_ledger_transactions where clinic_id = $1 and reference_id = $2`,
        [CLINIC_A, paymentId]
      );
      paymentTransactionId = txn.rows[0]?.id ?? null;
      record("5b. Payment creation posted exactly one ledger transaction", txn.rows.length === 1, `found=${txn.rows.length}`);
    }

    // ============================================================
    // 6. Payment reversal (full-app audit fix C2: the generic reverse is
    //    now gated off for 'payment'/'invoice'/'customer_credit' types -
    //    void_payment/void_invoice/reverse_customer_credit_application
    //    are the only correct tools, since they also update
    //    clinic_payments/clinic_invoices/clinic_customer_credits, which a
    //    plain ledger reversal cannot do. void_payment's own happy path
    //    (which now calls the internal _reverse_ledger_transaction_core
    //    directly) is exercised by scenario 45 below.)
    // ============================================================
    {
      await actAs(client, OWNER_A);
      const r1 = await attemptWithSavepoint(client, async () => {
        await client.query(`select reverse_ledger_transaction($1, $2, 'FIN-4.2 test reversal')`, [CLINIC_A, paymentTransactionId]);
      });
      record(
        "6a. reverse_ledger_transaction() refuses to reverse a payment posting directly (fix C2) - Void Payment is the correct tool",
        !r1.ok && /Void Payment/.test(r1.error?.message ?? ""),
        r1.ok ? "unexpectedly succeeded" : r1.error.message
      );

      await actAsWithRls(client, OWNER_A);
      const beforeCount = await client.query(`select count(*)::int as n from clinic_payments where id = $1`, [paymentId]);
      const r2 = await attemptWithSavepoint(client, async () => {
        await client.query(`delete from clinic_payments where id = $1`, [paymentId]);
      });
      const afterCount = await client.query(`select count(*)::int as n from clinic_payments where id = $1`, [paymentId]);
      await resetRole(client);
      record(
        "6b. Direct DELETE of a posted payment is blocked (no DELETE policy - RLS filters it to zero rows, not an error)",
        afterCount.rows[0].n === beforeCount.rows[0].n,
        `before=${beforeCount.rows[0].n} after=${afterCount.rows[0].n} deleteThrew=${!r2.ok}`
      );
    }

    // ============================================================
    // 7. Expense creation
    // ============================================================
    let expenseId;
    {
      await actAs(client, OWNER_A);
      const r = await attemptWithSavepoint(client, async () => {
        const row = await client.query(
          `insert into clinic_expenses (clinic_id, category_id, amount, description, payment_method, status) values ($1, $2, 300, 'Test expense', 'Cash', 'Paid') returning id`,
          [CLINIC_A, categoryId]
        );
        expenseId = row.rows[0].id;
      });
      record("7. Owner can create an expense", r.ok, r.ok ? "" : r.error.message);

      const txn = await client.query(`select id from clinic_ledger_transactions where clinic_id = $1 and reference_id = $2`, [CLINIC_A, expenseId]);
      record("7b. Expense creation posted exactly one ledger transaction", txn.rows.length === 1, `found=${txn.rows.length}`);
    }

    // ============================================================
    // 8. Expense modification rules
    // ============================================================
    {
      await actAs(client, OWNER_A);
      const r1 = await attemptWithSavepoint(client, async () => {
        await client.query(`update clinic_expenses set notes = 'updated note' where id = $1`, [expenseId]);
      });
      record("8a. Editing notes on a posted expense succeeds (unlocked column)", r1.ok, r1.ok ? "" : r1.error.message);

      const r2 = await attemptWithSavepoint(client, async () => {
        await client.query(`update clinic_expenses set amount = 999 where id = $1`, [expenseId]);
      });
      record("8b. Editing amount on a posted expense is blocked", !r2.ok, r2.ok ? "unexpectedly succeeded" : r2.error.message);
    }

    // ============================================================
    // 9. Inventory consumption
    // ============================================================
    {
      await actAs(client, RECEPTIONIST_A);
      const before = await client.query(`select quantity from clinic_inventory_items where id = $1`, [inventoryItemId]);
      const r = await attemptWithSavepoint(client, async () => {
        await client.query(`select adjust_inventory_stock($1, -5, 'Used')`, [inventoryItemId]);
      });
      const after = await client.query(`select quantity from clinic_inventory_items where id = $1`, [inventoryItemId]);
      record(
        "9. Inventory consumption (adjust_inventory_stock, -5, 'Used') succeeds and posts a ledger entry",
        r.ok && Number(before.rows[0].quantity) - Number(after.rows[0].quantity) === 5,
        `before=${before.rows[0]?.quantity} after=${after.rows[0]?.quantity} error=${r.ok ? "" : r.error.message}`
      );
    }

    // ============================================================
    // 12. Treatment plan creation (done here - materials need an item)
    // ============================================================
    let planId, planItemId;
    {
      await actAs(client, DENTIST_A);
      const r1 = await attemptWithSavepoint(client, async () => {
        const row = await client.query(
          `insert into treatment_plans (clinic_id, patient_id, title, status) values ($1, $2, 'FIN-4.2 Test Plan', 'Active') returning id`,
          [CLINIC_A, patientAId]
        );
        planId = row.rows[0].id;
      });
      record("12a. Dentist can create a treatment plan", r1.ok, r1.ok ? "" : r1.error.message);

      const itemRow = await client.query(
        `insert into treatment_plan_items (clinic_id, treatment_plan_id, procedure, estimated_price) values ($1, $2, 'Filling', 500) returning id`,
        [CLINIC_A, planId]
      );
      planItemId = itemRow.rows[0].id;

      await actAs(client, RECEPTIONIST_A);
      const r2 = await attemptWithSavepoint(client, async () => {
        await client.query(
          `insert into treatment_plans (clinic_id, patient_id, title, status) values ($1, $2, 'Should Not Exist', 'Active')`,
          [CLINIC_A, patientAId]
        );
      });
      record("12b. Receptionist is blocked from creating a treatment plan", !r2.ok, r2.ok ? "unexpectedly succeeded" : r2.error.message);
    }

    // ============================================================
    // 11. Treatment material creation
    // ============================================================
    let materialUsageId;
    {
      await actAs(client, RECEPTIONIST_A);
      const before = await client.query(`select quantity from clinic_inventory_items where id = $1`, [inventoryItemId]);
      const r = await attemptWithSavepoint(client, async () => {
        const row = await client.query(
          `select * from add_treatment_material($1, $2, 2, null)`,
          [planItemId, inventoryItemId]
        );
        materialUsageId = row.rows[0].id;
      });
      const after = await client.query(`select quantity from clinic_inventory_items where id = $1`, [inventoryItemId]);
      record(
        "11. add_treatment_material() consumes 2 units and posts COGS",
        r.ok && Number(before.rows[0].quantity) - Number(after.rows[0].quantity) === 2,
        `before=${before.rows[0]?.quantity} after=${after.rows[0]?.quantity} error=${r.ok ? "" : r.error.message}`
      );
    }

    // ============================================================
    // 10. Inventory reversal (reduce the material line just created)
    // ============================================================
    {
      await actAs(client, RECEPTIONIST_A);
      const before = await client.query(`select quantity from clinic_inventory_items where id = $1`, [inventoryItemId]);
      const r = await attemptWithSavepoint(client, async () => {
        await client.query(`select update_treatment_material_quantity($1, 1)`, [materialUsageId]);
      });
      const after = await client.query(`select quantity from clinic_inventory_items where id = $1`, [inventoryItemId]);
      const reversalMovement = await client.query(
        `select id from clinic_inventory_movements where inventory_item_id = $1 and movement_type = 'Increase' and reason = 'Consumption Reversal'`,
        [inventoryItemId]
      );
      record(
        "10. Reducing a treatment material line posts a Consumption Reversal movement and returns stock (the FIN-3.4 fix)",
        r.ok && Number(after.rows[0]?.quantity) - Number(before.rows[0]?.quantity) === 1 && reversalMovement.rows.length === 1,
        `before=${before.rows[0]?.quantity} after=${after.rows[0]?.quantity} reversalMovements=${reversalMovement.rows.length} error=${r.ok ? "" : r.error.message}`
      );
    }

    // ============================================================
    // Full-app audit fix H3 (High): deleting a treatment plan item with
    // logged material usage must be blocked - planItemId still has 1
    // unit logged (materialUsageId, reduced from 2 to 1 by scenario 10
    // above) - deleting it would otherwise cascade away the only record
    // that could reverse the stock/COGS it already posted.
    // ============================================================
    {
      await actAs(client, DENTIST_A);
      const rH3 = await attemptWithSavepoint(client, async () => {
        await client.query(`delete from treatment_plan_items where id = $1`, [planItemId]);
      });
      const stillExists = await client.query(`select id from treatment_plan_items where id = $1`, [planItemId]);
      record(
        "H3. Deleting a treatment plan item with logged material usage is blocked",
        !rH3.ok && stillExists.rows.length === 1 && /materials logged against it/i.test(rH3.error?.message ?? ""),
        rH3.ok ? "unexpectedly succeeded" : rH3.error.message
      );
    }

    // ============================================================
    // Full-app audit fix C6 (Critical): cancelling a treatment (or
    // deleting its plan item) must cancel its already-staged Pending
    // charge, so it stops showing up as billable - migration 0119's
    // trigger.
    // ============================================================
    {
      await actAs(client, DENTIST_A);

      // Cancel-via-update path.
      const cancelItem = await client.query(
        `select * from create_treatment_with_teeth($1, 'To Be Cancelled', array[21], 2000, 1, null, 'Low', 'Planned')`,
        [planId]
      );
      const cancelChargeId = cancelItem.rows[0].charge_id;
      await client.query(`update treatment_plan_items set status = 'Cancelled' where id = $1`, [cancelItem.rows[0].id]);
      const cancelChargeAfter = await client.query(`select status from clinic_charges where id = $1`, [cancelChargeId]);
      record(
        "C6a. Setting a treatment plan item's status to Cancelled cancels its linked Pending charge",
        cancelChargeAfter.rows[0]?.status === "Cancelled",
        `chargeStatus=${cancelChargeAfter.rows[0]?.status}`
      );

      // Delete path.
      const deleteItem = await client.query(
        `select * from create_treatment_with_teeth($1, 'To Be Deleted', array[22], 3000, 1, null, 'Low', 'Planned')`,
        [planId]
      );
      const deleteChargeId = deleteItem.rows[0].charge_id;
      await client.query(`delete from treatment_plan_items where id = $1`, [deleteItem.rows[0].id]);
      const deleteChargeAfter = await client.query(`select status, treatment_plan_item_id from clinic_charges where id = $1`, [deleteChargeId]);
      record(
        "C6b. Deleting a treatment plan item cancels its linked Pending charge too (not left silently orphaned-but-still-billable)",
        deleteChargeAfter.rows[0]?.status === "Cancelled" && deleteChargeAfter.rows[0]?.treatment_plan_item_id === null,
        `chargeStatus=${deleteChargeAfter.rows[0]?.status}`
      );

      // Never touches an already-Invoiced charge - financial history.
      const invoicedGuardItem = await client.query(
        `select * from create_treatment_with_teeth($1, 'Already Invoiced', array[23], 4000, 1, null, 'Low', 'Planned')`,
        [planId]
      );
      const invoicedGuardChargeId = invoicedGuardItem.rows[0].charge_id;
      await actAs(client, RECEPTIONIST_A);
      await client.query(
        `select * from create_invoice_from_charges(
           array[$1]::uuid[], $2, 'FIN-C6-INV-001', 4000, 0, 0, 4000,
           null, 'Cash', null, false, 'VAT', 0, false, null
         )`,
        [invoicedGuardChargeId, patientAId]
      );
      await actAs(client, DENTIST_A);
      await client.query(`update treatment_plan_items set status = 'Cancelled' where id = $1`, [invoicedGuardItem.rows[0].id]);
      const invoicedGuardAfter = await client.query(`select status from clinic_charges where id = $1`, [invoicedGuardChargeId]);
      record(
        "C6c. Cancelling a treatment whose charge is already Invoiced never touches that charge - it stays Invoiced, real financial history",
        invoicedGuardAfter.rows[0]?.status === "Invoiced",
        `chargeStatus=${invoicedGuardAfter.rows[0]?.status}`
      );
    }

    // ============================================================
    // 13. Treatment plan deletion
    // ============================================================
    {
      await actAs(client, DENTIST_A);
      const throwawayA = await client.query(
        `insert into treatment_plans (clinic_id, patient_id, title, status) values ($1, $2, 'Throwaway A', 'Active') returning id`,
        [CLINIC_A, patientAId]
      );
      const r1 = await attemptWithSavepoint(client, async () => {
        await client.query(`delete from treatment_plans where id = $1`, [throwawayA.rows[0].id]);
      });
      record("13a. Dentist can delete a treatment plan", r1.ok, r1.ok ? "" : r1.error.message);

      const throwawayB = await client.query(
        `insert into treatment_plans (clinic_id, patient_id, title, status) values ($1, $2, 'Throwaway B', 'Active') returning id`,
        [CLINIC_A, patientAId]
      );
      await actAs(client, RECEPTIONIST_A);
      const r2 = await attemptWithSavepoint(client, async () => {
        await client.query(`delete from treatment_plans where id = $1`, [throwawayB.rows[0].id]);
      });
      record("13b. Receptionist is blocked from deleting a treatment plan", !r2.ok, r2.ok ? "unexpectedly succeeded" : r2.error.message);
    }

    // ============================================================
    // 14. Primary tooth treatment
    // ============================================================
    {
      await actAs(client, DENTIST_A);
      const r = await attemptWithSavepoint(client, async () => {
        await client.query(
          `insert into treatment_teeth (clinic_id, treatment_plan_item_id, tooth_number) values ($1, $2, 55)`,
          [CLINIC_A, planItemId]
        );
      });
      record("14. Primary/deciduous tooth (55) can be associated with a treatment (FIN-3.7)", r.ok, r.ok ? "" : r.error.message);
    }

    // ============================================================
    // 15. Branch switching
    // ============================================================
    {
      await actAs(client, CEO_ID);
      const r = await attemptWithSavepoint(client, async () => {
        await client.query(`select switch_active_branch($1)`, [CLINIC_B]);
      });
      const after = await client.query(`select active_clinic_id from organization_users where auth_user_id = $1`, [CEO_ID]);
      record(
        "15. CEO can switch active branch between two owned branches",
        r.ok && after.rows[0]?.active_clinic_id === CLINIC_B,
        `active_clinic_id=${after.rows[0]?.active_clinic_id} error=${r.ok ? "" : r.error.message}`
      );
    }

    // ============================================================
    // 16. Cross-clinic isolation (real RLS, not a trigger)
    // ============================================================
    {
      await actAsWithRls(client, OWNER_B);
      const patientsSeen = await client.query(`select id from patients where clinic_id = $1`, [CLINIC_A]);
      const clinicsSeen = await client.query(`select id from clinics where organization_id = $1`, [ORG_ID]);
      await resetRole(client);
      record(
        "16a. Owner B (Clinic B only) sees zero of Clinic A's patients under RLS",
        patientsSeen.rows.length === 0,
        `saw=${patientsSeen.rows.length}`
      );
      record(
        "16b. Owner B sees exactly Clinic B, never Clinic A, among the org's clinics under RLS",
        clinicsSeen.rows.length === 1 && clinicsSeen.rows[0].id === CLINIC_B,
        `saw=${clinicsSeen.rows.map((r) => r.id).join(",")}`
      );
    }

    // ============================================================
    // 17. Role restrictions cannot be bypassed by direct table access
    // ============================================================
    {
      await actAs(client, DENTIST_A);
      const r = await attemptWithSavepoint(client, async () => {
        await client.query(
          `insert into clinic_invoices (clinic_id, patient_id, invoice_number, subtotal, total, amount_paid, balance, status) values ($1, $2, 'FIN42-INV-BYPASS', 1, 1, 0, 1, 'Unpaid')`,
          [CLINIC_A, patientAId]
        );
      });
      record(
        "17. A Dentist cannot bypass the app's billing permission check via a direct INSERT into clinic_invoices",
        !r.ok,
        r.ok ? "unexpectedly succeeded" : r.error.message
      );
    }

    // ============================================================
    // 18/19. Ledger posting + VAT posting (from scenario 1's invoice)
    // ============================================================
    {
      const entries = await client.query(
        `select en.debit, en.credit, a.name as account_name, a.code as account_code
         from clinic_ledger_transactions t
         join clinic_ledger_entries en on en.transaction_id = t.id
         join clinic_ledger_accounts a on a.id = en.account_id
         where t.clinic_id = $1 and t.reference_id = $2
         order by en.debit desc, en.credit desc`,
        [CLINIC_A, invoiceId]
      );
      const totalDebit = entries.rows.reduce((s, r) => s + Number(r.debit), 0);
      const totalCredit = entries.rows.reduce((s, r) => s + Number(r.credit), 0);
      const vatLine = entries.rows.find((r) => Number(r.credit) === 160);
      record(
        "18. Invoice ledger posting is a balanced 3-line entry (AR / Revenue / VAT Payable)",
        entries.rows.length === 3 && totalDebit === totalCredit && totalDebit === 1160,
        `lines=${entries.rows.length} debit=${totalDebit} credit=${totalCredit}`
      );
      record(
        "19. VAT is posted to a VAT Payable account for exactly the tax amount (160), not recognized as revenue",
        !!vatLine && /vat/i.test(vatLine.account_name),
        vatLine ? `account=${vatLine.account_name} credit=${vatLine.credit}` : "no matching line found"
      );
    }

    // ============================================================
    // 20. Financial Health reconciliation on freshly-created data
    // ============================================================
    {
      const integrity = await client.query(`select * from get_ledger_integrity_summary($1)`, [CLINIC_A]);
      const row = integrity.rows[0];
      record(
        "20. get_ledger_integrity_summary reports a fully clean ledger for everything this run created",
        Number(row.unbalanced_transactions) === 0 && Number(row.transactions_without_entries) === 0 && Number(row.duplicate_reference_groups) === 0,
        JSON.stringify(row)
      );
    }

    // ============================================================
    // 21-24. FIN-4.4: Customer Credit foundation (grant/apply/refund)
    // ============================================================
    let creditId, overpaidInvoiceId, secondInvoiceId;
    {
      // A fresh, deliberately overpaid invoice: total 1000, paid 1200.
      await actAs(client, OWNER_A);
      const inv = await client.query(
        `insert into clinic_invoices (clinic_id, patient_id, invoice_number, subtotal, total, amount_paid, balance, status)
         values ($1, $2, 'FIN44-INV-OVERPAID', 1000, 1000, 1200, -200, 'Paid') returning id`,
        [CLINIC_A, patientAId]
      );
      overpaidInvoiceId = inv.rows[0].id;

      const r1 = await attemptWithSavepoint(client, async () => {
        await client.query(`select grant_customer_credit($1, null, 'FIN-4.2 test')`, [overpaidInvoiceId]);
      });
      const creditRow = await client.query(
        `select id, amount, remaining_amount from clinic_customer_credits where source_invoice_id = $1`,
        [overpaidInvoiceId]
      );
      creditId = creditRow.rows[0]?.id;
      record(
        "21a. grant_customer_credit reclassifies a 200 overpayment into a Customer Credit",
        r1.ok && creditRow.rows.length === 1 && Number(creditRow.rows[0].amount) === 200,
        `credit=${JSON.stringify(creditRow.rows[0])} error=${r1.ok ? "" : r1.error.message}`
      );

      const ledgerEntries = await client.query(
        `select en.debit, en.credit, a.name as account_name
         from clinic_ledger_transactions t
         join clinic_ledger_entries en on en.transaction_id = t.id
         join clinic_ledger_accounts a on a.id = en.account_id
         where t.clinic_id = $1 and t.reference_id = $2 and t.transaction_type = 'CustomerCreditGrant'`,
        [CLINIC_A, creditId]
      );
      const arLine = ledgerEntries.rows.find((r) => /accounts receivable/i.test(r.account_name));
      const creditLine = ledgerEntries.rows.find((r) => /customer credit/i.test(r.account_name));
      record(
        "21b. The grant posts a balanced Debit AR / Credit Customer Credits entry for exactly 200",
        !!arLine && !!creditLine && Number(arLine.debit) === 200 && Number(creditLine.credit) === 200,
        JSON.stringify(ledgerEntries.rows)
      );

      const r2 = await attemptWithSavepoint(client, async () => {
        await client.query(`select grant_customer_credit($1, null, 'should fail - already granted')`, [overpaidInvoiceId]);
      });
      record(
        "21c. Granting a credit twice on the same invoice is blocked (grant never touches invoice.balance, so this guard is the only thing preventing a duplicate)",
        !r2.ok,
        r2.ok ? "unexpectedly succeeded" : r2.error.message
      );

      // Fresh, separately-overpaid invoice, specifically to test the role
      // guard in isolation from the duplicate-grant guard above.
      const inv2 = await client.query(
        `insert into clinic_invoices (clinic_id, patient_id, invoice_number, subtotal, total, amount_paid, balance, status)
         values ($1, $2, 'FIN44-INV-OVERPAID-2', 100, 100, 120, -20, 'Paid') returning id`,
        [CLINIC_A, patientAId]
      );
      await actAs(client, DENTIST_A);
      const r3 = await attemptWithSavepoint(client, async () => {
        await client.query(`select grant_customer_credit($1, null, 'should fail - wrong role')`, [inv2.rows[0].id]);
      });
      record(
        "21d. Dentist is blocked from granting a customer credit",
        !r3.ok,
        r3.ok ? "unexpectedly succeeded" : r3.error.message
      );
    }

    {
      // A second, currently-outstanding invoice for the SAME patient.
      await actAs(client, OWNER_A);
      const inv = await client.query(
        `insert into clinic_invoices (clinic_id, patient_id, invoice_number, subtotal, total, amount_paid, balance, status)
         values ($1, $2, 'FIN44-INV-TARGET', 150, 150, 0, 150, 'Unpaid') returning id`,
        [CLINIC_A, patientAId]
      );
      secondInvoiceId = inv.rows[0].id;

      await actAs(client, RECEPTIONIST_A);
      const r1 = await attemptWithSavepoint(client, async () => {
        await client.query(`select apply_customer_credit($1, $2, 150)`, [creditId, secondInvoiceId]);
      });
      const invoiceAfter = await client.query(`select amount_paid, balance, status from clinic_invoices where id = $1`, [secondInvoiceId]);
      const creditAfter = await client.query(`select remaining_amount from clinic_customer_credits where id = $1`, [creditId]);
      record(
        "22. apply_customer_credit reduces the second invoice's balance to 0 (Paid) and the credit's remaining balance to 50",
        r1.ok &&
          Number(invoiceAfter.rows[0]?.balance) === 0 &&
          invoiceAfter.rows[0]?.status === "Paid" &&
          Number(creditAfter.rows[0]?.remaining_amount) === 50,
        `invoice=${JSON.stringify(invoiceAfter.rows[0])} credit=${JSON.stringify(creditAfter.rows[0])} error=${r1.ok ? "" : r1.error.message}`
      );

      // Cross-patient guard: patientB's invoice cannot be paid with patientA's credit.
      const patientB = await client.query(`insert into patients (clinic_id, first_name) values ($1, 'PatientB') returning id`, [CLINIC_B]);
      await actAs(client, OWNER_B);
      const otherInvoice = await client.query(
        `insert into clinic_invoices (clinic_id, patient_id, invoice_number, subtotal, total, amount_paid, balance, status)
         values ($1, $2, 'FIN44-INV-OTHER-PATIENT', 50, 50, 0, 50, 'Unpaid') returning id`,
        [CLINIC_B, patientB.rows[0].id]
      );
      await actAs(client, RECEPTIONIST_A);
      const r2 = await attemptWithSavepoint(client, async () => {
        await client.query(`select apply_customer_credit($1, $2, 10)`, [creditId, otherInvoice.rows[0].id]);
      });
      record(
        "22b. apply_customer_credit refuses to apply one patient's credit to a different patient's invoice",
        !r2.ok,
        r2.ok ? "unexpectedly succeeded" : r2.error.message
      );
    }

    {
      await actAs(client, OWNER_A);
      const r1 = await attemptWithSavepoint(client, async () => {
        await client.query(`select refund_customer_credit($1, 50, 'Cash', 'FIN42-REF-001', 'test refund')`, [creditId]);
      });
      const creditAfter = await client.query(`select remaining_amount from clinic_customer_credits where id = $1`, [creditId]);
      const refundEntries = await client.query(
        `select en.debit, en.credit, a.name as account_name
         from clinic_ledger_transactions t
         join clinic_ledger_entries en on en.transaction_id = t.id
         join clinic_ledger_accounts a on a.id = en.account_id
         where t.clinic_id = $1 and t.reference_id = $2 and t.transaction_type = 'CustomerCreditRefund'`,
        [CLINIC_A, creditId]
      );
      const cashLine = refundEntries.rows.find((r) => /cash/i.test(r.account_name));
      record(
        "23. refund_customer_credit refunds the remaining 50 to Cash and zeroes the credit's remaining balance",
        r1.ok && Number(creditAfter.rows[0]?.remaining_amount) === 0 && !!cashLine && Number(cashLine.credit) === 50,
        `credit=${JSON.stringify(creditAfter.rows[0])} error=${r1.ok ? "" : r1.error.message}`
      );

      const r2 = await attemptWithSavepoint(client, async () => {
        await client.query(`select refund_customer_credit($1, 1, 'Cash', null, null)`, [creditId]);
      });
      record(
        "24. refund_customer_credit refuses to refund more than the remaining balance (now 0)",
        !r2.ok,
        r2.ok ? "unexpectedly succeeded" : r2.error.message
      );
    }

    // ============================================================
    // 25-29. FIN-4.7: apply_customer_credit edge cases the UI relies
    // on - unauthorized role, over-invoice-balance, over-remaining,
    // atomic failure (no partial write), a balanced ledger entry, and
    // reuse of an already-exhausted credit (creditId, fully refunded
    // to 0 by scenario 23 above).
    // ============================================================
    {
      // Fresh overpaid invoice + fresh credit, isolated from creditId
      // (already exhausted by scenario 23's refund).
      await actAs(client, OWNER_A);
      const inv = await client.query(
        `insert into clinic_invoices (clinic_id, patient_id, invoice_number, subtotal, total, amount_paid, balance, status)
         values ($1, $2, 'FIN44-INV-OVERPAID-3', 300, 300, 350, -50, 'Paid') returning id`,
        [CLINIC_A, patientAId]
      );
      await client.query(`select grant_customer_credit($1, null, 'FIN-4.7 test')`, [inv.rows[0].id]);
      const credit2Row = await client.query(
        `select id from clinic_customer_credits where source_invoice_id = $1`,
        [inv.rows[0].id]
      );
      const credit2Id = credit2Row.rows[0].id; // remaining_amount = 50

      // Deliberately small balance (10) - less than credit2's remaining
      // (50) - isolates the over-invoice-balance check from the
      // over-remaining check below.
      const smallInv = await client.query(
        `insert into clinic_invoices (clinic_id, patient_id, invoice_number, subtotal, total, amount_paid, balance, status)
         values ($1, $2, 'FIN47-INV-SMALL', 10, 10, 0, 10, 'Unpaid') returning id`,
        [CLINIC_A, patientAId]
      );
      const smallInvoiceId = smallInv.rows[0].id;

      await actAs(client, DENTIST_A);
      const r25 = await attemptWithSavepoint(client, async () => {
        await client.query(`select apply_customer_credit($1, $2, 5)`, [credit2Id, smallInvoiceId]);
      });
      record("25. Dentist is blocked from applying a customer credit", !r25.ok, r25.ok ? "unexpectedly succeeded" : r25.error.message);

      await actAs(client, RECEPTIONIST_A);
      const beforeAttempt = await client.query(`select remaining_amount from clinic_customer_credits where id = $1`, [credit2Id]);
      const r26 = await attemptWithSavepoint(client, async () => {
        // 50 remaining on the credit, but this invoice only has a 10 balance.
        await client.query(`select apply_customer_credit($1, $2, 50)`, [credit2Id, smallInvoiceId]);
      });
      const afterAttempt = await client.query(`select remaining_amount from clinic_customer_credits where id = $1`, [credit2Id]);
      const smallInvoiceAfter = await client.query(`select balance, amount_paid from clinic_invoices where id = $1`, [smallInvoiceId]);
      record(
        "26. Applying more than the target invoice's own balance is blocked, and leaves both the credit and invoice completely unchanged (atomic failure)",
        !r26.ok &&
          Number(beforeAttempt.rows[0].remaining_amount) === Number(afterAttempt.rows[0].remaining_amount) &&
          Number(smallInvoiceAfter.rows[0].balance) === 10 &&
          Number(smallInvoiceAfter.rows[0].amount_paid) === 0,
        r26.ok ? "unexpectedly succeeded" : r26.error.message
      );

      const r27 = await attemptWithSavepoint(client, async () => {
        // Well within the invoice's balance, but exceeds credit2's own
        // remaining amount (50).
        await client.query(`select apply_customer_credit($1, $2, 999)`, [credit2Id, smallInvoiceId]);
      });
      record("27. Applying more than the credit's remaining balance is blocked", !r27.ok, r27.ok ? "unexpectedly succeeded" : r27.error.message);

      const r28 = await attemptWithSavepoint(client, async () => {
        await client.query(`select apply_customer_credit($1, $2, 1)`, [creditId, smallInvoiceId]);
      });
      record(
        "28. A fully-exhausted credit (remaining_amount = 0, from scenario 23's refund) cannot be applied again",
        !r28.ok,
        r28.ok ? "unexpectedly succeeded" : r28.error.message
      );

      const ledgerEntries = await client.query(
        `select en.debit, en.credit, a.name as account_name
         from clinic_ledger_transactions t
         join clinic_ledger_entries en on en.transaction_id = t.id
         join clinic_ledger_accounts a on a.id = en.account_id
         where t.clinic_id = $1 and t.reference_id = $2 and t.transaction_type = 'CustomerCreditApplication'`,
        [CLINIC_A, creditId]
      );
      const totalDebit = ledgerEntries.rows.reduce((s, r) => s + Number(r.debit), 0);
      const totalCredit = ledgerEntries.rows.reduce((s, r) => s + Number(r.credit), 0);
      record(
        "29. Scenario 22's apply_customer_credit posted a balanced ledger entry (Debit Customer Credits / Credit AR, 150)",
        ledgerEntries.rows.length === 2 && totalDebit === totalCredit && totalDebit === 150,
        `lines=${ledgerEntries.rows.length} debit=${totalDebit} credit=${totalCredit}`
      );

      // ============================================================
      // 29b-29e. Full-app audit fix C2/H8: reverse_customer_credit_
      // application - the dedicated undo for a mistakenly-applied
      // credit (migration 0115). credit2Id still has its full 50
      // remaining (every apply attempt against it above was rejected);
      // smallInvoiceId still has its original 10 balance untouched for
      // the same reason - both isolated, unused elsewhere.
      // ============================================================
      await actAs(client, RECEPTIONIST_A);
      await client.query(`select apply_customer_credit($1, $2, 10)`, [credit2Id, smallInvoiceId]);
      const afterApply = await client.query(
        `select balance, amount_paid, status from clinic_invoices where id = $1`,
        [smallInvoiceId]
      );
      record(
        "29b. Setup: a fresh 10 applied from credit2 fully pays off smallInvoice",
        Number(afterApply.rows[0].balance) === 0 && afterApply.rows[0].status === "Paid",
        JSON.stringify(afterApply.rows[0])
      );

      await actAs(client, DENTIST_A);
      const r29c = await attemptWithSavepoint(client, async () => {
        await client.query(`select reverse_customer_credit_application($1, $2, 10, 'test')`, [credit2Id, smallInvoiceId]);
      });
      record(
        "29c. Dentist is blocked from reversing a customer credit application (Owner/Admin only, same as void_invoice/void_payment)",
        !r29c.ok,
        r29c.ok ? "unexpectedly succeeded" : r29c.error.message
      );

      await actAs(client, OWNER_A);
      const r29d = await attemptWithSavepoint(client, async () => {
        await client.query(`select reverse_customer_credit_application($1, $2, 999, 'too much')`, [credit2Id, smallInvoiceId]);
      });
      record(
        "29d. Reversing more than was ever applied from this credit is rejected",
        !r29d.ok,
        r29d.ok ? "unexpectedly succeeded" : r29d.error.message
      );

      await client.query(`select reverse_customer_credit_application($1, $2, 10, 'applied to the wrong invoice')`, [
        credit2Id,
        smallInvoiceId,
      ]);
      const afterReverse = await client.query(
        `select balance, amount_paid, status from clinic_invoices where id = $1`,
        [smallInvoiceId]
      );
      const credit2AfterReverse = await client.query(
        `select remaining_amount from clinic_customer_credits where id = $1`,
        [credit2Id]
      );
      record(
        "29e. reverse_customer_credit_application restores the credit's remaining balance and reopens the invoice's balance by exactly the reversed amount",
        Number(credit2AfterReverse.rows[0].remaining_amount) === 50 &&
          Number(afterReverse.rows[0].balance) === 10 &&
          Number(afterReverse.rows[0].amount_paid) === 0 &&
          afterReverse.rows[0].status === "Unpaid",
        `invoice=${JSON.stringify(afterReverse.rows[0])} creditRemaining=${credit2AfterReverse.rows[0].remaining_amount}`
      );

      const reversalEntries = await client.query(
        `select en.debit, en.credit, a.name as account_name
         from clinic_ledger_transactions t
         join clinic_ledger_entries en on en.transaction_id = t.id
         join clinic_ledger_accounts a on a.id = en.account_id
         where t.clinic_id = $1 and t.reference_id = $2 and t.transaction_type = 'CustomerCreditApplicationReversal'`,
        [CLINIC_A, credit2Id]
      );
      const revDebit = reversalEntries.rows.reduce((s, r) => s + Number(r.debit), 0);
      const revCredit = reversalEntries.rows.reduce((s, r) => s + Number(r.credit), 0);
      record(
        "29f. The reversal posted its own balanced mirror-image ledger entry for exactly 10 (Debit AR / Credit Customer Credits)",
        reversalEntries.rows.length === 2 && revDebit === revCredit && revDebit === 10,
        `lines=${reversalEntries.rows.length} debit=${revDebit} credit=${revCredit}`
      );
    }

    // ============================================================
    // 30-39. Phase B/C: appointment-completion billing
    //   (complete_treatment_item / create_invoice_from_charges,
    //    migrations 0107-0109)
    // ============================================================
    let billableItemId, billableChargeId, billableInvoiceId;
    {
      // 30. Canonical Treatment creation still auto-stages a Pending
      // charge (Phase H, unchanged by this phase) - the regression bar
      // this whole feature builds on top of.
      await actAs(client, DENTIST_A);
      const created = await client.query(
        `select * from create_treatment_with_teeth($1, 'Root Canal', array[11], 8000, 1, null, 'Medium', 'Planned')`,
        [planId]
      );
      billableItemId = created.rows[0].id;
      billableChargeId = created.rows[0].charge_id;
      const stagedCharge = await client.query(`select status, amount from clinic_charges where id = $1`, [billableChargeId]);
      record(
        "30. create_treatment_with_teeth still auto-stages a Pending charge (Phase H regression bar)",
        !!billableChargeId && stagedCharge.rows[0]?.status === "Pending" && Number(stagedCharge.rows[0]?.amount) === 8000,
        `charge_id=${billableChargeId} status=${stagedCharge.rows[0]?.status} amount=${stagedCharge.rows[0]?.amount}`
      );

      // 31. Confirming the treatment complete (the new billing trigger)
      // completes the TREATMENT but does NOT by itself create an
      // invoice/AR/revenue - the charge stays Pending. This is the exact
      // "planned/scheduled/completed-but-not-yet-invoiced" distinction
      // the whole phase exists to enforce.
      const r31 = await attemptWithSavepoint(client, async () => {
        await client.query(`select complete_treatment_item($1)`, [billableItemId]);
      });
      const afterComplete = await client.query(
        `select status from treatment_plan_items where id = $1`,
        [billableItemId]
      );
      const chargeAfterComplete = await client.query(`select status from clinic_charges where id = $1`, [billableChargeId]);
      record(
        "31. Dentist confirming a treatment complete succeeds, and its charge remains Pending - completion is not yet billing",
        r31.ok && afterComplete.rows[0]?.status === "Completed" && chargeAfterComplete.rows[0]?.status === "Pending",
        `treatmentStatus=${afterComplete.rows[0]?.status} chargeStatus=${chargeAfterComplete.rows[0]?.status} error=${r31.ok ? "" : r31.error.message}`
      );

      // 32. Idempotency: completing the SAME treatment a second time is a
      // no-op (returns null) - this is the exact serialization the audit
      // required so two DIFFERENT appointments pointing at the same
      // treatment_plan_item can never both bill it.
      const second = await client.query(`select complete_treatment_item($1) as result`, [billableItemId]);
      record(
        "32. Completing an already-Completed treatment again returns null (idempotent, no second financial event staged)",
        second.rows[0]?.result === null,
        `result=${JSON.stringify(second.rows[0]?.result)}`
      );

      // 33. Receptionist is blocked from confirming clinical completion -
      // matches the existing trg_guard_treatment_plan_item_role
      // restriction (Owner/Admin/Dentist only), unchanged by this phase.
      const freshItem = await client.query(
        `insert into treatment_plan_items (clinic_id, treatment_plan_id, procedure, estimated_price) values ($1, $2, 'Filling 2', 1000) returning id`,
        [CLINIC_A, planId]
      );
      await actAs(client, RECEPTIONIST_A);
      const r33 = await attemptWithSavepoint(client, async () => {
        await client.query(`select complete_treatment_item($1)`, [freshItem.rows[0].id]);
      });
      record(
        "33. Receptionist is blocked from confirming a treatment clinically complete",
        !r33.ok,
        r33.ok ? "unexpectedly succeeded" : r33.error.message
      );
    }

    {
      // 34. create_invoice_from_charges actually invoices the
      // now-Completed treatment's Pending charge - the real financial
      // event, and only now.
      await actAs(client, RECEPTIONIST_A);
      const r34 = await attemptWithSavepoint(client, async () => {
        const row = await client.query(
          `select * from create_invoice_from_charges(
             array[$1]::uuid[], $2, 'FIN-B-INV-001', 8000, 0, 0, 8000,
             null, 'Cash', null, false, 'VAT', 0, false, null
           )`,
          [billableChargeId, patientAId]
        );
        billableInvoiceId = row.rows[0].id;
      });
      const chargeAfterInvoice = await client.query(`select status, invoice_id from clinic_charges where id = $1`, [billableChargeId]);
      const invoiceCount = await client.query(`select count(*)::int as n from clinic_invoices where id = $1`, [billableInvoiceId]);
      record(
        "34. create_invoice_from_charges invoices the completed treatment's charge exactly once",
        r34.ok &&
          chargeAfterInvoice.rows[0]?.status === "Invoiced" &&
          chargeAfterInvoice.rows[0]?.invoice_id === billableInvoiceId &&
          invoiceCount.rows[0].n === 1,
        `chargeStatus=${chargeAfterInvoice.rows[0]?.status} error=${r34.ok ? "" : r34.error?.message}`
      );

      const ledgerEntries = await client.query(
        `select en.debit, en.credit from clinic_ledger_transactions t
         join clinic_ledger_entries en on en.transaction_id = t.id
         where t.clinic_id = $1 and t.reference_id = $2 and t.reference_type = 'invoice'`,
        [CLINIC_A, billableInvoiceId]
      );
      const debit = ledgerEntries.rows.reduce((s, r) => s + Number(r.debit), 0);
      const credit = ledgerEntries.rows.reduce((s, r) => s + Number(r.credit), 0);
      record(
        "35. The atomic RPC's invoice still posts a balanced ledger entry via the existing unchanged trg_post_invoice_ledger",
        ledgerEntries.rows.length > 0 && debit === credit && debit === 8000,
        `lines=${ledgerEntries.rows.length} debit=${debit} credit=${credit}`
      );

      // 36. Invoicing the SAME charge again is rejected, not silently
      // duplicated - the non-concurrent half of duplicate-billing
      // protection (the concurrent half is covered by the staging
      // concurrency suite, which takes a real row lock).
      const r36 = await attemptWithSavepoint(client, async () => {
        await client.query(
          `select * from create_invoice_from_charges(
             array[$1]::uuid[], $2, 'FIN-B-INV-002', 8000, 0, 0, 8000,
             null, 'Cash', null, false, 'VAT', 0, false, null
           )`,
          [billableChargeId, patientAId]
        );
      });
      record(
        "36. Invoicing an already-Invoiced charge again is rejected",
        !r36.ok && /already been invoiced/i.test(r36.error?.message ?? ""),
        r36.ok ? "unexpectedly succeeded" : r36.error.message
      );

      // 36b. Full-app audit fix C1 (Critical): create_invoice_from_charges
      // must reject a charge that belongs to a DIFFERENT patient than the
      // one the invoice is being created for - previously only clinic_id
      // was checked, never patient_id. A fresh Pending charge for
      // patientAId, invoiced against a freshly-created SECOND patient.
      const patientB = await client.query(
        `insert into patients (clinic_id, first_name, last_name) values ($1, 'Test', 'PatientB') returning id`,
        [CLINIC_A]
      );
      await actAs(client, DENTIST_A);
      const crossPatientItem = await client.query(
        `select * from create_treatment_with_teeth($1, 'Whitening', array[]::int[], 500, 1, null, 'Low', 'Planned')`,
        [planId]
      );
      const crossPatientChargeId = crossPatientItem.rows[0].charge_id;

      await actAs(client, RECEPTIONIST_A);
      const r36b = await attemptWithSavepoint(client, async () => {
        await client.query(
          `select * from create_invoice_from_charges(
             array[$1]::uuid[], $2, 'FIN-C1-INV-001', 500, 0, 0, 500,
             null, 'Cash', null, false, 'VAT', 0, false, null
           )`,
          [crossPatientChargeId, patientB.rows[0].id]
        );
      });
      const crossPatientChargeAfter = await client.query(
        `select status from clinic_charges where id = $1`,
        [crossPatientChargeId]
      );
      record(
        "36b. create_invoice_from_charges rejects a charge belonging to a different patient than the invoice's own patient (fix C1)",
        !r36b.ok &&
          /must belong to the invoiced patient/i.test(r36b.error?.message ?? "") &&
          crossPatientChargeAfter.rows[0]?.status === "Pending",
        r36b.ok ? "unexpectedly succeeded" : r36b.error.message
      );

      // 37. A Dentist cannot bypass createInvoice()'s "billing" permission
      // check by calling the RPC directly - matches scenario 17's
      // existing precedent, now also proven for the new atomic RPC. A
      // FRESH Pending charge is used here (not billableChargeId, already
      // Invoiced by scenario 34) so this isolates the role check from
      // the already-invoiced check.
      await actAs(client, DENTIST_A);
      const dentistTestItem = await client.query(
        `select * from create_treatment_with_teeth($1, 'Cleaning', array[]::int[], 1000, 1, null, 'Low', 'Planned')`,
        [planId]
      );
      const dentistTestChargeId = dentistTestItem.rows[0].charge_id;
      const r37 = await attemptWithSavepoint(client, async () => {
        await client.query(
          `select * from create_invoice_from_charges(
             array[$1]::uuid[], $2, 'FIN-B-INV-003', 1000, 0, 0, 1000,
             null, 'Cash', null, false, 'VAT', 0, false, null
           )`,
          [dentistTestChargeId, patientAId]
        );
      });
      record(
        "37. A Dentist cannot bypass billing permission via the atomic create_invoice_from_charges RPC directly",
        !r37.ok,
        r37.ok ? "unexpectedly succeeded" : r37.error.message
      );

      // 38. Cross-clinic isolation: Owner B (Clinic B) cannot invoice a
      // Clinic A charge, even by calling the RPC directly with its id.
      await actAs(client, OWNER_B);
      const r38 = await attemptWithSavepoint(client, async () => {
        await client.query(
          `select * from create_invoice_from_charges(
             array[$1]::uuid[], $2, 'FIN-B-INV-004', 8000, 0, 0, 8000,
             null, 'Cash', null, false, 'VAT', 0, false, null
           )`,
          [billableChargeId, patientAId]
        );
      });
      record(
        "38. Owner of a different clinic cannot invoice another clinic's charge via the atomic RPC",
        !r38.ok,
        r38.ok ? "unexpectedly succeeded" : r38.error.message
      );
    }

    {
      // 39. Multi-visit support: several DIFFERENT appointments can
      // legitimately reference the SAME treatment_plan_item (migration
      // 0107 - deliberately not unique). Nothing here bills anything;
      // this only proves the schema allows the shape a real multi-visit
      // root canal needs (visit 1/2/3 appointments all pointing at one
      // treatment, only the confirming visit later calling
      // complete_treatment_item).
      await actAs(client, DENTIST_A);
      const multiVisitItem = await client.query(
        `select * from create_treatment_with_teeth($1, 'Root Canal - Multi Visit', array[26], 18000, 1, null, 'Medium', 'Planned')`,
        [planId]
      );
      const multiVisitItemId = multiVisitItem.rows[0].id;

      const r39 = await attemptWithSavepoint(client, async () => {
        await client.query(
          `insert into appointments (clinic_id, patient_id, dentist_id, appointment_date, appointment_time, treatment, status, treatment_plan_item_id)
           values
             ($1, $2, $3, current_date, '09:00', 'Root canal - access', 'Completed', $4),
             ($1, $2, $3, current_date + 7, '09:00', 'Root canal - instrumentation', 'Completed', $4),
             ($1, $2, $3, current_date + 14, '09:00', 'Root canal - final visit', 'Scheduled', $4)`,
          [CLINIC_A, patientAId, dentistAId, multiVisitItemId]
        );
      });
      const linkedAppointments = await client.query(
        `select count(*)::int as n from appointments where treatment_plan_item_id = $1`,
        [multiVisitItemId]
      );
      const treatmentStillPlanned = await client.query(
        `select status from treatment_plan_items where id = $1`,
        [multiVisitItemId]
      );
      record(
        "39. Three different appointments can reference the same multi-visit treatment, which remains Planned regardless (no auto-billing from appointment rows alone)",
        r39.ok && linkedAppointments.rows[0].n === 3 && treatmentStillPlanned.rows[0]?.status === "Planned",
        `linked=${linkedAppointments.rows[0]?.n} treatmentStatus=${treatmentStillPlanned.rows[0]?.status} error=${r39.ok ? "" : r39.error.message}`
      );

      // 40. on delete set null: deleting the treatment_plan_item must
      // never delete or orphan the appointment - only clear the link,
      // matching the established precedent for every other
      // treatment_plan_item back-reference in this schema.
      const r40 = await attemptWithSavepoint(client, async () => {
        await client.query(`delete from treatment_plan_items where id = $1`, [multiVisitItemId]);
      });
      const survivingAppointments = await client.query(
        `select treatment_plan_item_id from appointments where treatment = 'Root canal - access'`
      );
      record(
        "40. Deleting the linked treatment_plan_item sets appointments.treatment_plan_item_id to null rather than deleting the appointment",
        r40.ok && survivingAppointments.rows.length === 1 && survivingAppointments.rows[0].treatment_plan_item_id === null,
        `deleted=${r40.ok} survivingCount=${survivingAppointments.rows.length} link=${survivingAppointments.rows[0]?.treatment_plan_item_id}`
      );
    }

    // ============================================================
    // Billing audit fix #1 - void_invoice / void_payment (0110)
    // ============================================================
    {
      // 41. Void a fresh, fully-unpaid invoice: ledger entry reverses
      // (balanced), the charge is freed back to Pending with invoice_id
      // cleared, and the invoice itself is Voided with balance zeroed.
      await actAs(client, DENTIST_A);
      const item41 = await client.query(
        `select * from create_treatment_with_teeth($1, 'Voidable Root Canal', array[12], 9000, 1, null, 'Medium', 'Planned')`,
        [planId]
      );
      const charge41 = item41.rows[0].charge_id;

      await actAs(client, RECEPTIONIST_A);
      const invoiceRow41 = await client.query(
        `select * from create_invoice_from_charges(
           array[$1]::uuid[], $2, 'FIN-V-INV-001', 9000, 0, 0, 9000,
           null, 'Cash', null, false, 'VAT', 0, false, null
         )`,
        [charge41, patientAId]
      );
      const invoice41 = invoiceRow41.rows[0].id;

      await actAs(client, OWNER_A);
      const r41 = await attemptWithSavepoint(client, async () => {
        await client.query(`select * from void_invoice($1, 'Billed the wrong treatment')`, [invoice41]);
      });
      const invoiceAfter41 = await client.query(
        `select status, balance, voided_at, voided_by from clinic_invoices where id = $1`,
        [invoice41]
      );
      const chargeAfter41 = await client.query(
        `select status, invoice_id from clinic_charges where id = $1`,
        [charge41]
      );
      const reversal41 = await client.query(
        `select en.debit, en.credit from clinic_ledger_transactions t
         join clinic_ledger_entries en on en.transaction_id = t.id
         where t.clinic_id = $1 and t.transaction_type = 'Reversal' and t.reverses_transaction_id = (
           select id from clinic_ledger_transactions where reference_type = 'invoice' and reference_id = $2
         )`,
        [CLINIC_A, invoice41]
      );
      const reversalDebit = reversal41.rows.reduce((s, r) => s + Number(r.debit), 0);
      const reversalCredit = reversal41.rows.reduce((s, r) => s + Number(r.credit), 0);
      record(
        "41. void_invoice voids an unpaid invoice, zeroes its balance, frees its charge to Pending, and posts a balanced reversal",
        r41.ok &&
          invoiceAfter41.rows[0]?.status === "Voided" &&
          Number(invoiceAfter41.rows[0]?.balance) === 0 &&
          invoiceAfter41.rows[0]?.voided_at !== null &&
          chargeAfter41.rows[0]?.status === "Pending" &&
          chargeAfter41.rows[0]?.invoice_id === null &&
          reversal41.rows.length === 2 &&
          reversalDebit === reversalCredit &&
          reversalDebit === 9000,
        `status=${invoiceAfter41.rows[0]?.status} balance=${invoiceAfter41.rows[0]?.balance} chargeStatus=${chargeAfter41.rows[0]?.status} reversalDebit=${reversalDebit} reversalCredit=${reversalCredit} error=${r41.ok ? "" : r41.error.message}`
      );

      // 42. Voiding it again is rejected (idempotency guard).
      const r42 = await attemptWithSavepoint(client, async () => {
        await client.query(`select * from void_invoice($1, 'again')`, [invoice41]);
      });
      record(
        "42. Voiding an already-Voided invoice is rejected",
        !r42.ok && /already been voided/i.test(r42.error?.message ?? ""),
        r42.ok ? "unexpectedly succeeded" : r42.error.message
      );

      // 43. A Receptionist (has "billing" but this is a ledger-level
      // action) cannot void an invoice - Owner/Admin only, matching
      // void_supplier_payment's existing precedent.
      const item43 = await client.query(
        `select * from create_treatment_with_teeth($1, 'Filling for void test', array[13], 2000, 1, null, 'Low', 'Planned')`,
        [planId]
      );
      await actAs(client, RECEPTIONIST_A);
      const invoiceRow43 = await client.query(
        `select * from create_invoice_from_charges(
           array[$1]::uuid[], $2, 'FIN-V-INV-002', 2000, 0, 0, 2000,
           null, 'Cash', null, false, 'VAT', 0, false, null
         )`,
        [item43.rows[0].charge_id, patientAId]
      );
      const r43 = await attemptWithSavepoint(client, async () => {
        await client.query(`select * from void_invoice($1, 'trying anyway')`, [invoiceRow43.rows[0].id]);
      });
      record(
        "43. A Receptionist cannot void an invoice - Owner/Admin only",
        !r43.ok,
        r43.ok ? "unexpectedly succeeded" : r43.error.message
      );

      // 44. Voiding an invoice with a payment recorded against it is
      // rejected - "void each payment first, then void the invoice" is
      // the only defined order, so there's never an ambiguous partial-
      // void state.
      await actAs(client, RECEPTIONIST_A);
      await client.query(`select * from record_payment($1, 500, 'Cash', null, null, null)`, [invoiceRow43.rows[0].id]);
      await actAs(client, OWNER_A);
      const r44 = await attemptWithSavepoint(client, async () => {
        await client.query(`select * from void_invoice($1, 'has a payment')`, [invoiceRow43.rows[0].id]);
      });
      record(
        "44. Voiding an invoice with a payment recorded against it is rejected",
        !r44.ok && /void each payment first/i.test(r44.error?.message ?? ""),
        r44.ok ? "unexpectedly succeeded" : r44.error.message
      );

      // 45. void_payment reverses the payment and correctly backs the
      // invoice's amount_paid/balance/status out by exactly that
      // payment's amount (the mirror image of record_payment's own
      // formula) - after which the invoice (now unpaid again) CAN be
      // voided, proving the intended "reverse payment, then void" order
      // actually works end-to-end.
      const paymentRow45 = await client.query(
        `select id from clinic_payments where invoice_id = $1`,
        [invoiceRow43.rows[0].id]
      );
      const r45 = await attemptWithSavepoint(client, async () => {
        await client.query(`select * from void_payment($1, 'wrong invoice')`, [paymentRow45.rows[0].id]);
      });
      const invoiceAfter45 = await client.query(
        `select amount_paid, balance, status from clinic_invoices where id = $1`,
        [invoiceRow43.rows[0].id]
      );
      const paymentAfter45 = await client.query(
        `select status from clinic_payments where id = $1`,
        [paymentRow45.rows[0].id]
      );
      record(
        "45. void_payment reverses a payment and correctly backs out the invoice's amount_paid/balance/status",
        r45.ok &&
          Number(invoiceAfter45.rows[0]?.amount_paid) === 0 &&
          Number(invoiceAfter45.rows[0]?.balance) === 2000 &&
          invoiceAfter45.rows[0]?.status === "Unpaid" &&
          paymentAfter45.rows[0]?.status === "Voided",
        `amount_paid=${invoiceAfter45.rows[0]?.amount_paid} balance=${invoiceAfter45.rows[0]?.balance} status=${invoiceAfter45.rows[0]?.status} error=${r45.ok ? "" : r45.error.message}`
      );

      const r45b = await attemptWithSavepoint(client, async () => {
        await client.query(`select * from void_invoice($1, 'now unpaid again')`, [invoiceRow43.rows[0].id]);
      });
      record(
        "45b. The now-fully-unpaid invoice can be voided after its payment was voided first",
        r45b.ok,
        r45b.ok ? "" : r45b.error.message
      );
    }

    // ============================================================
    // Full-app audit fix (bonus regression, found while fixing C2):
    // void_invoice/void_payment (0110) resolved their own clinic via an
    // arbitrary `clinic_users ... limit 1` pick rather than deriving it
    // from the target row, reintroducing the exact bug migration 0062
    // eliminated everywhere else. CEO_ID has an Owner clinic_users row in
    // BOTH clinics (see setup) - the multi-branch case this bug affected.
    // ============================================================
    {
      const patientB2 = await client.query(
        `insert into patients (clinic_id, first_name, last_name) values ($1, 'Test', 'BranchBPatient') returning id`,
        [CLINIC_B]
      );
      await actAs(client, OWNER_B);
      const invB = await client.query(
        `insert into clinic_invoices (clinic_id, patient_id, invoice_number, subtotal, total, amount_paid, balance, status)
         values ($1, $2, 'FIN-CEO-INV-001', 2000, 2000, 0, 2000, 'Unpaid') returning id`,
        [CLINIC_B, patientB2.rows[0].id]
      );
      const invoiceBId = invB.rows[0].id;

      await actAs(client, CEO_ID);
      const rCeoVoid = await attemptWithSavepoint(client, async () => {
        await client.query(`select * from void_invoice($1, 'CEO multi-branch void test')`, [invoiceBId]);
      });
      const invoiceBAfter = await client.query(`select status from clinic_invoices where id = $1`, [invoiceBId]);
      record(
        "45c. A multi-branch CEO (Owner in both clinics) can void an invoice in a branch other than whichever clinic_users row would be arbitrarily picked first",
        rCeoVoid.ok && invoiceBAfter.rows[0]?.status === "Voided",
        rCeoVoid.ok ? `status=${invoiceBAfter.rows[0]?.status}` : rCeoVoid.error.message
      );
    }

    // ============================================================
    // Full-app audit fix C3 (Critical): deactivating a chart-of-accounts
    // account must never retroactively drop its history from Trial
    // Balance / P&L / Balance Sheet - active governs new entries only.
    // ============================================================
    {
      await actAs(client, OWNER_A);
      const acct = await client.query(
        `insert into clinic_ledger_accounts (clinic_id, code, name, type, active)
         values ($1, '5999', 'FIN-C3 Test Expense Account', 'Expense', true) returning id`,
        [CLINIC_A]
      );
      const testAccountId = acct.rows[0].id;

      const cat = await client.query(
        `insert into clinic_expense_categories (clinic_id, name, default_ledger_account_id) values ($1, 'FIN-C3 Category', $2) returning id`,
        [CLINIC_A, testAccountId]
      );

      await client.query(
        `insert into clinic_expenses (clinic_id, category_id, amount, description, payment_method, status)
         values ($1, $2, 777, 'FIN-C3 test expense', 'Cash', 'Paid')`,
        [CLINIC_A, cat.rows[0].id]
      );

      const beforeDeactivate = await client.query(
        `select total_debit from get_profit_and_loss($1, '2020-01-01', '2030-01-01') where account_id = $2`,
        [CLINIC_A, testAccountId]
      );

      await client.query(`update clinic_ledger_accounts set active = false where id = $1`, [testAccountId]);

      const afterDeactivate = await client.query(
        `select total_debit from get_profit_and_loss($1, '2020-01-01', '2030-01-01') where account_id = $2`,
        [CLINIC_A, testAccountId]
      );
      const trialBalanceAfter = await client.query(
        `select total_debit from get_trial_balance($1) where account_id = $2`,
        [CLINIC_A, testAccountId]
      );

      record(
        "C3. Deactivating an account with posted history does NOT drop it from get_profit_and_loss or get_trial_balance",
        Number(beforeDeactivate.rows[0]?.total_debit) === 777 &&
          Number(afterDeactivate.rows[0]?.total_debit) === 777 &&
          Number(trialBalanceAfter.rows[0]?.total_debit) === 777,
        `before=${beforeDeactivate.rows[0]?.total_debit} afterPL=${afterDeactivate.rows[0]?.total_debit} afterTB=${trialBalanceAfter.rows[0]?.total_debit}`
      );
    }

    // ============================================================
    // Full-app audit fix C4 (Critical), server-side half: the invoice
    // ledger-posting trigger must derive transaction_date from the
    // CLINIC's configured timezone, not a bare ::date cast (which uses
    // the database session's timezone - UTC on Supabase). clinic_settings.
    // timezone defaults to 'Africa/Nairobi' (UTC+3) for every clinic in
    // this suite's setup.
    // ============================================================
    {
      await actAs(client, RECEPTIONIST_A);

      // 2026-06-15T00:30:00 in Nairobi (UTC+3) is 2026-06-14T21:30:00Z -
      // a bare `::date` cast (the pre-fix behavior) would derive the
      // WRONG date, 2026-06-14, since Postgres casts using the session's
      // timezone (UTC), not the clinic's.
      const tzInvoice = await client.query(
        `insert into clinic_invoices (clinic_id, patient_id, invoice_number, subtotal, total, amount_paid, balance, status, created_at)
         values ($1, $2, 'FIN-C4-TZ-001', 100, 100, 0, 100, 'Unpaid', '2026-06-14T21:30:00Z'::timestamptz) returning id`,
        [CLINIC_A, patientAId]
      );
      // Cast to text in SQL rather than comparing the driver's parsed JS
      // Date - node-postgres's own `date`-type parser round-trips through
      // the SCRIPT's local system timezone, which would silently
      // reintroduce the exact same class of bug into the test itself.
      const tzTransaction = await client.query(
        `select transaction_date::text as transaction_date from clinic_ledger_transactions where clinic_id = $1 and reference_type = 'invoice' and reference_id = $2`,
        [CLINIC_A, tzInvoice.rows[0].id]
      );
      record(
        "C4. An invoice created at 00:30 Nairobi time (21:30 UTC the previous day) posts its ledger transaction under the correct LOCAL calendar date, not the UTC-shifted previous day",
        tzTransaction.rows[0]?.transaction_date === "2026-06-15",
        `transaction_date=${tzTransaction.rows[0]?.transaction_date} (expected 2026-06-15)`
      );
    }

    // ============================================================
    // Full-app audit fix H12 (High): cancelling a PO must cascade-cancel
    // its Draft GRN(s), and confirm_grn_receipt must refuse outright
    // against a cancelled PO even if a Draft GRN somehow still exists.
    // Full-app audit fix H13 (High): confirm_grn_receipt must refuse a
    // line item with a non-positive unit cost.
    // ============================================================
    {
      await actAs(client, OWNER_A);
      const supplier = await client.query(
        `insert into clinic_suppliers (clinic_id, name) values ($1, 'FIN-H12 Test Supplier') returning id`,
        [CLINIC_A]
      );
      const supplierId = supplier.rows[0].id;

      // H12a: cascade - a Draft GRN linked to a PO gets cancelled along
      // with it.
      const po1 = await client.query(
        `insert into clinic_purchase_orders (clinic_id, po_number, supplier_id, status) values ($1, 'FIN-H12-PO-1', $2, 'Sent') returning id`,
        [CLINIC_A, supplierId]
      );
      const poi1 = await client.query(
        `insert into clinic_purchase_order_items (purchase_order_id, clinic_id, inventory_item_id, quantity, unit) values ($1, $2, $3, 10, 'box') returning id`,
        [po1.rows[0].id, CLINIC_A, inventoryItemId]
      );
      const grn1 = await client.query(
        `insert into clinic_goods_received_notes (clinic_id, grn_number, purchase_order_id, supplier_id, status) values ($1, 'FIN-H12-GRN-1', $2, $3, 'Draft') returning id`,
        [CLINIC_A, po1.rows[0].id, supplierId]
      );
      await client.query(
        `insert into clinic_grn_items (grn_id, clinic_id, purchase_order_item_id, inventory_item_id, quantity_received, unit, unit_cost) values ($1, $2, $3, $4, 10, 'box', 50)`,
        [grn1.rows[0].id, CLINIC_A, poi1.rows[0].id, inventoryItemId]
      );

      await client.query(`select cancel_purchase_order($1)`, [po1.rows[0].id]);

      const poAfter1 = await client.query(`select status from clinic_purchase_orders where id = $1`, [po1.rows[0].id]);
      const grnAfter1 = await client.query(`select status from clinic_goods_received_notes where id = $1`, [grn1.rows[0].id]);
      record(
        "H12a. Cancelling a PO cascades to cancel its still-Draft GRN(s)",
        poAfter1.rows[0]?.status === "Cancelled" && grnAfter1.rows[0]?.status === "Cancelled",
        `poStatus=${poAfter1.rows[0]?.status} grnStatus=${grnAfter1.rows[0]?.status}`
      );

      const rConfirmCancelled = await attemptWithSavepoint(client, async () => {
        await client.query(`select confirm_grn_receipt($1)`, [grn1.rows[0].id]);
      });
      record(
        "H12a-confirm. Confirming a cancelled GRN is rejected (already-cancelled-GRN check)",
        !rConfirmCancelled.ok,
        rConfirmCancelled.ok ? "unexpectedly succeeded" : rConfirmCancelled.error.message
      );

      // H12b: backstop - a Draft GRN attached to an ALREADY-cancelled PO
      // (simulating a GRN created via some other path, bypassing the
      // cascade) must still be refused specifically because of the PO's
      // own status, not just its own.
      const po2 = await client.query(
        `insert into clinic_purchase_orders (clinic_id, po_number, supplier_id, status) values ($1, 'FIN-H12-PO-2', $2, 'Cancelled') returning id`,
        [CLINIC_A, supplierId]
      );
      const poi2 = await client.query(
        `insert into clinic_purchase_order_items (purchase_order_id, clinic_id, inventory_item_id, quantity, unit) values ($1, $2, $3, 5, 'box') returning id`,
        [po2.rows[0].id, CLINIC_A, inventoryItemId]
      );
      const grn2 = await client.query(
        `insert into clinic_goods_received_notes (clinic_id, grn_number, purchase_order_id, supplier_id, status) values ($1, 'FIN-H12-GRN-2', $2, $3, 'Draft') returning id`,
        [CLINIC_A, po2.rows[0].id, supplierId]
      );
      await client.query(
        `insert into clinic_grn_items (grn_id, clinic_id, purchase_order_item_id, inventory_item_id, quantity_received, unit, unit_cost) values ($1, $2, $3, $4, 5, 'box', 50)`,
        [grn2.rows[0].id, CLINIC_A, poi2.rows[0].id, inventoryItemId]
      );

      const rH12b = await attemptWithSavepoint(client, async () => {
        await client.query(`select confirm_grn_receipt($1)`, [grn2.rows[0].id]);
      });
      record(
        "H12b. confirm_grn_receipt refuses a still-Draft GRN whose parent PO is Cancelled (the backstop)",
        !rH12b.ok && /cancelled purchase order/i.test(rH12b.error?.message ?? ""),
        rH12b.ok ? "unexpectedly succeeded" : rH12b.error.message
      );

      // H13: a zero-unit-cost line item blocks confirmation entirely.
      const po3 = await client.query(
        `insert into clinic_purchase_orders (clinic_id, po_number, supplier_id, status) values ($1, 'FIN-H13-PO-1', $2, 'Sent') returning id`,
        [CLINIC_A, supplierId]
      );
      const grn3 = await client.query(
        `insert into clinic_goods_received_notes (clinic_id, grn_number, purchase_order_id, supplier_id, status) values ($1, 'FIN-H13-GRN-1', $2, $3, 'Draft') returning id`,
        [CLINIC_A, po3.rows[0].id, supplierId]
      );
      await client.query(
        `insert into clinic_grn_items (grn_id, clinic_id, inventory_item_id, quantity_received, unit, unit_cost) values ($1, $2, $3, 5, 'box', 0)`,
        [grn3.rows[0].id, CLINIC_A, inventoryItemId]
      );

      const rH13 = await attemptWithSavepoint(client, async () => {
        await client.query(`select confirm_grn_receipt($1)`, [grn3.rows[0].id]);
      });
      const grn3After = await client.query(`select status from clinic_goods_received_notes where id = $1`, [grn3.rows[0].id]);
      record(
        "H13. confirm_grn_receipt refuses a GRN with a zero unit-cost line item, and never posts inventory for it",
        !rH13.ok && /unit cost greater than 0/i.test(rH13.error?.message ?? "") && grn3After.rows[0]?.status === "Draft",
        rH13.ok ? "unexpectedly succeeded" : rH13.error.message
      );

      // ============================================================
      // Full-app audit fix H14 (High): a supplier return linked to the
      // GRN it came from must net out of that GRN's - and the
      // supplier's overall - outstanding AP figure, not just sit
      // alongside it uncounted.
      // ============================================================
      const po4 = await client.query(
        `insert into clinic_purchase_orders (clinic_id, po_number, supplier_id, status) values ($1, 'FIN-H14-PO-1', $2, 'Sent') returning id`,
        [CLINIC_A, supplierId]
      );
      const poi4 = await client.query(
        `insert into clinic_purchase_order_items (purchase_order_id, clinic_id, inventory_item_id, quantity, unit) values ($1, $2, $3, 20, 'box') returning id`,
        [po4.rows[0].id, CLINIC_A, inventoryItemId]
      );
      const grn4 = await client.query(
        `insert into clinic_goods_received_notes (clinic_id, grn_number, purchase_order_id, supplier_id, status) values ($1, 'FIN-H14-GRN-1', $2, $3, 'Draft') returning id`,
        [CLINIC_A, po4.rows[0].id, supplierId]
      );
      await client.query(
        `insert into clinic_grn_items (grn_id, clinic_id, purchase_order_item_id, inventory_item_id, quantity_received, unit, unit_cost) values ($1, $2, $3, $4, 20, 'box', 50)`,
        [grn4.rows[0].id, CLINIC_A, poi4.rows[0].id, inventoryItemId]
      );
      await client.query(`select confirm_grn_receipt($1)`, [grn4.rows[0].id]);

      const beforeReturn = await client.query(
        `select outstanding_amount from get_supplier_outstanding_grns($1) where grn_id = $2`,
        [supplierId, grn4.rows[0].id]
      );
      record(
        "H14-setup. A freshly-received GRN (20 x 50 = 1000) shows its full amount as outstanding before any return",
        Number(beforeReturn.rows[0]?.outstanding_amount) === 1000,
        `outstanding=${beforeReturn.rows[0]?.outstanding_amount}`
      );

      await client.query(
        `select adjust_inventory_stock($1, -5, 'Returned to Supplier', 'damaged on arrival', null, null, $2, null, null, null, $3)`,
        [inventoryItemId, supplierId, grn4.rows[0].id]
      );

      const afterReturn = await client.query(
        `select outstanding_amount from get_supplier_outstanding_grns($1) where grn_id = $2`,
        [supplierId, grn4.rows[0].id]
      );
      record(
        "H14a. Returning 5 units (5 x 50 = 250) against this GRN reduces its outstanding amount from 1000 to 750, not left at the full 1000",
        Number(afterReturn.rows[0]?.outstanding_amount) === 750,
        `outstanding=${afterReturn.rows[0]?.outstanding_amount}`
      );

      const apSummary = await client.query(
        `select outstanding from get_supplier_ap_summary() where supplier_id = $1`,
        [supplierId]
      );
      record(
        "H14b. The supplier's overall AP summary also reflects the netted-out return, not just the per-GRN figure",
        Number(apSummary.rows[0]?.outstanding) === 750,
        `outstanding=${apSummary.rows[0]?.outstanding}`
      );
    }

    // ============================================================
    // H15 - soft-delete (active flag) for inventory items (0124)
    // ============================================================
    {
      const activeBefore = await client.query(
        `select active from clinic_inventory_items where id = $1`,
        [inventoryItemId]
      );
      record(
        "H15-setup. An existing inventory item defaults to active=true (the migration's own backfill)",
        activeBefore.rows[0]?.active === true,
        `active=${activeBefore.rows[0]?.active}`
      );

      const rH15Dentist = await attemptWithSavepoint(client, async () => {
        await actAs(client, DENTIST_A);
        await client.query(
          `update clinic_inventory_items set active = false where id = $1`,
          [inventoryItemId]
        );
      });
      record(
        "H15a. A Dentist is blocked from deactivating an inventory item (same role guard as any other inventory write)",
        !rH15Dentist.ok,
        rH15Dentist.ok ? "unexpectedly succeeded" : rH15Dentist.error.message
      );

      await actAs(client, OWNER_A);
      await client.query(
        `update clinic_inventory_items set active = false where id = $1`,
        [inventoryItemId]
      );

      const activeOnlyAfterDeactivate = await client.query(
        `select id from clinic_inventory_items where clinic_id = $1 and active = true and id = $2`,
        [CLINIC_A, inventoryItemId]
      );
      const unfilteredAfterDeactivate = await client.query(
        `select id from clinic_inventory_items where clinic_id = $1 and id = $2`,
        [CLINIC_A, inventoryItemId]
      );
      record(
        "H15b. Deactivating hides the item from an active-only fetch (what new-consumption/GRN/PO pickers use) while it still exists for an unfiltered fetch (what reports/history use)",
        activeOnlyAfterDeactivate.rows.length === 0 && unfilteredAfterDeactivate.rows.length === 1,
        `activeOnlyMatch=${activeOnlyAfterDeactivate.rows.length} unfilteredMatch=${unfilteredAfterDeactivate.rows.length}`
      );

      await client.query(
        `update clinic_inventory_items set active = true where id = $1`,
        [inventoryItemId]
      );
      const activeOnlyAfterReactivate = await client.query(
        `select id from clinic_inventory_items where clinic_id = $1 and active = true and id = $2`,
        [CLINIC_A, inventoryItemId]
      );
      record(
        "H15c. Reactivating makes the item visible to an active-only fetch again",
        activeOnlyAfterReactivate.rows.length === 1,
        `activeOnlyMatch=${activeOnlyAfterReactivate.rows.length}`
      );
    }

    // ============================================================
    // Billing audit fix #2 - real due dates (0111)
    // ============================================================
    {
      // 46. With no clinic payment-terms override, a new invoice is due
      // today (default_payment_terms_days = 0, "due on receipt").
      await actAs(client, DENTIST_A);
      const item46 = await client.query(
        `select * from create_treatment_with_teeth($1, 'Due-today Filling', array[14], 1500, 1, null, 'Low', 'Planned')`,
        [planId]
      );
      await actAs(client, RECEPTIONIST_A);
      const invoiceRow46 = await client.query(
        `select * from create_invoice_from_charges(
           array[$1]::uuid[], $2, 'FIN-V-INV-003', 1500, 0, 0, 1500,
           null, 'Cash', null, false, 'VAT', 0, false, null
         )`,
        [item46.rows[0].charge_id, patientAId]
      );
      const dueDate46 = await client.query(
        `select due_date = current_date as due_today from clinic_invoices where id = $1`,
        [invoiceRow46.rows[0].id]
      );
      record(
        "46. A new invoice defaults to due today when the clinic's payment terms are 0",
        dueDate46.rows[0]?.due_today === true,
        `due_today=${dueDate46.rows[0]?.due_today}`
      );

      // 47. Raising the clinic's default payment terms changes the due
      // date of the NEXT invoice created, without touching any existing
      // invoice's already-set due_date (that stays frozen once posted,
      // matching every other invoice field's immutability rule).
      await actAs(client, OWNER_A);
      await client.query(`update clinic_settings set default_payment_terms_days = 30 where clinic_id = $1`, [CLINIC_A]);
      await actAs(client, DENTIST_A);
      const item47 = await client.query(
        `select * from create_treatment_with_teeth($1, 'Net-30 Crown', array[15], 12000, 1, null, 'Low', 'Planned')`,
        [planId]
      );
      await actAs(client, RECEPTIONIST_A);
      const invoiceRow47 = await client.query(
        `select * from create_invoice_from_charges(
           array[$1]::uuid[], $2, 'FIN-V-INV-004', 12000, 0, 0, 12000,
           null, 'Cash', null, false, 'VAT', 0, false, null
         )`,
        [item47.rows[0].charge_id, patientAId]
      );
      const dueDate47 = await client.query(
        `select (due_date = current_date + 30) as due_in_30 from clinic_invoices where id = $1`,
        [invoiceRow47.rows[0].id]
      );
      const priorInvoiceUnchanged47 = await client.query(
        `select due_date = current_date as still_due_today from clinic_invoices where id = $1`,
        [invoiceRow46.rows[0].id]
      );
      record(
        "47. Raising the clinic's payment terms sets the new invoice's due date 30 days out, without altering an already-created invoice's due date",
        dueDate47.rows[0]?.due_in_30 === true && priorInvoiceUnchanged47.rows[0]?.still_due_today === true,
        `due_in_30=${dueDate47.rows[0]?.due_in_30} priorUnchanged=${priorInvoiceUnchanged47.rows[0]?.still_due_today}`
      );

      // Restore the default for the rest of the suite, in case anything
      // below assumes it (harmless either way since everything rolls
      // back, but keeps this block from leaking state forward).
      await actAs(client, OWNER_A);
      await client.query(`update clinic_settings set default_payment_terms_days = 0 where clinic_id = $1`, [CLINIC_A]);
    }

    // ============================================================
    // Billing audit fix #3 - deposit + balance charges (0112)
    // ============================================================
    let depositItemId, depositChargeId, balanceChargeId;
    {
      // 48. add_treatment_deposit splits a fresh Pending charge into a
      // deposit and a balance whose amounts sum to exactly the original.
      await actAs(client, DENTIST_A);
      const item48 = await client.query(
        `select * from create_treatment_with_teeth($1, 'Implant', array[16], 50000, 1, null, 'High', 'Planned')`,
        [planId]
      );
      depositItemId = item48.rows[0].id;
      balanceChargeId = item48.rows[0].charge_id;

      const r48 = await attemptWithSavepoint(client, async () => {
        await client.query(`select * from add_treatment_deposit($1, 15000)`, [depositItemId]);
      });
      const itemAfter48 = await client.query(
        `select deposit_charge_id, charge_id from treatment_plan_items where id = $1`,
        [depositItemId]
      );
      depositChargeId = itemAfter48.rows[0]?.deposit_charge_id;
      const charges48 = await client.query(
        `select id, amount, status from clinic_charges where id = any($1::uuid[])`,
        [[depositChargeId, balanceChargeId]]
      );
      const chargeById48 = Object.fromEntries(charges48.rows.map((c) => [c.id, c]));
      record(
        "48. add_treatment_deposit splits one charge into a deposit (15000) and a balance (35000) summing to the original 50000, both Pending",
        r48.ok &&
          !!depositChargeId &&
          Number(chargeById48[depositChargeId]?.amount) === 15000 &&
          Number(chargeById48[balanceChargeId]?.amount) === 35000 &&
          chargeById48[depositChargeId]?.status === "Pending" &&
          chargeById48[balanceChargeId]?.status === "Pending",
        `depositAmount=${chargeById48[depositChargeId]?.amount} balanceAmount=${chargeById48[balanceChargeId]?.amount} error=${r48.ok ? "" : r48.error.message}`
      );

      // 49. Editing the item's price afterward re-syncs ONLY the
      // balance, never the deposit - the exact fix this phase made to
      // sync_treatment_charge_amount, proven live: raising the price by
      // 10000 (50000 -> 60000) must add that 10000 entirely to the
      // balance (35000 -> 45000), leaving the deposit untouched at 15000.
      const r49 = await attemptWithSavepoint(client, async () => {
        await client.query(
          `update treatment_plan_items set estimated_price = 60000 where id = $1`,
          [depositItemId]
        );
        await client.query(`select sync_treatment_charge_amount($1)`, [depositItemId]);
      });
      const charges49 = await client.query(
        `select id, amount from clinic_charges where id = any($1::uuid[])`,
        [[depositChargeId, balanceChargeId]]
      );
      const chargeById49 = Object.fromEntries(charges49.rows.map((c) => [c.id, c]));
      record(
        "49. Raising the treatment's price afterward re-syncs only the balance charge (35000 -> 45000), never the already-fixed deposit (stays 15000)",
        r49.ok &&
          Number(chargeById49[depositChargeId]?.amount) === 15000 &&
          Number(chargeById49[balanceChargeId]?.amount) === 45000,
        `depositAmount=${chargeById49[depositChargeId]?.amount} balanceAmount=${chargeById49[balanceChargeId]?.amount} error=${r49.ok ? "" : r49.error.message}`
      );

      // ============================================================
      // Full-app audit fix H2 (High): reducing a treatment's price below
      // an already-collected deposit must be blocked, not silently
      // floored to 0. depositItemId is currently split 15000 deposit /
      // 45000 balance (60000 total, from scenario 49) - dropping the
      // price to 10000 would require a negative balance.
      // ============================================================
      const rH2 = await attemptWithSavepoint(client, async () => {
        await client.query(
          `update treatment_plan_items set estimated_price = 10000 where id = $1`,
          [depositItemId]
        );
        await client.query(`select sync_treatment_charge_amount($1)`, [depositItemId]);
      });
      const chargesH2 = await client.query(
        `select id, amount from clinic_charges where id = any($1::uuid[])`,
        [[depositChargeId, balanceChargeId]]
      );
      const chargeByIdH2 = Object.fromEntries(chargesH2.rows.map((c) => [c.id, c]));
      record(
        "H2. Reducing a treatment's price below its already-collected deposit is rejected, and leaves both charges unchanged (not silently floored to 0)",
        !rH2.ok &&
          /less than its already-collected deposit/i.test(rH2.error?.message ?? "") &&
          Number(chargeByIdH2[depositChargeId]?.amount) === 15000 &&
          Number(chargeByIdH2[balanceChargeId]?.amount) === 45000,
        rH2.ok
          ? "unexpectedly succeeded"
          : `${rH2.error.message} (depositAmount=${chargeByIdH2[depositChargeId]?.amount} balanceAmount=${chargeByIdH2[balanceChargeId]?.amount})`
      );

      // 50. Adding a second deposit to an already-split item is
      // rejected, and a deposit greater than or equal to the current
      // balance amount is rejected too.
      const r50a = await attemptWithSavepoint(client, async () => {
        await client.query(`select * from add_treatment_deposit($1, 5000)`, [depositItemId]);
      });
      record(
        "50a. Adding a second deposit to an already-split item is rejected",
        !r50a.ok && /already on a deposit/i.test(r50a.error?.message ?? ""),
        r50a.ok ? "unexpectedly succeeded" : r50a.error.message
      );

      const item50b = await client.query(
        `select * from create_treatment_with_teeth($1, 'Small Filling', array[17], 1000, 1, null, 'Low', 'Planned')`,
        [planId]
      );
      const r50b = await attemptWithSavepoint(client, async () => {
        await client.query(`select * from add_treatment_deposit($1, 1000)`, [item50b.rows[0].id]);
      });
      record(
        "50b. A deposit equal to (or greater than) the full treatment amount is rejected",
        !r50b.ok && /must be less than the full treatment amount/i.test(r50b.error?.message ?? ""),
        r50b.ok ? "unexpectedly succeeded" : r50b.error.message
      );

      // 51. remove_treatment_deposit merges the deposit back into the
      // balance, restoring the item to a single Pending charge for the
      // full (post-edit) amount.
      const r51 = await attemptWithSavepoint(client, async () => {
        await client.query(`select * from remove_treatment_deposit($1)`, [depositItemId]);
      });
      const itemAfter51 = await client.query(
        `select deposit_charge_id, charge_id from treatment_plan_items where id = $1`,
        [depositItemId]
      );
      const mergedCharge51 = await client.query(
        `select amount, status from clinic_charges where id = $1`,
        [itemAfter51.rows[0]?.charge_id]
      );
      const depositGone51 = await client.query(
        `select count(*)::int as n from clinic_charges where id = $1`,
        [depositChargeId]
      );
      record(
        "51. remove_treatment_deposit merges the deposit back into one Pending charge for the full 60000",
        r51.ok &&
          itemAfter51.rows[0]?.deposit_charge_id === null &&
          Number(mergedCharge51.rows[0]?.amount) === 60000 &&
          mergedCharge51.rows[0]?.status === "Pending" &&
          depositGone51.rows[0]?.n === 0,
        `mergedAmount=${mergedCharge51.rows[0]?.amount} depositRowsRemaining=${depositGone51.rows[0]?.n} error=${r51.ok ? "" : r51.error.message}`
      );

      // 52. A split item's deposit and balance can be invoiced
      // independently (deposit now, balance later), each posting its own
      // balanced ledger entry - proving the deposit design reuses the
      // exact existing charge -> invoice -> ledger pipeline with no
      // second accounting engine. Split it again first (51 merged it
      // back).
      await client.query(`select * from add_treatment_deposit($1, 20000)`, [depositItemId]);
      const itemAfter52 = await client.query(
        `select deposit_charge_id, charge_id from treatment_plan_items where id = $1`,
        [depositItemId]
      );
      await actAs(client, RECEPTIONIST_A);
      const depositInvoiceRow = await client.query(
        `select * from create_invoice_from_charges(
           array[$1]::uuid[], $2, 'FIN-V-INV-005', 20000, 0, 0, 20000,
           null, 'Cash', null, false, 'VAT', 0, false, null
         )`,
        [itemAfter52.rows[0].deposit_charge_id, patientAId]
      );
      const balanceInvoiceRow = await client.query(
        `select * from create_invoice_from_charges(
           array[$1]::uuid[], $2, 'FIN-V-INV-006', 40000, 0, 0, 40000,
           null, 'Cash', null, false, 'VAT', 0, false, null
         )`,
        [itemAfter52.rows[0].charge_id, patientAId]
      );
      const bothLedgers52 = await client.query(
        `select t.reference_id, en.debit, en.credit from clinic_ledger_transactions t
         join clinic_ledger_entries en on en.transaction_id = t.id
         where t.clinic_id = $1 and t.reference_type = 'invoice' and t.reference_id = any($2::uuid[])`,
        [CLINIC_A, [depositInvoiceRow.rows[0].id, balanceInvoiceRow.rows[0].id]]
      );
      const depositLedgerOk =
        bothLedgers52.rows.filter((r) => r.reference_id === depositInvoiceRow.rows[0].id)
          .reduce((s, r) => s + Number(r.debit), 0) === 20000;
      const balanceLedgerOk =
        bothLedgers52.rows.filter((r) => r.reference_id === balanceInvoiceRow.rows[0].id)
          .reduce((s, r) => s + Number(r.debit), 0) === 40000;
      record(
        "52. The deposit and balance of a split item can be invoiced independently, each posting its own correctly-balanced ledger entry",
        depositLedgerOk && balanceLedgerOk,
        `depositLedgerOk=${depositLedgerOk} balanceLedgerOk=${balanceLedgerOk}`
      );
    }

    // ============================================================
    // Billing audit fix #5 - financial_audit_log (0113)
    // ============================================================
    {
      // 53. Creating an invoice logs exactly one 'insert' row for
      // clinic_invoices, with the real actor's role attached.
      await actAs(client, DENTIST_A);
      const item53 = await client.query(
        `select * from create_treatment_with_teeth($1, 'Audited Cleaning', array[18], 3000, 1, null, 'Low', 'Planned')`,
        [planId]
      );
      await actAs(client, RECEPTIONIST_A);
      const invoiceRow53 = await client.query(
        `select * from create_invoice_from_charges(
           array[$1]::uuid[], $2, 'FIN-V-INV-007', 3000, 0, 0, 3000,
           null, 'Cash', null, false, 'VAT', 0, false, null
         )`,
        [item53.rows[0].charge_id, patientAId]
      );
      const auditRows53 = await client.query(
        `select action, actor_role from financial_audit_log where table_name = 'clinic_invoices' and record_id = $1`,
        [invoiceRow53.rows[0].id]
      );
      record(
        "53. Creating an invoice logs exactly one audit 'insert' row for clinic_invoices, attributed to the real actor's role",
        auditRows53.rows.length === 1 &&
          auditRows53.rows[0].action === "insert" &&
          auditRows53.rows[0].actor_role === "Receptionist",
        `rows=${auditRows53.rows.length} action=${auditRows53.rows[0]?.action} actorRole=${auditRows53.rows[0]?.actor_role}`
      );

      // 54. Voiding that invoice logs an 'update' row whose before/after
      // JSON actually captures the status transition (Unpaid -> Voided) -
      // proving the log isn't just recording that SOMETHING changed, but
      // what.
      await actAs(client, OWNER_A);
      await client.query(`select * from void_invoice($1, 'audit trail check')`, [invoiceRow53.rows[0].id]);
      const auditRows54 = await client.query(
        `select before_value ->> 'status' as before_status, after_value ->> 'status' as after_status, actor_role
         from financial_audit_log
         where table_name = 'clinic_invoices' and record_id = $1 and action = 'update'
         order by created_at desc limit 1`,
        [invoiceRow53.rows[0].id]
      );
      record(
        "54. Voiding an invoice logs an audit 'update' row whose before/after correctly capture Unpaid -> Voided",
        auditRows54.rows[0]?.before_status === "Unpaid" &&
          auditRows54.rows[0]?.after_status === "Voided" &&
          auditRows54.rows[0]?.actor_role === "Owner",
        `before=${auditRows54.rows[0]?.before_status} after=${auditRows54.rows[0]?.after_status} actorRole=${auditRows54.rows[0]?.actor_role}`
      );

      // 55. Only Owner/Admin can read the audit log (real RLS, not a
      // trigger) - a Receptionist, despite having "billing" permission
      // and being the one who created this very invoice, cannot select
      // any of its audit history.
      await actAsWithRls(client, RECEPTIONIST_A);
      const auditRows55 = await client.query(
        `select id from financial_audit_log where table_name = 'clinic_invoices' and record_id = $1`,
        [invoiceRow53.rows[0].id]
      );
      await resetRole(client);
      record(
        "55. A Receptionist cannot read the financial audit log under RLS - Owner/Admin only",
        auditRows55.rows.length === 0,
        `saw=${auditRows55.rows.length}`
      );
    }

    // ============================================================
    // H16 - removing a Member's LAST branch membership in an org
    // auto-cleans-up their now-dangling organization_users row (0125)
    // ============================================================
    {
      // resetRole() (scenario 55) only resets the Postgres ROLE, not the
      // request.jwt.claims GUC actAsWithRls() also set - explicitly
      // re-establish a privileged actor before these deletes, so any
      // role-guard trigger a cascaded FK update fires (e.g. a SET NULL
      // onto some other table that references a deleted clinic_users
      // row) checks against a real Owner, not scenario 55's leftover
      // Receptionist context.
      await actAs(client, OWNER_A);

      const memberId = uuid("0000000000d1");

      await client.query(
        `insert into clinic_users (clinic_id, auth_user_id, full_name, email, role, status) values
         ($1, $3, 'Member D', 'member-d@fin42.test', 'Receptionist', 'Active'),
         ($2, $3, 'Member D', 'member-d@fin42.test', 'Receptionist', 'Active')`,
        [CLINIC_A, CLINIC_B, memberId]
      );
      await client.query(
        `insert into organization_users (organization_id, auth_user_id, role) values ($1, $2, 'Member')`,
        [ORG_ID, memberId]
      );

      await client.query(
        `delete from clinic_users where clinic_id = $1 and auth_user_id = $2`,
        [CLINIC_A, memberId]
      );
      const orgRowAfterFirstDelete = await client.query(
        `select id from organization_users where auth_user_id = $1`,
        [memberId]
      );
      record(
        "H16a. Removing one of a Member's two branch memberships does NOT touch their organization_users row while another branch membership remains",
        orgRowAfterFirstDelete.rows.length === 1,
        `remaining=${orgRowAfterFirstDelete.rows.length}`
      );

      await client.query(
        `delete from clinic_users where clinic_id = $1 and auth_user_id = $2`,
        [CLINIC_B, memberId]
      );
      const orgRowAfterLastDelete = await client.query(
        `select id from organization_users where auth_user_id = $1`,
        [memberId]
      );
      record(
        "H16b. Removing a Member's LAST branch membership in the org auto-cleans-up their now-dangling organization_users row",
        orgRowAfterLastDelete.rows.length === 0,
        `remaining=${orgRowAfterLastDelete.rows.length}`
      );

      // CEO_ID holds organization_users.role = 'CEO' and (from setup) one
      // clinic_users row in each of CLINIC_A/CLINIC_B - removing BOTH
      // (zero remaining in the org, the exact same trigger condition as
      // H16b) must still never delete their organization_users row - a
      // CEO's org membership ending is a separate, deliberate flow.
      // Deleted one branch at a time, each by that branch's OWN Owner
      // (not CEO_ID itself, and not the other branch's Owner) - a
      // cascaded FK update elsewhere (e.g. from scenario 45c's void in
      // Branch B) needs an acting role with real standing in THAT
      // branch, and deleting both of CEO_ID's rows in one statement
      // would leave them with zero clinic_users rows mid-cascade even if
      // acting as themselves.
      await actAs(client, OWNER_A);
      await client.query(
        `delete from clinic_users where auth_user_id = $1 and clinic_id = $2`,
        [CEO_ID, CLINIC_A]
      );
      await actAs(client, OWNER_B);
      await client.query(
        `delete from clinic_users where auth_user_id = $1 and clinic_id = $2`,
        [CEO_ID, CLINIC_B]
      );
      const ceoOrgRowAfter = await client.query(
        `select id from organization_users where auth_user_id = $1 and organization_id = $2`,
        [CEO_ID, ORG_ID]
      );
      record(
        "H16c. Removing a CEO's LAST branch membership in the org does NOT delete their organization_users row",
        ceoOrgRowAfter.rows.length === 1,
        `remaining=${ceoOrgRowAfter.rows.length}`
      );
    }

    // ============================================================
    // H17 - update_own_profile() lets any staff member update their OWN
    // full_name/phone regardless of the "users" permission, and nothing
    // else, on every clinic_users row they hold (0126)
    // ============================================================
    {
      const profileTestId = uuid("0000000000e1");

      await client.query(
        `insert into clinic_users (clinic_id, auth_user_id, full_name, email, phone, role, status) values
         ($1, $3, 'Old Name', 'profile-test@fin42.test', '000-0000', 'Dentist', 'Active'),
         ($2, $3, 'Old Name', 'profile-test@fin42.test', '000-0000', 'Receptionist', 'Active')`,
        [CLINIC_A, CLINIC_B, profileTestId]
      );

      await actAs(client, profileTestId);
      const updated = await client.query(
        `select * from update_own_profile('New Name', '111-2222')`
      );
      record(
        "H17a. update_own_profile updates every clinic_users row this person holds across branches, not just their currently-active one",
        updated.rows.length === 2 &&
          updated.rows.every((r) => r.full_name === "New Name" && r.phone === "111-2222"),
        `rows=${updated.rows.length} names=${updated.rows.map((r) => r.full_name).join(",")}`
      );

      const roleCheck = await client.query(
        `select role from clinic_users where auth_user_id = $1 order by role`,
        [profileTestId]
      );
      record(
        "H17b. update_own_profile never touches role - each branch keeps its own original role after the update",
        JSON.stringify(roleCheck.rows.map((r) => r.role)) === JSON.stringify(["Dentist", "Receptionist"]),
        `roles=${roleCheck.rows.map((r) => r.role).join(",")}`
      );

      const rEmptyName = await attemptWithSavepoint(client, async () => {
        await actAs(client, profileTestId);
        await client.query(`select * from update_own_profile($1, $2)`, ["   ", "999"]);
      });
      record(
        "H17c. update_own_profile rejects an empty/whitespace-only full name",
        !rEmptyName.ok && /full name cannot be empty/i.test(rEmptyName.error?.message ?? ""),
        rEmptyName.ok ? "unexpectedly succeeded" : rEmptyName.error.message
      );

      // No id parameter exists at all - confirm a DIFFERENT caller's own
      // update never leaks onto profileTestId's row.
      await actAs(client, RECEPTIONIST_A);
      await client.query(`select * from update_own_profile('Receptionist A Renamed', '333-4444')`);
      const untouchedOther = await client.query(
        `select full_name from clinic_users where auth_user_id = $1 and clinic_id = $2`,
        [profileTestId, CLINIC_A]
      );
      record(
        "H17d. update_own_profile only ever touches the caller's own row - a different caller's update never leaks onto someone else's",
        untouchedOther.rows[0]?.full_name === "New Name",
        `full_name=${untouchedOther.rows[0]?.full_name}`
      );
    }

    // ============================================================
    // Critical Safety Closure fix #1 - a Completed appointment's status/
    // date/time/dentist/treatment/duration are immutable through the
    // ordinary update path, but the FK-cascade nulling of
    // treatment_plan_item_id (and a plain notes edit) still work (0128)
    // ============================================================
    {
      await actAs(client, DENTIST_A);
      const c1Item = await client.query(
        `select * from create_treatment_with_teeth($1, 'FK Cascade Check', array[15], 5000, 1, null, 'Low', 'Planned')`,
        [planId]
      );
      const c1ItemId = c1Item.rows[0].id;

      await actAs(client, RECEPTIONIST_A);
      const apptRow = await client.query(
        `insert into appointments (clinic_id, patient_id, dentist_id, appointment_date, appointment_time, treatment, status, duration, treatment_plan_item_id)
         values ($1, $2, $3, current_date, '09:00', 'Checkup', 'Completed', 30, $4)
         returning id`,
        [CLINIC_A, patientAId, dentistAId, c1ItemId]
      );
      const apptId = apptRow.rows[0].id;

      const rC1a = await attemptWithSavepoint(client, async () => {
        await client.query(`update appointments set status = 'Scheduled' where id = $1`, [apptId]);
      });
      record(
        "CriticalFix1a. A Completed appointment's status cannot be reverted through a direct update",
        !rC1a.ok && /historical records and cannot be edited/i.test(rC1a.error?.message ?? ""),
        rC1a.ok ? "unexpectedly succeeded" : rC1a.error.message
      );

      const rC1b = await attemptWithSavepoint(client, async () => {
        await client.query(`update appointments set appointment_date = current_date + 3 where id = $1`, [apptId]);
      });
      record(
        "CriticalFix1b. A Completed appointment's date cannot be rewritten either - not just status",
        !rC1b.ok && /historical records and cannot be edited/i.test(rC1b.error?.message ?? ""),
        rC1b.ok ? "unexpectedly succeeded" : rC1b.error.message
      );

      const rC1c = await attemptWithSavepoint(client, async () => {
        await client.query(`update appointments set notes = 'Follow-up scheduled by phone' where id = $1`, [apptId]);
      });
      const notesAfter = await client.query(`select notes from appointments where id = $1`, [apptId]);
      record(
        "CriticalFix1c. A Completed appointment's notes CAN still be edited - the guard is scoped to the visit's facts, not a blanket freeze",
        rC1c.ok && notesAfter.rows[0]?.notes === "Follow-up scheduled by phone",
        rC1c.ok ? `notes=${notesAfter.rows[0]?.notes}` : rC1c.error.message
      );

      await actAs(client, DENTIST_A);
      const rC1d = await attemptWithSavepoint(client, async () => {
        await client.query(`delete from treatment_plan_items where id = $1`, [c1ItemId]);
      });
      const apptAfterCascade = await client.query(
        `select treatment_plan_item_id, status from appointments where id = $1`,
        [apptId]
      );
      record(
        "CriticalFix1d. Deleting a linked treatment_plan_item still nulls a Completed appointment's link via FK cascade - not blocked by the immutability guard",
        rC1d.ok && apptAfterCascade.rows[0]?.treatment_plan_item_id === null && apptAfterCascade.rows[0]?.status === "Completed",
        rC1d.ok
          ? `link=${apptAfterCascade.rows[0]?.treatment_plan_item_id} status=${apptAfterCascade.rows[0]?.status}`
          : rC1d.error.message
      );
    }

    // ============================================================
    // Critical Safety Closure fix #2 - un-cancelling a treatment plan
    // item restores its linked charge to Pending, symmetric with how
    // cancelling moves it to Cancelled; an already-Invoiced charge is
    // still never touched either direction (0127)
    // ============================================================
    {
      await actAs(client, DENTIST_A);
      const c2Item = await client.query(
        `select * from create_treatment_with_teeth($1, 'Uncancel Check', array[25], 7000, 1, null, 'Low', 'Planned')`,
        [planId]
      );
      const c2ItemId = c2Item.rows[0].id;
      const c2ChargeId = c2Item.rows[0].charge_id;

      await client.query(`update treatment_plan_items set status = 'Cancelled' where id = $1`, [c2ItemId]);
      const chargeAfterCancel = await client.query(`select status from clinic_charges where id = $1`, [c2ChargeId]);

      await client.query(`update treatment_plan_items set status = 'Planned' where id = $1`, [c2ItemId]);
      const chargeAfterUncancel = await client.query(`select status from clinic_charges where id = $1`, [c2ChargeId]);

      record(
        "CriticalFix2a. Un-cancelling a treatment restores its linked charge to Pending, not left permanently stuck at Cancelled",
        chargeAfterCancel.rows[0]?.status === "Cancelled" && chargeAfterUncancel.rows[0]?.status === "Pending",
        `afterCancel=${chargeAfterCancel.rows[0]?.status} afterUncancel=${chargeAfterUncancel.rows[0]?.status}`
      );

      const pendingCheck = await client.query(
        `select id from clinic_charges where id = $1 and status = 'Pending'`,
        [c2ChargeId]
      );
      record(
        "CriticalFix2b. The restored charge is genuinely selectable for invoicing again",
        pendingCheck.rows.length === 1,
        `found=${pendingCheck.rows.length}`
      );

      await actAs(client, RECEPTIONIST_A);
      await client.query(
        `select * from create_invoice_from_charges(
           array[$1]::uuid[], $2, 'FIN-CRIT2-INV', 7000, 0, 0, 7000,
           null, 'Cash', null, false, 'VAT', 0, false, null
         )`,
        [c2ChargeId, patientAId]
      );

      await actAs(client, DENTIST_A);
      const rC2c = await attemptWithSavepoint(client, async () => {
        await client.query(`update treatment_plan_items set status = 'Cancelled' where id = $1`, [c2ItemId]);
        await client.query(`update treatment_plan_items set status = 'Planned' where id = $1`, [c2ItemId]);
      });
      const chargeStillInvoiced = await client.query(`select status from clinic_charges where id = $1`, [c2ChargeId]);
      record(
        "CriticalFix2c. Cancelling/un-cancelling a treatment whose charge is already Invoiced never touches that charge - real financial history stays Invoiced",
        rC2c.ok && chargeStillInvoiced.rows[0]?.status === "Invoiced",
        rC2c.ok ? `status=${chargeStillInvoiced.rows[0]?.status}` : rC2c.error.message
      );
    }

    // ============================================================
    // Critical Safety Closure fix #4 - a voided invoice keeps its
    // original total for history, but get_invoice_consistency_exceptions
    // no longer false-positives on the resulting total/balance mismatch
    // (0129); the application-layer report fixes (outstandingBalances.ts,
    // calculateBalance) are covered by their own unit tests, since this
    // suite only exercises the database layer
    // ============================================================
    {
      await actAs(client, DENTIST_A);
      const c4Item = await client.query(
        `select * from create_treatment_with_teeth($1, 'Voided Debt Check', array[35], 6000, 1, null, 'Low', 'Planned')`,
        [planId]
      );
      const c4Charge = c4Item.rows[0].charge_id;

      await actAs(client, RECEPTIONIST_A);
      const c4Invoice = await client.query(
        `select * from create_invoice_from_charges(
           array[$1]::uuid[], $2, 'FIN-CRIT4-INV', 6000, 0, 0, 6000,
           null, 'Cash', null, false, 'VAT', 0, false, null
         )`,
        [c4Charge, patientAId]
      );
      const c4InvoiceId = c4Invoice.rows[0].id;

      await actAs(client, OWNER_A);
      await client.query(`select * from void_invoice($1, 'Critical Safety Closure fix #4 test')`, [c4InvoiceId]);

      const invoiceState = await client.query(
        `select status, total, amount_paid, balance from clinic_invoices where id = $1`,
        [c4InvoiceId]
      );
      record(
        "CriticalFix4a. A voided invoice keeps its original total for history, but amount_paid/balance are correctly zeroed - the exact stale-total shape the reporting fix accounts for",
        invoiceState.rows[0]?.status === "Voided" &&
          Number(invoiceState.rows[0]?.total) === 6000 &&
          Number(invoiceState.rows[0]?.amount_paid) === 0 &&
          Number(invoiceState.rows[0]?.balance) === 0,
        JSON.stringify(invoiceState.rows[0])
      );

      const exceptions = await client.query(
        `select issue from get_invoice_consistency_exceptions($1) where invoice_id = $2`,
        [CLINIC_A, c4InvoiceId]
      );
      record(
        "CriticalFix4b. get_invoice_consistency_exceptions no longer false-positives 'balance does not equal total minus amount_paid' on a voided invoice",
        exceptions.rows.length === 0,
        `exceptions=${JSON.stringify(exceptions.rows)}`
      );
    }

    // ============================================================
    // Critical Safety Closure fix #3 - suspending a user closes off
    // access at the two Tier 1 choke points (_caller_role, is_clinic_
    // owner_or_admin) and RLS itself, immediately, without needing a
    // fresh login (0130). A representative Tier 2 RPC is spot-checked
    // here too; the full concurrent-session proof (a genuinely separate
    // connection, suspended mid-session) lives in the dedicated
    // concurrency script, not this single-transaction suite.
    // ============================================================
    {
      const suspendTestId = uuid("0000000000f1");

      await actAs(client, OWNER_A);
      await client.query(
        `insert into clinic_users (clinic_id, auth_user_id, full_name, email, role, status) values
         ($1, $2, 'Suspend Test', 'suspend-test@fin42.test', 'Owner', 'Active')`,
        [CLINIC_A, suspendTestId]
      );

      await actAs(client, suspendTestId);
      const roleWhileActive = await client.query(`select _caller_role($1) as role`, [CLINIC_A]);
      const adminWhileActive = await client.query(`select is_clinic_owner_or_admin($1) as is_admin`, [CLINIC_A]);
      record(
        "CriticalFix3a. Before suspension, the new user's role resolves normally through both Tier 1 choke points",
        roleWhileActive.rows[0]?.role === "Owner" && adminWhileActive.rows[0]?.is_admin === true,
        `role=${roleWhileActive.rows[0]?.role} isAdmin=${adminWhileActive.rows[0]?.is_admin}`
      );

      await actAs(client, OWNER_A);
      await client.query(`update clinic_users set status = 'Suspended' where auth_user_id = $1`, [suspendTestId]);

      await actAs(client, suspendTestId);
      const roleWhileSuspended = await client.query(`select _caller_role($1) as role`, [CLINIC_A]);
      const adminWhileSuspended = await client.query(`select is_clinic_owner_or_admin($1) as is_admin`, [CLINIC_A]);
      record(
        "CriticalFix3b. Once suspended, _caller_role() returns null and is_clinic_owner_or_admin() returns false for the SAME still-valid identity, with no re-login involved",
        roleWhileSuspended.rows[0]?.role === null && adminWhileSuspended.rows[0]?.is_admin === false,
        `role=${roleWhileSuspended.rows[0]?.role} isAdmin=${adminWhileSuspended.rows[0]?.is_admin}`
      );

      await actAs(client, OWNER_A);
      const journalAccounts = await client.query(
        `select id from clinic_ledger_accounts where clinic_id = $1 and active order by type limit 2`,
        [CLINIC_A]
      );

      await actAs(client, suspendTestId);
      const rC3c = await attemptWithSavepoint(client, async () => {
        await client.query(
          `select * from create_manual_journal_entry($1, current_date, 'Suspended user test', $2, $3, 100)`,
          [CLINIC_A, journalAccounts.rows[0].id, journalAccounts.rows[1].id]
        );
      });
      record(
        "CriticalFix3c. A Tier 2 RPC (create_manual_journal_entry) rejects the same suspended identity too, not just the two Tier 1 functions",
        !rC3c.ok,
        rC3c.ok ? "unexpectedly succeeded" : rC3c.error.message
      );

      await actAsWithRls(client, suspendTestId);
      const patientsWhileSuspended = await client.query(`select id from patients where clinic_id = $1`, [CLINIC_A]);
      await resetRole(client);
      record(
        "CriticalFix3d. Under real RLS (not just actAs), a suspended user's own SELECT sees zero rows for their own clinic - the row-visibility choke point holds",
        patientsWhileSuspended.rows.length === 0,
        `saw=${patientsWhileSuspended.rows.length}`
      );

      await actAs(client, OWNER_A);
      await client.query(`update clinic_users set status = 'Active' where auth_user_id = $1`, [suspendTestId]);

      await actAs(client, suspendTestId);
      const roleAfterReactivate = await client.query(`select _caller_role($1) as role`, [CLINIC_A]);
      record(
        "CriticalFix3e. Reactivating immediately restores access for the same still-open identity - a live per-query check, not something that needed a fresh login",
        roleAfterReactivate.rows[0]?.role === "Owner",
        `role=${roleAfterReactivate.rows[0]?.role}`
      );
    }

    console.log("\nAll scenarios executed. Rolling back the entire transaction now - nothing persisted to staging.");
    await client.query("ROLLBACK");
    console.log("ROLLBACK confirmed. Staging is unchanged.");
  } catch (err) {
    console.error("\nFATAL - rolling back:", err.message);
    try {
      await client.query("ROLLBACK");
    } catch (_) {}
    throw err;
  } finally {
    await client.end();
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  if (failed.length > 0) {
    console.error(`FAILED CHECKS: ${failed.map((f) => f.name).join("; ")}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("FATAL:", e.message);
  process.exit(1);
});
