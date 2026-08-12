import { ReportDefinition, ReportFilters, ReportGenerator, ReportPeriod } from "@/types/reports";

import { generateRevenueReport } from "./revenue";
import { generateExpenseReport } from "./expense";
import { generateProfitLossReport } from "./profitLoss";
import { generatePaymentsReport } from "./payments";
import { generateOutstandingBalancesReport } from "./outstandingBalances";
import { generateMonthlyComparisonReport } from "./monthlyComparison";
import { generateInvoiceReport } from "./invoices";
import { generateInventoryValuationReport } from "./inventoryValuation";
import { generateSupplierSpendingReport } from "./supplierSpending";
import { generateTreatmentRevenueReport } from "./treatmentRevenue";
import { generateDentistRevenueReport } from "./dentistRevenue";

export const REPORT_DEFINITIONS: ReportDefinition[] = [
  {
    id: "revenue",
    name: "Revenue Report",
    category: "Financial",
    description: "Total revenue, paid invoices, and breakdowns by day, treatment, and payment method.",
    filters: ["paymentMethod"],
  },
  {
    id: "expense",
    name: "Expense Report",
    category: "Financial",
    description: "Money Out totals by category and by date, using the clinic's own expense categories.",
    filters: ["category", "paymentMethod"],
  },
  {
    id: "profit-loss",
    name: "Profit & Loss",
    category: "Financial",
    description: "Revenue minus known direct treatment costs minus operating expenses.",
    filters: [],
  },
  {
    id: "payments",
    name: "Payments Report",
    category: "Financial",
    description: "Actual recorded payment transactions and a breakdown by method.",
    filters: ["paymentMethod", "patient"],
  },
  {
    id: "outstanding-balances",
    name: "Outstanding Balances",
    category: "Financial",
    description: "Unpaid and partially paid invoices, with an aging breakdown.",
    filters: ["patient"],
  },
  {
    id: "monthly-comparison",
    name: "Monthly Comparison",
    category: "Financial",
    description: "This month vs. last month (and the same month last year) across key metrics.",
    filters: [],
  },
  {
    id: "invoices",
    name: "Invoice Report",
    category: "Operations",
    description: "All invoices in the selected period, with status and payment filters.",
    filters: ["invoiceStatus", "paymentMethod", "patient"],
  },
  {
    id: "inventory-valuation",
    name: "Inventory Valuation",
    category: "Operations",
    description: "Current stock quantity and value by item, with low-stock and expiry summaries.",
    filters: ["category"],
  },
  {
    id: "supplier-spending",
    name: "Supplier Spending",
    category: "Operations",
    description: "Actual received purchases (Goods Received Notes) by supplier.",
    filters: ["supplier"],
  },
  {
    id: "treatment-revenue",
    name: "Treatment Revenue",
    category: "Performance",
    description: "Actual paid-invoice revenue by treatment, matching Treatment Profitability's data.",
    filters: ["treatment"],
  },
  {
    id: "dentist-revenue",
    name: "Dentist Revenue",
    category: "Performance",
    description: "Patients and appointments per dentist. Revenue attribution is not available.",
    filters: ["dentist"],
  },
];

const GENERATORS: Record<string, ReportGenerator> = {
  revenue: generateRevenueReport,
  expense: generateExpenseReport,
  "profit-loss": generateProfitLossReport,
  payments: generatePaymentsReport,
  "outstanding-balances": generateOutstandingBalancesReport,
  "monthly-comparison": generateMonthlyComparisonReport,
  invoices: generateInvoiceReport,
  "inventory-valuation": generateInventoryValuationReport,
  "supplier-spending": generateSupplierSpendingReport,
  "treatment-revenue": generateTreatmentRevenueReport,
  "dentist-revenue": generateDentistRevenueReport,
};

export function getReportDefinition(id: string): ReportDefinition | undefined {
  return REPORT_DEFINITIONS.find((def) => def.id === id);
}

export async function generateReport(
  id: string,
  period: ReportPeriod,
  filters: ReportFilters
) {
  const generator = GENERATORS[id];

  if (!generator) {
    throw new Error(`Unknown report: ${id}`);
  }

  return generator(period, filters);
}
