import { getAllLedgerTransactions, getBalanceSheet, getLedgerSettings, getProfitAndLoss, getTrialBalance } from "./ledger";
import { getInventoryItems } from "./inventory";
import { assertPermission } from "./authorization";
import { localDateString } from "@/lib/dateUtils";

import { InventoryMovementBridge, MetricValue, StockDaysReport } from "@/types/stockDays";
import { BalanceSheetPeriod } from "@/types/ledger";

const DAY_MS = 24 * 60 * 60 * 1000;

function metric(value: number): MetricValue {
  return { value, unavailableReason: null };
}

function unavailable(reason: string): MetricValue {
  return { value: null, unavailableReason: reason };
}

function toMidnight(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * Whole calendar days spanned by the period, inclusive of both ends -
 * same convention as Financial Ratios' AR/AP Days (never a fixed
 * 365-day multiplier; a "This Month"/"This Year" range that ends "now",
 * partway through today, still counts today as a full day).
 */
function periodDayCount(start: Date, end: Date): number {
  const days = Math.round((toMidnight(end).getTime() - toMidnight(start).getTime()) / DAY_MS) + 1;
  return Math.max(days, 1);
}

/**
 * getBalanceSheet()'s sections omit zero-amount lines entirely (see
 * toBalanceSheetSection in services/ledger.ts), so "not found" and
 * "found with a zero balance" are the same case here - both correctly
 * resolve to 0, a real calculated balance, not a missing one.
 */
function findInventoryAmount(bs: BalanceSheetPeriod, inventoryId: string): number {
  const line =
    bs.currentAssets.lines.find((l) => l.accountId === inventoryId) ??
    bs.nonCurrentAssets.lines.find((l) => l.accountId === inventoryId);
  return line?.amount ?? 0;
}

const NO_SUPPLIES_USED_REASON =
  "Not available — no Supplies Used account configured, so inventory consumption cannot be reliably determined";

/**
 * Stock Days / Inventory Days - entirely a read-only composition over
 * already-existing reports and the existing Inventory module:
 *
 *  - Beginning/Ending Inventory come from getBalanceSheet() (the day
 *    before the period started, and the period end) - byte-identical to
 *    what the Balance Sheet report itself would show for those dates,
 *    since it's the same function.
 *  - Cost of Goods Sold is getProfitAndLoss().directCosts.total - the
 *    clinic's own "Supplies Used" account, the same figure the P&L
 *    report already labels as Direct Costs. Never revenue, never total
 *    purchases, never all operating expenses.
 *  - The inventory movement bridge (Purchases/Consumed/Returned) is
 *    built from getLedgerTransactions() against the Inventory account -
 *    the same function Cash Flow already uses - classified by the
 *    ledger's own transaction_type (InventoryReceipt/
 *    InventoryConsumption/InventoryReturn), not a name heuristic.
 *  - The reconciliation section compares the ledger's current Inventory
 *    balance (via getTrialBalance(), already used elsewhere for this
 *    exact purpose) against the Inventory module's own live stock
 *    valuation (quantity x cost_per_unit, the same calculation the
 *    Inventory dashboard page itself uses) - both "as of now", so the
 *    comparison is honest regardless of which report period is selected.
 *
 * Inventory Turnover and Inventory Days are derived from the same raw
 * (unguarded) division so they can never mathematically disagree - see
 * the comment at `rawTurnover` below.
 */
