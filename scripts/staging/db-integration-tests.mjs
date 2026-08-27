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
    // 6. Payment reversal (proper mechanism works; direct edit doesn't)
    // ============================================================
    {
      await actAs(client, OWNER_A);
      const r1 = await attemptWithSavepoint(client, async () => {
        await client.query(`select reverse_ledger_transaction($1, $2, 'FIN-4.2 test reversal')`, [CLINIC_A, paymentTransactionId]);
      });
      record("6a. reverse_ledger_transaction() successfully reverses the payment posting", r1.ok, r1.ok ? "" : r1.error.message);

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
