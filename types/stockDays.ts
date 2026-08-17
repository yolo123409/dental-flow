/**
 * Stock Days / Inventory Days - a read-only composition over the
 * existing ledger reports (Balance Sheet, P&L) and the existing
 * Inventory module, not a second inventory or accounting system.
 *
 * `MetricValue.value` is null whenever a figure cannot be reliably
 * computed (a required account not configured, or a zero denominator
 * that makes the ratio mathematically undefined) - `unavailableReason`
 * explains why. A genuinely calculated zero (e.g. zero ending inventory
 * because everything was consumed) is a real value, not "unavailable".
 * Never NaN/Infinity/-Infinity.
 */
export interface MetricValue {
  value: number | null;
  unavailableReason: string | null;
}

/**
 * Opening Stock + Purchases - Consumed - Returned to Supplier (+/- any
 * other ledger activity against the Inventory account) should equal
 * Closing Stock. `other` and `discrepancy` are never hidden or forced to
 * zero - both are shown explicitly so a genuine mismatch (or an
 * unclassified transaction type touching Inventory) is visible rather
 * than silently absorbed.
 */
export interface InventoryMovementBridge {
  openingStock: number;
  /** Sum of ledger InventoryReceipt debits to the Inventory account in the period (GRN receipts). */
  purchases: number;
  /** Sum of ledger InventoryConsumption credits (Used/Damaged/Expired) in the period. */
  consumed: number;
  /** Sum of ledger InventoryReturn credits (stock returned to a supplier) in the period. */
  returnedToSupplier: number;
  /** Net effect of any other transaction type that touched the Inventory account (e.g. a Manual Journal Entry) - should normally be zero. */
  other: number;
  computedClosingStock: number;
  closingStock: number;
  discrepancy: number;
  reconciles: boolean;
}

export interface StockDaysReport {
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  /** Calendar days spanned by the period, inclusive of both ends - never a fixed 365. */
  periodDays: number;
  /** The Balance Sheet date used for Ending Inventory - the selected period's end date. */
  balanceSheetAsOf: string;

  inventoryAccountConfigured: boolean;
  suppliesUsedAccountConfigured: boolean;

  /** Ledger Inventory balance the day before the period started - byte-identical to what getBalanceSheet would show for that date. */
  beginningInventory: MetricValue;
  /** Ledger Inventory balance as of period end - byte-identical to the Balance Sheet report's own Inventory line for the same date. */
  endingInventory: MetricValue;
  averageInventory: MetricValue;
  /** Copied verbatim from getProfitAndLoss().directCosts.total (the Supplies Used account) - never recomputed. */
  costOfGoodsSold: MetricValue;

  /** COGS / Average Inventory. */
  inventoryTurnover: MetricValue;
  /** Average Inventory / COGS x Period Days - derived from the same underlying numbers as Inventory Turnover so the two can never mathematically disagree. */
  inventoryDays: MetricValue;

  /** Null only when the Inventory account isn't configured at all. */
  movement: InventoryMovementBridge | null;

  reconciliation: {
    /** Live operational stock valuation (quantity x cost_per_unit, as of now) from the Inventory module - the same calculation the Inventory dashboard itself uses. */
    liveOperationalValueNow: number;
    /** The ledger's current (now) Inventory balance, via Trial Balance - not the period-end balance above, since this comparison is always "as of now" regardless of the selected report period. */
    ledgerValueNow: number;
    difference: number;
    matches: boolean;
  };
}