export async function getStockDaysReport(
  start: Date,
  end: Date,
  periodLabel: string
): Promise<StockDaysReport> {
  await assertPermission("ledger");

  const startIso = localDateString(start);
  const endIso = localDateString(end);
  const dayBeforeStart = new Date(start.getTime() - DAY_MS);
  const days = periodDayCount(start, end);

  const [settings, bsEnd, bsBeginning, profitAndLoss, trialBalance, inventoryItems] = await Promise.all([
    getLedgerSettings(),
    getBalanceSheet(end),
    getBalanceSheet(dayBeforeStart),
    getProfitAndLoss(start, end),
    getTrialBalance(),
    getInventoryItems(),
  ]);

  const inventoryId = settings.inventory_account_id;
  const suppliesUsedId = settings.supplies_used_account_id;

  const liveOperationalValueNow = inventoryItems.reduce(
    (sum, item) => sum + Number(item.quantity) * Number(item.cost_per_unit),
    0
  );
  const ledgerValueNow = inventoryId
    ? (trialBalance.rows.find((row) => row.accountId === inventoryId)?.debitBalance ?? 0)
    : 0;
  const reconciliationDifference = liveOperationalValueNow - ledgerValueNow;

  const reconciliation = {
    liveOperationalValueNow,
    ledgerValueNow,
    difference: reconciliationDifference,
    matches: Math.abs(reconciliationDifference) < 0.01,
  };

  const costOfGoodsSoldValue = profitAndLoss.directCosts.total;
  const costOfGoodsSold = suppliesUsedId ? metric(costOfGoodsSoldValue) : unavailable(NO_SUPPLIES_USED_REASON);

  if (!inventoryId) {
    const na = unavailable("Not available — no Inventory account configured in this clinic's Chart of Accounts");

    return {
      periodLabel,
      periodStart: startIso,
      periodEnd: endIso,
      periodDays: days,
      balanceSheetAsOf: bsEnd.asOf,

      inventoryAccountConfigured: false,
      suppliesUsedAccountConfigured: !!suppliesUsedId,

      beginningInventory: na,
      endingInventory: na,
      averageInventory: na,
      costOfGoodsSold,

      inventoryTurnover: na,
      inventoryDays: na,

      movement: null,

      reconciliation,
    };
  }

  const beginningInventoryValue = findInventoryAmount(bsBeginning, inventoryId);
  const endingInventoryValue = findInventoryAmount(bsEnd, inventoryId);
  const averageInventoryValue = (beginningInventoryValue + endingInventoryValue) / 2;

  const beginningInventory = metric(beginningInventoryValue);
  const endingInventory = metric(endingInventoryValue);
  const averageInventory = metric(averageInventoryValue);

  // Raw (unguarded) turnover feeds both Inventory Turnover and Inventory
  // Days below, so the two can never independently drift apart.
  // COGS/0 correctly evaluates to Infinity (IEEE754) when COGS > 0, and
  // days/Infinity correctly evaluates to exactly 0 - the well-defined
  // "zero average inventory, real consumption happening" case the spec
  // calls out - without Infinity ever being returned to the UI, since
  // each field below is independently guarded before being returned.
  const rawTurnover = suppliesUsedId ? costOfGoodsSoldValue / averageInventoryValue : NaN;

  const inventoryTurnover: MetricValue = !suppliesUsedId
    ? unavailable(NO_SUPPLIES_USED_REASON)
    : averageInventoryValue === 0
      ? unavailable("Not available — no inventory balance recorded for this period")
      : metric(rawTurnover);

  const inventoryDays: MetricValue = !suppliesUsedId
    ? unavailable(NO_SUPPLIES_USED_REASON)
    : costOfGoodsSoldValue === 0
      ? unavailable("Not available — no inventory consumption/cost of goods sold was recorded during this period")
      : metric(days / rawTurnover);

  const inventoryTxns = await getAllLedgerTransactions({
    accountId: inventoryId,
    startDate: startIso,
    endDate: endIso,
  });

  let purchases = 0;
  let consumed = 0;
  let returnedToSupplier = 0;
  let otherNet = 0;

  for (const txn of inventoryTxns) {
    const entries = (txn.clinic_ledger_entries ?? []).filter((e) => e.account_id === inventoryId);
    const debit = entries.reduce((sum, e) => sum + Number(e.debit), 0);
    const credit = entries.reduce((sum, e) => sum + Number(e.credit), 0);

    if (txn.transaction_type === "InventoryReceipt") purchases += debit;
    else if (txn.transaction_type === "InventoryConsumption") consumed += credit;
    else if (txn.transaction_type === "InventoryReturn") returnedToSupplier += credit;
    else otherNet += debit - credit;
  }

  const computedClosingStock = beginningInventoryValue + purchases - consumed - returnedToSupplier + otherNet;
  const discrepancy = endingInventoryValue - computedClosingStock;

  const movement: InventoryMovementBridge = {
    openingStock: beginningInventoryValue,
    purchases,
    consumed,
    returnedToSupplier,
    other: otherNet,
    computedClosingStock,
    closingStock: endingInventoryValue,
    discrepancy,
    reconciles: Math.abs(discrepancy) < 0.01,
  };

  return {
    periodLabel,
    periodStart: startIso,
    periodEnd: endIso,
    periodDays: days,
    balanceSheetAsOf: bsEnd.asOf,

    inventoryAccountConfigured: true,
    suppliesUsedAccountConfigured: !!suppliesUsedId,

    beginningInventory,
    endingInventory,
    averageInventory,
    costOfGoodsSold,

    inventoryTurnover,
    inventoryDays,

    movement,

    reconciliation,
  };
}
