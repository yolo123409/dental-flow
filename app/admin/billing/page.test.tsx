import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// This page reads from several services with real supabase-js imports at
// module scope; mocked directly below so the real network layer is never
// touched. PermissionGuard/PaymentMethodField are mocked to keep this test
// focused on the Phase F/G/I duplicate-billing-risk warning and
// legacy/canonical labeling, not auth/insurance plumbing unrelated to it.
vi.mock("@/components/auth/PermissionGuard", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/billing/PaymentMethodField", () => ({
  default: () => null,
}));

// InvoicePreviewModal (Phase I) is always mounted (it self-hides via
// `open`), and calls useRouter() unconditionally before that check - so
// this needs a router stub even though no test here actually opens it.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

const getCharges = vi.fn();
const getInvoiceBalanceTotals = vi.fn();
const getOutstandingInvoiceBalance = vi.fn();
const getTreatmentsForTooth = vi.fn();

vi.mock("@/services/billing", () => ({
  calculateInvoiceTotals: () => ({ subtotal: 0, tax: 0, total: 0 }),
  createInvoice: vi.fn(),
  recordPayment: vi.fn(),
  getChargeById: vi.fn(),
  getCharges: (...args: unknown[]) => getCharges(...args),
  getInvoiceBalanceTotals: () => getInvoiceBalanceTotals(),
  getOutstandingInvoiceBalance: () => getOutstandingInvoiceBalance(),
}));

vi.mock("@/services/treatmentTeeth", () => ({
  getTreatmentsForTooth: (...args: unknown[]) =>
    getTreatmentsForTooth(...args),
}));

// RecordPaymentModal (Phase J), reused by both ChargeDetailModal and this
// page directly, imports getClinicInsuranceProviders - mocked so its
// real supabase-js module-scope client is never constructed here.
vi.mock("@/services/insurance", () => ({
  getClinicInsuranceProviders: () => Promise.resolve([]),
}));

vi.mock("@/services/settings", () => ({
  getClinicSettings: () =>
    Promise.resolve({ currency: "KES", tax_enabled: false, tax_rate: 0 }),
}));

import BillingPage from "./page";

function makeCharge(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "charge-1",
    clinic_id: "clinic-1",
    patient_id: "patient-1",
    tooth_number: 16,
    treatment_name: "Root Canal",
    amount: 20000,
    status: "Pending",
    invoice_id: null,
    treatment_plan_item_id: null,
    created_at: "2026-01-01T00:00:00.000Z",
    patients: { id: "patient-1", first_name: "Test", last_name: "Patient" },
    clinic_invoices: null,
    treatment_plan_items: null,
    ...overrides,
  };
}

