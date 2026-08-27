// FIN-4.8 — concurrent 47-branch load + race-condition testing.
//
// FIN-3/FIN-4 proved SEQUENTIAL 47-branch behavior (one operation at a
// time, however many of them). This script proves something FIN-3/FIN-4
// never touched: what happens when MULTIPLE real, independent database
// sessions hit the same rows AT THE SAME TIME. It uses a real `pg.Pool`
// (many independent connections/transactions, not one shared transaction
// with savepoints like scripts/staging/db-integration-tests.mjs) - that
// distinction matters: savepoints inside one transaction can prove
// BEHAVIOR (does this call succeed or fail) but can never prove
// CONCURRENCY SAFETY (what happens when two truly separate transactions
// overlap) - only genuinely separate connections can.
//
// SAFETY: staging only, gated by the same assertDistinctProjects check
// every other write-capable script in this repo uses. This script WRITES
// AND KEEPS its data (unlike db-integration-tests.mjs's rollback) - run
// `npm run staging:sync-schema` afterward (or before a later run) to
// reset staging to a clean slate; this is expected and fine, staging is
// disposable by design (see docs/ENVIRONMENTS.md).
//
// Run `npm run staging:apply-pending-migrations` first if a migration
// under test hasn't reached staging yet.
import pg from "pg";
import { getProdDbUrl, getRestoreTestDbUrl, getRestoreTestSupabaseUrl, assertDistinctProjects } from "../backup/lib/env.mjs";

const BRANCH_COUNT = 47;
const PATIENTS_PER_BRANCH = 80;
const APPOINTMENTS_PER_BRANCH = 44;
const INVOICES_PER_BRANCH = 34;
const EXPENSES_PER_BRANCH = 8;
const INVENTORY_ITEMS_PER_BRANCH = 4;
const INVENTORY_INITIAL_STOCK = 1000;

const results = [];
function record(name, pass, detail = "") {
  results.push({ name, pass, detail });
  console.log(`[${pass ? "PASS" : "FAIL"}] ${name}${detail ? " - " + detail : ""}`);
}

/** Session-level (not transaction-local) claim - correct for a Pool
 * connection that will run one or more standalone statements outside an
 * explicit BEGIN/COMMIT, faithfully matching how one real PostgREST/RPC
 * call behaves in production (one call = one implicit transaction). */
async function actAsSession(client, authUserId) {
  await client.query(`select set_config('request.jwt.claims', json_build_object('sub', $1::text)::text, false)`, [authUserId]);
}

function percentile(sortedMs, p) {
  if (sortedMs.length === 0) return 0;
  const idx = Math.min(sortedMs.length - 1, Math.ceil((p / 100) * sortedMs.length) - 1);
  return sortedMs[Math.max(0, idx)];
}

function summarizeLatency(label, samples) {
  if (samples.length === 0) {
    console.log(`  ${label}: no samples`);
    return { label, count: 0, p50: 0, p95: 0, max: 0, errors: 0 };
  }
  const oks = samples.filter((s) => s.ok).map((s) => s.ms).sort((a, b) => a - b);
  const errors = samples.filter((s) => !s.ok).length;
  const p50 = percentile(oks, 50);
  const p95 = percentile(oks, 95);
  const max = oks.length ? oks[oks.length - 1] : 0;
  console.log(`  ${label}: n=${samples.length} ok=${oks.length} errors=${errors} P50=${p50}ms P95=${p95}ms max=${max}ms`);
  if (errors > 0) {
    const uniqueErrors = [...new Set(samples.filter((s) => !s.ok).map((s) => s.error?.message ?? String(s.error)))];
    for (const msg of uniqueErrors.slice(0, 5)) {
      console.log(`    error sample: ${msg}`);
    }
  }
  return { label, count: samples.length, ok: oks.length, errors, p50, p95, max };
}

async function timed(fn) {
  const start = Date.now();
  try {
    await fn();
    return { ok: true, ms: Date.now() - start };
  } catch (error) {
    return { ok: false, ms: Date.now() - start, error };
  }
}