function makeTreatmentItem(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "item-1",
    clinic_id: "clinic-1",
    treatment_plan_id: "plan-1",
    procedure: "Root Canal",
    tooth_number: 16,
    estimated_price: 20000,
    quantity: 1,
    notes: null,
    priority: "Medium",
    status: "Planned",
    sort_order: 0,
    charge_id: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function mockCharges(rows: ReturnType<typeof makeCharge>[]) {
  getCharges.mockResolvedValue({ rows, count: rows.length });
}

describe("Billing page - legacy/canonical distinction + duplicate-billing warning (Phase G/I)", () => {
  beforeEach(() => {
    getCharges.mockReset();
    getInvoiceBalanceTotals.mockReset();
    getInvoiceBalanceTotals.mockResolvedValue({
      total: 0,
      paid: 0,
      outstanding: 0,
    });
    getOutstandingInvoiceBalance.mockReset();
    getOutstandingInvoiceBalance.mockResolvedValue(0);
    getTreatmentsForTooth.mockReset();
  });

  it("shows no warning for a legacy charge with no matching active Treatment", async () => {
    mockCharges([makeCharge()]);
    getTreatmentsForTooth.mockResolvedValue([]);

    render(<BillingPage />);

    expect(await screen.findByText("Root Canal")).toBeInTheDocument();
    await waitFor(() => expect(getTreatmentsForTooth).toHaveBeenCalledWith("patient-1", 16));

    expect(
      screen.queryByText(/check this isn't a duplicate/i)
    ).not.toBeInTheDocument();
  });

  it("warns when a legacy charge's treatment NAME matches an active canonical Treatment on the same tooth", async () => {
    mockCharges([makeCharge()]);
    getTreatmentsForTooth.mockResolvedValue([makeTreatmentItem()]);

    render(<BillingPage />);

    expect(
      await screen.findByText(
        /same treatment as an existing Treatment Plan entry: "Root Canal" \(Tooth 16\)/i
      )
    ).toBeInTheDocument();
  });

  it("does NOT warn when an active Treatment exists on the same tooth but with a different name (Phase G section 12)", async () => {
    // Root Canal (legacy) + Crown (canonical) on the same tooth are
    // legitimately different Treatments, not a duplicate.
    mockCharges([makeCharge({ treatment_name: "Root Canal" })]);
    getTreatmentsForTooth.mockResolvedValue([
      makeTreatmentItem({ procedure: "Crown" }),
    ]);

    render(<BillingPage />);

    expect(await screen.findByText("Root Canal")).toBeInTheDocument();
    await waitFor(() => expect(getTreatmentsForTooth).toHaveBeenCalled());

    expect(
      screen.queryByText(/check this isn't a duplicate/i)
    ).not.toBeInTheDocument();
  });

  it("does not warn when the tooth's only name-matching Treatment is Cancelled", async () => {
    mockCharges([makeCharge()]);
    getTreatmentsForTooth.mockResolvedValue([
      makeTreatmentItem({ status: "Cancelled" }),
    ]);

    render(<BillingPage />);

    expect(await screen.findByText("Root Canal")).toBeInTheDocument();
    await waitFor(() => expect(getTreatmentsForTooth).toHaveBeenCalled());

    expect(
      screen.queryByText(/check this isn't a duplicate/i)
    ).not.toBeInTheDocument();
  });

  it("never looks up a tooth-less charge (avoids a pointless/invalid lookup)", async () => {
    mockCharges([makeCharge({ id: "charge-2", tooth_number: null })]);

    render(<BillingPage />);

    await screen.findByText("Root Canal");

    expect(getTreatmentsForTooth).not.toHaveBeenCalled();
  });

  it("never looks up or warns for a CANONICAL charge - it already knows its own Treatment", async () => {
    mockCharges([makeCharge({ treatment_plan_item_id: "item-1" })]);

    render(<BillingPage />);

    await screen.findByText("Root Canal");

    expect(getTreatmentsForTooth).not.toHaveBeenCalled();
    expect(
      screen.queryByText(/check this isn't a duplicate/i)
    ).not.toBeInTheDocument();
  });

  it("labels a canonical charge 'Treatment Plan' and a legacy charge 'Legacy Tooth Charge'", async () => {
    mockCharges([
      makeCharge({ id: "charge-canonical", treatment_plan_item_id: "item-1" }),
      makeCharge({ id: "charge-legacy", treatment_plan_item_id: null }),
    ]);
    getTreatmentsForTooth.mockResolvedValue([]);

    render(<BillingPage />);

    expect(await screen.findByText("Treatment Plan")).toBeInTheDocument();
    expect(screen.getByText("Legacy Tooth Charge")).toBeInTheDocument();
  });
});

describe("Billing page - summary cards (Phase I section 3/28)", () => {
  beforeEach(() => {
    getCharges.mockReset();
    getInvoiceBalanceTotals.mockReset();
    getOutstandingInvoiceBalance.mockReset();
    getOutstandingInvoiceBalance.mockResolvedValue(0);
    getTreatmentsForTooth.mockReset();
    getTreatmentsForTooth.mockResolvedValue([]);
  });

  it("shows Ready to Invoice as the sum of Pending charges, Invoiced/Paid from the invoice-balance totals, and Outstanding from the canonical (floor-at-zero) balance", async () => {
    mockCharges([
      makeCharge({ id: "c1", amount: 20000 }),
      makeCharge({ id: "c2", amount: 5000, tooth_number: 17 }),
    ]);
    getInvoiceBalanceTotals.mockResolvedValue({
      total: 100000,
      paid: 40000,
      outstanding: 60000,
    });
    // Phase O: Outstanding now comes from getOutstandingInvoiceBalance(),
    // not getInvoiceBalanceTotals().outstanding - deliberately given a
    // DIFFERENT value here (61000 vs the totals' 60000) so this test
    // fails loudly if the page ever regresses to reading the wrong source.
    getOutstandingInvoiceBalance.mockResolvedValue(61000);

    render(<BillingPage />);

    await screen.findAllByText("Root Canal");

    expect(screen.getByText(/KES\s*25,000/)).toBeInTheDocument();
    expect(screen.getByText(/KES\s*100,000/)).toBeInTheDocument();
    expect(screen.getByText(/KES\s*40,000/)).toBeInTheDocument();
    expect(screen.getByText(/KES\s*61,000/)).toBeInTheDocument();
  });
});

describe("Billing page - quick filters (Phase I section 18)", () => {
  beforeEach(() => {
    getCharges.mockReset();
    getInvoiceBalanceTotals.mockReset();
    getInvoiceBalanceTotals.mockResolvedValue({
      total: 0,
      paid: 0,
      outstanding: 0,
    });
    getOutstandingInvoiceBalance.mockReset();
    getOutstandingInvoiceBalance.mockResolvedValue(0);
    getTreatmentsForTooth.mockReset();
    getTreatmentsForTooth.mockResolvedValue([]);
  });

  it("switches to the paginated browse table when a non-Pending filter is selected", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");

    mockCharges([makeCharge()]);

    render(<BillingPage />);

    await screen.findByText("Root Canal");

    getCharges.mockClear();
    getCharges.mockResolvedValue({
      rows: [makeCharge({ status: "Invoiced" })],
      count: 1,
    });

    await userEvent.click(screen.getByRole("button", { name: "Invoiced" }));

    await waitFor(() =>
      expect(getCharges).toHaveBeenCalledWith(
        1,
        50,
        expect.objectContaining({ status: "Invoiced" })
      )
    );
  });
});