async function main() {
  const prodUrl = getProdDbUrl();
  const restoreUrl = getRestoreTestDbUrl();
  const prodSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const restoreSupabaseUrl = getRestoreTestSupabaseUrl();
  await assertDistinctProjects({ prodDbUrl: prodUrl, prodSupabaseUrl, restoreDbUrl: restoreUrl, restoreSupabaseUrl });
  console.log("Safety check passed: target is a live-verified, different Postgres cluster than production.\n");

  const setupClient = new pg.Client({ connectionString: restoreUrl, connectionTimeoutMillis: 15000, statement_timeout: 120000 });
  await setupClient.connect();
  console.log("Connected to staging (restore-test project) for bulk setup.\n");

  const orgId = (await setupClient.query(`select gen_random_uuid() as id`)).rows[0].id;

  console.log(`--- Setup: generating ${BRANCH_COUNT} branches (~${PATIENTS_PER_BRANCH * BRANCH_COUNT} patients, ~${INVOICES_PER_BRANCH * BRANCH_COUNT} invoices) ---`);
  const setupStart = Date.now();

  // Bulk-loaded rows bypass the role-guard triggers the same way
  // migration 0101's historical backfill did (DISABLE/ENABLE TRIGGER,
  // administrative bulk load - not a normal application write path).
  // Ledger-posting triggers are untouched and still fire normally, so
  // the ledger this generates is real, not fabricated separately.
  await setupClient.query(`alter table public.clinic_invoices disable trigger trg_guard_role_invoices;`);
  await setupClient.query(`alter table public.clinic_invoice_items disable trigger trg_guard_invoice_item_role;`);
  await setupClient.query(`alter table public.clinic_payments disable trigger trg_guard_role_payments;`);
  await setupClient.query(`alter table public.clinic_expenses disable trigger trg_guard_role_expenses;`);
  await setupClient.query(`alter table public.clinic_inventory_items disable trigger trg_guard_role_inventory_items;`);
  await setupClient.query(`alter table public.treatment_plans disable trigger trg_guard_treatment_plan_role;`);
  await setupClient.query(`alter table public.treatment_plan_items disable trigger trg_guard_treatment_plan_item_role;`);
  await setupClient.query(`alter table public.clinic_customer_credits disable trigger trg_guard_role_customer_credits;`);

  // No ON COMMIT DROP: each client.query() call below is its own
  // implicit transaction (no explicit BEGIN wraps this whole setup), so
  // ON COMMIT DROP would drop these at the end of THIS call, before the
  // next one ever runs. A plain temp table instead lives for the whole
  // session (this connection) - exactly what's needed until
  // setupClient.end() closes it further down.
  await setupClient.query(`
    create temporary table tmp_clinics (branch int primary key, clinic_id uuid, owner_id uuid);
    create temporary table tmp_patients (id uuid, branch int, seq int);
    create temporary table tmp_invoices (id uuid, branch int, patient_id uuid, total numeric, seq int);
    create temporary table tmp_inventory (id uuid, branch int, seq int);
    create temporary table tmp_dentists (id uuid, branch int);
  `);

  await setupClient.query(`insert into public.organizations (id, name) values ($1, 'FIN-4.8 Concurrency Test Org')`, [orgId]);

  await setupClient.query(`
    insert into tmp_clinics (branch, clinic_id, owner_id)
    select g, gen_random_uuid(), gen_random_uuid() from generate_series(1, ${BRANCH_COUNT}) g;
  `);

  await setupClient.query(`
    insert into public.clinics (id, name, organization_id, currency)
    select clinic_id, 'FIN48 Branch ' || branch, $1, 'KES' from tmp_clinics;
  `, [orgId]);

  await setupClient.query(`
    insert into public.clinic_settings (clinic_id, clinic_name, currency)
    select clinic_id, 'Branch ' || branch, 'KES' from tmp_clinics;
  `);

  await setupClient.query(`
    insert into public.clinic_users (clinic_id, auth_user_id, full_name, email, role, status)
    select clinic_id, owner_id, 'Owner ' || branch, 'owner' || branch || '@fin48conc.test', 'Owner', 'Active'
    from tmp_clinics;
  `);

  // ensure_ledger_provisioned_multi only requires *some* authenticated
  // caller (auth.uid() is not null) - it doesn't check that caller's
  // membership in the clinics being provisioned - so any real uid works
  // for this one-off administrative call.
  await actAsSession(setupClient, orgId);
  await setupClient.query(`select ensure_ledger_provisioned_multi((select array_agg(clinic_id) from tmp_clinics));`);

  await setupClient.query(`
    insert into tmp_dentists (id, branch)
    select gen_random_uuid(), branch from tmp_clinics;
    insert into public.dentists (id, clinic_id, full_name)
    select d.id, c.clinic_id, 'Dr. Branch ' || c.branch from tmp_dentists d join tmp_clinics c on c.branch = d.branch;
  `);

  await setupClient.query(`
    insert into tmp_patients (id, branch, seq)
    select gen_random_uuid(), c.branch, n
    from tmp_clinics c cross join generate_series(1, ${PATIENTS_PER_BRANCH}) n;
    insert into public.patients (id, clinic_id, first_name, last_name)
    select p.id, c.clinic_id, 'Patient', 'B' || p.branch || '-' || p.seq
    from tmp_patients p join tmp_clinics c on c.branch = p.branch;
  `);

  await setupClient.query(`
    insert into public.appointments (clinic_id, patient_id, dentist_id, appointment_date, treatment, status)
    select c.clinic_id, p.id, d.id,
      (now() - (random() * 60 || ' days')::interval),
      'Checkup', 'Completed'
    from tmp_clinics c
    join tmp_dentists d on d.branch = c.branch
    join lateral (
      select id from tmp_patients where branch = c.branch order by random() limit ${APPOINTMENTS_PER_BRANCH}
    ) p on true;
  `);

  await setupClient.query(`
    insert into tmp_inventory (id, branch, seq)
    select gen_random_uuid(), branch, n from tmp_clinics cross join generate_series(1, ${INVENTORY_ITEMS_PER_BRANCH}) n;
    insert into public.clinic_inventory_items (id, clinic_id, name, quantity, unit, cost_per_unit)
    select i.id, c.clinic_id, 'Item ' || i.seq, ${INVENTORY_INITIAL_STOCK}, 'unit', 25
    from tmp_inventory i join tmp_clinics c on c.branch = i.branch;
  `);

  // INVOICES_PER_BRANCH patients per branch get one invoice each
  // (1 item, VAT off to keep totals simple and predictable).
  await setupClient.query(`
    insert into tmp_invoices (id, branch, patient_id, total, seq)
    select gen_random_uuid(), p.branch, p.id, 1000 + (p.seq * 10), p.seq
    from tmp_patients p where p.seq <= ${INVOICES_PER_BRANCH};

    insert into public.clinic_invoices (id, clinic_id, patient_id, invoice_number, subtotal, total, amount_paid, balance, status)
    select i.id, c.clinic_id, i.patient_id, 'FIN48-' || i.branch || '-' || i.seq, i.total, i.total, 0, i.total, 'Unpaid'
    from tmp_invoices i join tmp_clinics c on c.branch = i.branch;

    insert into public.clinic_invoice_items (invoice_id, treatment_name, quantity, unit_price, total_price)
    select id, 'Concurrency Test Treatment', 1, total, total from tmp_invoices;
  `);

  // ~90% of invoiced patients get a full payment; the rest stay
  // outstanding (realistic AR mix, matching FIN-3.10's own not-fully-
  // collected balance).
  await setupClient.query(`
    with paid as (
      update public.clinic_invoices
      set amount_paid = total, balance = 0, status = 'Paid'
      where id in (select id from tmp_invoices where seq <= ${Math.round(INVOICES_PER_BRANCH * 0.9)})
      returning id, clinic_id, patient_id, total
    )
    insert into public.clinic_payments (clinic_id, invoice_id, patient_id, amount, payment_method)
    select clinic_id, id, patient_id, total, 'Cash' from paid;
  `);

  await setupClient.query(`
    insert into public.clinic_expense_categories (clinic_id, name)
    select clinic_id, 'Supplies' from tmp_clinics;
  `);
  await setupClient.query(`
    insert into public.clinic_expenses (clinic_id, category_id, amount, description, payment_method, status)
    select c.clinic_id, ec.id, 500 + (n * 5), 'Concurrency test expense ' || n, 'Cash', 'Paid'
    from tmp_clinics c
    join public.clinic_expense_categories ec on ec.clinic_id = c.clinic_id
    cross join generate_series(1, ${EXPENSES_PER_BRANCH}) n;
  `);

  const counts = await setupClient.query(`
    select
      (select count(*) from tmp_clinics)::int as branches,
      (select count(*) from public.patients p join tmp_clinics c on c.clinic_id = p.clinic_id)::int as patients,
      (select count(*) from public.appointments a join tmp_clinics c on c.clinic_id = a.clinic_id)::int as appointments,
      (select count(*) from public.clinic_invoices i join tmp_clinics c on c.clinic_id = i.clinic_id)::int as invoices,
      (select count(*) from public.clinic_payments p join tmp_clinics c on c.clinic_id = p.clinic_id)::int as payments,
      (select count(*) from public.clinic_inventory_items ii join tmp_clinics c on c.clinic_id = ii.clinic_id)::int as inventory_items,
      (select count(*) from public.clinic_expenses e join tmp_clinics c on c.clinic_id = e.clinic_id)::int as expenses,
      (select count(*) from public.clinic_ledger_transactions t join tmp_clinics c on c.clinic_id = t.clinic_id)::int as ledger_transactions
  `);
  const c = counts.rows[0];
  console.log(`Setup complete in ${Date.now() - setupStart}ms: ${c.branches} branches, ${c.patients} patients, ${c.appointments} appointments, ${c.invoices} invoices, ${c.payments} payments, ${c.inventory_items} inventory items, ${c.expenses} expenses, ${c.ledger_transactions} ledger transactions.\n`);

  // Fixtures for the named race scenarios below - fetched now, used by
  // the concurrent phase via a pool of independent connections.
  const branchRows = (await setupClient.query(`select branch, clinic_id, owner_id from tmp_clinics order by branch`)).rows;
  const raceInvoice = (await setupClient.query(`
    insert into public.clinic_invoices (clinic_id, patient_id, invoice_number, subtotal, total, amount_paid, balance, status)
    select clinic_id, (select id from tmp_patients where branch = 1 order by random() limit 1), 'FIN48-RACE-PAYMENT', 100, 100, 0, 100, 'Unpaid'
    from tmp_clinics where branch = 1
    returning id, clinic_id
  `)).rows[0];

  const raceInventoryItem = (await setupClient.query(`
    insert into public.clinic_inventory_items (clinic_id, name, quantity, unit, cost_per_unit)
    select clinic_id, 'Race Test Item', 50, 'unit', 10 from tmp_clinics where branch = 1
    returning id
  `)).rows[0];

  const raceMaterialFixture = (await setupClient.query(`
    with plan as (
      insert into public.treatment_plans (clinic_id, patient_id, title, status)
      select clinic_id, (select id from tmp_patients where branch = 1 order by random() limit 1), 'FIN48 Race Plan', 'Active'
      from tmp_clinics where branch = 1
      returning id, clinic_id
    ),
    item as (
      insert into public.treatment_plan_items (clinic_id, treatment_plan_id, procedure, estimated_price)
      select clinic_id, id, 'Race Filling', 500 from plan
      returning id, clinic_id
    ),
    stock as (
      insert into public.clinic_inventory_items (clinic_id, name, quantity, unit, cost_per_unit)
      select clinic_id, 'Race Material', 100, 'unit', 20 from item limit 1
      returning id, clinic_id
    )
    select item.id as plan_item_id, stock.id as inventory_item_id, stock.clinic_id
    from item, stock
  `)).rows[0];

  const raceGrantInvoice = (await setupClient.query(`
    insert into public.clinic_invoices (clinic_id, patient_id, invoice_number, subtotal, total, amount_paid, balance, status)
    select clinic_id, (select id from tmp_patients where branch = 1 order by random() limit 1), 'FIN48-RACE-GRANT', 100, 100, 150, -50, 'Paid'
    from tmp_clinics where branch = 1
    returning id, clinic_id
  `)).rows[0];

  const raceApplyCredit = (await setupClient.query(`
    with cred as (
      insert into public.clinic_customer_credits (clinic_id, patient_id, source_invoice_id, amount, remaining_amount, notes)
      select clinic_id, (select id from tmp_patients where branch = 1 order by random() limit 1), $1, 100, 100, 'FIN-4.8 race fixture'
      from tmp_clinics where branch = 1
      returning id, clinic_id
    )
    select id, clinic_id from cred
  `, [raceInvoice.id])).rows[0];

  // 5 small, separate outstanding invoices for the SAME patient the
  // credit belongs to, each with balance 20 - exactly enough that 5
  // concurrent applies of 20 each should ALL succeed (5*20=100=the
  // credit's full remaining_amount) with nothing left over.
  const patientForApply = (await setupClient.query(`select patient_id from clinic_customer_credits where id = $1`, [raceApplyCredit.id])).rows[0].patient_id;
  const applyTargetInvoices = (await setupClient.query(`
    insert into public.clinic_invoices (clinic_id, patient_id, invoice_number, subtotal, total, amount_paid, balance, status)
    select $1, $2, 'FIN48-RACE-APPLY-' || g, 20, 20, 0, 20, 'Unpaid'
    from generate_series(1, 5) g
    returning id
  `, [raceApplyCredit.clinic_id, patientForApply])).rows.map((r) => r.id);

  await setupClient.query(`alter table public.clinic_invoices enable trigger trg_guard_role_invoices;`);
  await setupClient.query(`alter table public.clinic_invoice_items enable trigger trg_guard_invoice_item_role;`);
  await setupClient.query(`alter table public.clinic_payments enable trigger trg_guard_role_payments;`);
  await setupClient.query(`alter table public.clinic_expenses enable trigger trg_guard_role_expenses;`);
  await setupClient.query(`alter table public.clinic_inventory_items enable trigger trg_guard_role_inventory_items;`);
  await setupClient.query(`alter table public.treatment_plans enable trigger trg_guard_treatment_plan_role;`);
  await setupClient.query(`alter table public.treatment_plan_items enable trigger trg_guard_treatment_plan_item_role;`);
  await setupClient.query(`alter table public.clinic_customer_credits enable trigger trg_guard_role_customer_credits;`);

  await setupClient.end();
  console.log("Setup connection closed. Starting concurrent phase via a real connection pool.\n");

  // NOTE: the restore-test/staging Supabase project's session pooler
  // hard-caps at 15 concurrent connections (confirmed live: exceeding
  // it raises a real "(EMAXCONNSESSION) max clients reached in session
  // mode" error from the pooler itself, not from this app) - a property
  // of this disposable testing project's tier, not of DentalFlow's own
  // code. max is kept under that ceiling so results measure real query/
  // lock behavior, not staging's own connection-count limit.
  const pool = new pg.Pool({ connectionString: restoreUrl, max: 12, connectionTimeoutMillis: 20000, statement_timeout: 30000 });

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
  // RACE 1: two (in fact five) users paying the SAME invoice at the
  // same time - the flagship fix (migration 0102). Balance is exactly
  // 100; 5 workers each request 20 - all 5 should succeed (they sum
  // exactly to 100, no lost updates), and a 6th afterward should be
  // rejected (balance now 0).
  // ============================================================
  console.log("--- Race 1: concurrent payments on the same invoice ---");
  {
    const owner = branchRows[0].owner_id;
    const attempts = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        withConn(owner, (client) =>
          client.query(`select * from record_payment($1, 20, 'Cash', null, null, null)`, [raceInvoice.id])
        )
      )
    );
    const succeeded = attempts.filter((a) => a.status === "fulfilled").length;

    const paymentSum = await pool.query(`select coalesce(sum(amount), 0)::numeric as total from clinic_payments where invoice_id = $1`, [raceInvoice.id]);
    const invoiceAfter = await pool.query(`select amount_paid, balance, status from clinic_invoices where id = $1`, [raceInvoice.id]);

    record(
      "R1a. All 5 concurrent 20-unit payments on a 100-balance invoice succeed with no lost update",
      succeeded === 5 &&
        Number(paymentSum.rows[0].total) === 100 &&
        Number(invoiceAfter.rows[0].amount_paid) === 100 &&
        Number(invoiceAfter.rows[0].balance) === 0,
      `succeeded=${succeeded}/5 sum(payments)=${paymentSum.rows[0].total} invoice=${JSON.stringify(invoiceAfter.rows[0])}`
    );

    const overpayAttempt = await withConn(owner, (client) =>
      client.query(`select * from record_payment($1, 20, 'Cash', null, null, null)`, [raceInvoice.id]).then(() => ({ ok: true })).catch((e) => ({ ok: false, error: e }))
    );
    record(
      "R1b. A 6th payment against the now-fully-paid invoice is rejected, not silently accepted",
      !overpayAttempt.ok,
      overpayAttempt.ok ? "unexpectedly succeeded" : overpayAttempt.error.message
    );
  }

  // ============================================================
  // RACE 2: two users consuming the last unit of the same inventory
  // item at the same time. Stock is 50; 5 workers each try to take 20
  // (adjust_inventory_stock) - only 2 can possibly fit (40 <= 50 < 60),
  // so exactly 2 succeed and 3 fail, and stock must never go negative.
  // ============================================================
  console.log("--- Race 2: concurrent inventory consumption of the same item ---");
  {
    const owner = branchRows[0].owner_id;
    const attempts = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        withConn(owner, (client) => client.query(`select adjust_inventory_stock($1, -20, 'Used')`, [raceInventoryItem.id]))
      )
    );
    const succeeded = attempts.filter((a) => a.status === "fulfilled").length;
    const finalStock = await pool.query(`select quantity from clinic_inventory_items where id = $1`, [raceInventoryItem.id]);
    const stock = Number(finalStock.rows[0].quantity);

    record(
      "R2. Concurrent consumption never drives inventory negative, and exactly as many requests succeed as stock allows",
      stock >= 0 && stock === 50 - succeeded * 20,
      `succeeded=${succeeded}/5 finalStock=${stock} (expected 50-${succeeded}*20=${50 - succeeded * 20})`
    );
  }

  // ============================================================
  // RACE 3: two users applying the SAME customer credit at the same
  // time (to different invoices - migration 0103's fix). remaining_amount
  // is exactly 100 across 5 target invoices of balance 20 each - all 5
  // concurrent 20-unit applies should succeed, none lost.
  // ============================================================
  console.log("--- Race 3: concurrent application of the same customer credit ---");
  {
    const owner = branchRows[0].owner_id;
    const attempts = await Promise.allSettled(
      applyTargetInvoices.map((invId) =>
        withConn(owner, (client) => client.query(`select * from apply_customer_credit($1, $2, 20)`, [raceApplyCredit.id, invId]))
      )
    );
    const succeeded = attempts.filter((a) => a.status === "fulfilled").length;
    const creditAfter = await pool.query(`select remaining_amount from clinic_customer_credits where id = $1`, [raceApplyCredit.id]);
    const invoicesAfter = await pool.query(`select balance from clinic_invoices where id = any($1::uuid[])`, [applyTargetInvoices]);
    const allPaidOff = invoicesAfter.rows.every((r) => Number(r.balance) === 0);

    record(
      "R3. All 5 concurrent 20-unit applications of the same 100-remaining credit succeed with no lost/duplicated spend",
      succeeded === 5 && Number(creditAfter.rows[0].remaining_amount) === 0 && allPaidOff,
      `succeeded=${succeeded}/5 remaining=${creditAfter.rows[0].remaining_amount} allTargetInvoicesPaid=${allPaidOff}`
    );
  }

  // ============================================================
  // RACE 4: two users granting a customer credit on the SAME overpaid
  // invoice at the same time (migration 0104's fix) - exactly 1 of 5
  // concurrent attempts should succeed.
  // ============================================================
  console.log("--- Race 4: concurrent grant_customer_credit on the same overpaid invoice ---");
  {
    const owner = branchRows[0].owner_id;
    const attempts = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        withConn(owner, (client) => client.query(`select * from grant_customer_credit($1, null, 'race test')`, [raceGrantInvoice.id]))
      )
    );
    const succeeded = attempts.filter((a) => a.status === "fulfilled").length;
    const creditRows = await pool.query(`select count(*)::int as n from clinic_customer_credits where source_invoice_id = $1`, [raceGrantInvoice.id]);

    record(
      "R4. Exactly one of 5 concurrent grant_customer_credit calls on the same invoice succeeds - no duplicate credit",
      succeeded === 1 && creditRows.rows[0].n === 1,
      `succeeded=${succeeded}/5 creditRowsForInvoice=${creditRows.rows[0].n}`
    );
  }

  // ============================================================
  // RACE 5: two users modifying the same treatment material usage
  // quantity at the same time (migration 0105's fix) - a double-submit
  // of the SAME target quantity (10 -> 5, delta -5) must not double-
  // restock inventory.
  // ============================================================
  console.log("--- Race 5: concurrent update_treatment_material_quantity on the same usage row ---");
  {
    const owner = branchRows[0].owner_id;
    const usage = await withConn(owner, (client) =>
      client.query(`select * from add_treatment_material($1, $2, 10, null)`, [raceMaterialFixture.plan_item_id, raceMaterialFixture.inventory_item_id])
    );
    const usageId = usage.rows[0].id;
    const stockBefore = await pool.query(`select quantity from clinic_inventory_items where id = $1`, [raceMaterialFixture.inventory_item_id]);

    const attempts = await Promise.allSettled(
      Array.from({ length: 2 }, () =>
        withConn(owner, (client) => client.query(`select update_treatment_material_quantity($1, 5)`, [usageId]))
      )
    );
    const succeeded = attempts.filter((a) => a.status === "fulfilled").length;
    const stockAfter = await pool.query(`select quantity from clinic_inventory_items where id = $1`, [raceMaterialFixture.inventory_item_id]);
    const restocked = Number(stockAfter.rows[0].quantity) - Number(stockBefore.rows[0].quantity);

    record(
      "R5. Two concurrent 10->5 reductions of the same material line restock inventory by 5 exactly once, never 10 (double-reversal)",
      restocked === 5,
      `succeeded=${succeeded}/2 stockBefore=${stockBefore.rows[0].quantity} stockAfter=${stockAfter.rows[0].quantity} restocked=${restocked} (expected 5)`
    );
  }

  // ============================================================
  // MIXED CONCURRENT WORKLOAD - spread across all 47 branches at once,
  // including RACE 6 (two branches posting ledger transactions
  // simultaneously) as a natural side effect of running every branch's
  // operations at the same time rather than sequentially.
  // ============================================================
  console.log("\n--- Mixed concurrent workload across all 47 branches ---");
  const latency = { invoiceCreate: [], payment: [], inventoryConsume: [], expenseCreate: [], branchSwitchAndReport: [] };

  const mixedTasks = [];
  for (const b of branchRows) {
    // Invoice creation
    mixedTasks.push(
      timed(() =>
        withConn(b.owner_id, async (client) => {
          const patient = await client.query(`select id from patients where clinic_id = $1 order by random() limit 1`, [b.clinic_id]);
          const inv = await client.query(
            `insert into clinic_invoices (clinic_id, patient_id, invoice_number, subtotal, total, amount_paid, balance, status)
             values ($1, $2, 'FIN48-MIX-' || gen_random_uuid(), 500, 500, 0, 500, 'Unpaid') returning id`,
            [b.clinic_id, patient.rows[0].id]
          );
          await client.query(
            `insert into clinic_invoice_items (invoice_id, treatment_name, quantity, unit_price, total_price) values ($1, 'Mixed Load Item', 1, 500, 500)`,
            [inv.rows[0].id]
          );
        })
      ).then((r) => latency.invoiceCreate.push(r))
    );

    // Payment against an existing outstanding invoice in this branch
    mixedTasks.push(
      timed(() =>
        withConn(b.owner_id, async (client) => {
          const inv = await client.query(
            `select id, balance from clinic_invoices where clinic_id = $1 and balance > 0 order by random() limit 1`,
            [b.clinic_id]
          );
          if (inv.rows.length === 0) return;
          const amt = Math.min(50, Number(inv.rows[0].balance));
          await client.query(`select record_payment($1, $2, 'Cash', null, null, null)`, [inv.rows[0].id, amt]);
        })
      ).then((r) => latency.payment.push(r))
    );

    // Inventory consumption
    mixedTasks.push(
      timed(() =>
        withConn(b.owner_id, async (client) => {
          const item = await client.query(`select id from clinic_inventory_items where clinic_id = $1 order by random() limit 1`, [b.clinic_id]);
          await client.query(`select adjust_inventory_stock($1, -3, 'Used')`, [item.rows[0].id]);
        })
      ).then((r) => latency.inventoryConsume.push(r))
    );

    // Expense creation
    mixedTasks.push(
      timed(() =>
        withConn(b.owner_id, async (client) => {
          const cat = await client.query(`select id from clinic_expense_categories where clinic_id = $1 limit 1`, [b.clinic_id]);
          await client.query(
            `insert into clinic_expenses (clinic_id, category_id, amount, description, payment_method, status)
             values ($1, $2, 100, 'Mixed load expense', 'Cash', 'Paid')`,
            [b.clinic_id, cat.rows[0].id]
          );
        })
      ).then((r) => latency.expenseCreate.push(r))
    );

    // Branch switch + a consolidated/branch financial report read
    mixedTasks.push(
      timed(() =>
        withConn(b.owner_id, async (client) => {
          await client.query(`select get_ledger_integrity_summary($1)`, [b.clinic_id]);
        })
      ).then((r) => latency.branchSwitchAndReport.push(r))
    );
  }

  const workloadStart = Date.now();
  await Promise.all(mixedTasks);
  const workloadMs = Date.now() - workloadStart;
  console.log(`${mixedTasks.length} concurrent operations across ${branchRows.length} branches completed in ${workloadMs}ms.\n`);

  const latencySummary = {
    invoiceCreate: summarizeLatency("Invoice creation", latency.invoiceCreate),
    payment: summarizeLatency("Payment (record_payment)", latency.payment),
    inventoryConsume: summarizeLatency("Inventory consumption", latency.inventoryConsume),
    expenseCreate: summarizeLatency("Expense creation", latency.expenseCreate),
    branchSwitchAndReport: summarizeLatency("Ledger integrity report read", latency.branchSwitchAndReport),
  };

  const totalErrors = Object.values(latency).flat().filter((s) => !s.ok).length;
  record(
    "M1. Mixed concurrent workload across all 47 branches completes with zero unexpected errors",
    totalErrors === 0,
    `${mixedTasks.length} operations, ${totalErrors} errors`
  );

  // ============================================================
  // POST-WORKLOAD INTEGRITY AUDIT
  // ============================================================
  console.log("\n--- Post-workload integrity audit (all 47 branches) ---");

  const clinicIds = branchRows.map((b) => b.clinic_id);

  const negInv = await pool.query(`select count(*)::int as n from clinic_inventory_items where clinic_id = any($1::uuid[]) and quantity < 0`, [clinicIds]);
  record("I1. No negative inventory quantities across any of the 47 branches", negInv.rows[0].n === 0, `negative_rows=${negInv.rows[0].n}`);

  const negCredit = await pool.query(`select count(*)::int as n from clinic_customer_credits where clinic_id = any($1::uuid[]) and remaining_amount < 0`, [clinicIds]);
  record("I2. No negative customer-credit remaining balances (no double-spend survived)", negCredit.rows[0].n === 0, `negative_rows=${negCredit.rows[0].n}`);

  let unbalancedTotal = 0, txWithoutEntries = 0, dupRefGroups = 0;
  for (const clinicId of clinicIds) {
    const integrity = await pool.query(`select * from get_ledger_integrity_summary($1)`, [clinicId]);
    const row = integrity.rows[0];
    unbalancedTotal += Number(row.unbalanced_transactions);
    txWithoutEntries += Number(row.transactions_without_entries);
    dupRefGroups += Number(row.duplicate_reference_groups);
  }
  record(
    "I3. Ledger integrity clean across all 47 branches after concurrent load (0 unbalanced, 0 missing entries, 0 duplicate postings)",
    unbalancedTotal === 0 && txWithoutEntries === 0 && dupRefGroups === 0,
    `unbalanced=${unbalancedTotal} withoutEntries=${txWithoutEntries} duplicateRefGroups=${dupRefGroups}`
  );

  const arCheck = await pool.query(`
    select
      sum(balance) filter (where balance > 0)::numeric as sum_positive_balance,
      count(*) filter (where balance < 0)::int as overpaid_count
    from clinic_invoices where clinic_id = any($1::uuid[])
  `, [clinicIds]);
  let arRpcTotal = 0;
  for (const clinicId of clinicIds) {
    const r = await pool.query(`select get_outstanding_invoice_balance($1) as v`, [clinicId]);
    arRpcTotal += Number(r.rows[0].v ?? 0);
  }
  const sumPositive = Number(arCheck.rows[0].sum_positive_balance ?? 0);
  record(
    "I4. AR reconciliation: get_outstanding_invoice_balance matches sum(positive invoice balances) across all 47 branches",
    Math.abs(arRpcTotal - sumPositive) < 0.01,
    `rpc_total=${arRpcTotal} sum_positive_balances=${sumPositive}`
  );

  // Cross-branch isolation spot check: branch 1's owner must see only
  // branch 1's invoices under real RLS (not merely under app-level
  // filtering) - reuses the same actAsWithRls technique
  // db-integration-tests.mjs already established.
  const isolationClient = await pool.connect();
  try {
    await isolationClient.query(`select set_config('request.jwt.claims', json_build_object('sub', $1::text, 'role', 'authenticated')::text, false)`, [branchRows[0].owner_id]);
    await isolationClient.query(`SET ROLE authenticated`);
    const seen = await isolationClient.query(`select distinct clinic_id from clinic_invoices where clinic_id = any($1::uuid[])`, [clinicIds]);
    await isolationClient.query(`RESET ROLE`);
    record(
      "I5. Branch 1's owner sees exactly branch 1's invoices under RLS after concurrent load across all 47 branches (no cross-branch leakage)",
      seen.rows.length === 1 && seen.rows[0].clinic_id === branchRows[0].clinic_id,
      `clinics_visible=${seen.rows.length}`
    );
  } finally {
    isolationClient.release();
  }

  // Live-verified account type enum on this schema: Asset, Liability,
  // Equity, Income, Expense (no separate Revenue/COGS type - COGS lines
  // are Expense-type accounts, e.g. "Cost of Goods Sold").
  const balanceSheetCheck = await pool.query(`
    select
      coalesce(sum(case when a.type = 'Asset' then en.debit - en.credit else 0 end), 0)::numeric as assets,
      coalesce(sum(case when a.type = 'Liability' then en.credit - en.debit else 0 end), 0)::numeric as liabilities,
      coalesce(sum(case when a.type = 'Equity' then en.credit - en.debit else 0 end), 0)::numeric as equity,
      coalesce(sum(case when a.type = 'Income' then en.credit - en.debit else 0 end), 0)::numeric as revenue,
      coalesce(sum(case when a.type = 'Expense' then en.debit - en.credit else 0 end), 0)::numeric as expenses
    from clinic_ledger_entries en
    join clinic_ledger_transactions t on t.id = en.transaction_id
    join clinic_ledger_accounts a on a.id = en.account_id
    where t.clinic_id = any($1::uuid[])
  `, [clinicIds]);
  const bs = balanceSheetCheck.rows[0];
  const netIncome = Number(bs.revenue) - Number(bs.expenses);
  const identityGap = Number(bs.assets) - (Number(bs.liabilities) + Number(bs.equity) + netIncome);
  record(
    "I6. Balance sheet identity holds exactly (Assets = Liabilities + Equity + Net Income) across all 47 branches after concurrent load",
    Math.abs(identityGap) < 0.01,
    `assets=${bs.assets} liabilities=${bs.liabilities} equity=${bs.equity} netIncome=${netIncome} gap=${identityGap}`
  );

  await pool.end();

  console.log("\n=== Latency summary (ms) ===");
  console.table(Object.values(latencySummary).map((s) => ({ operation: s.label, n: s.count, ok: s.ok, errors: s.errors, P50: s.p50, P95: s.p95, max: s.max })));

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed. Total workload wall time: ${workloadMs}ms for ${mixedTasks.length} concurrent operations across ${branchRows.length} branches.`);
  if (failed.length > 0) {
    console.error(`FAILED CHECKS: ${failed.map((f) => f.name).join("; ")}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
