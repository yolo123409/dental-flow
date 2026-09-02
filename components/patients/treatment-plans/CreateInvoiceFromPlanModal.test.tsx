import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// CreateInvoiceFromPlanModal reads isItemInvoiced()/getItemTeeth() from
// services/treatmentPlans.ts, which does `import { supabase } from
// "@/lib/supabase"` at module scope - constructing a real supabase-js
// client and throwing without NEXT_PUBLIC_SUPABASE_URL/ANON_KEY, not set in
// this test environment. Same workaround as TreatmentItemModal.test.tsx.
// Deliberately NOT mocking "@/services/treatmentPlans" itself - these
// tests exist specifically to exercise the REAL isItemInvoiced()/
// billableItems filtering logic, since a stale version of that filter
// (`!item.charge_id`) previously made this modal always report "already
// invoiced" for a normal treatment plan.
vi.mock("@/lib/supabase", () => ({ supabase: {} }));

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/services/billing", () => ({
  calculateInvoiceTotals: () => ({ subtotal: 0, tax: 0, total: 0 }),
}));

vi.mock("@/services/settings", () => ({
  getClinicSettings: () =>
    Promise.resolve({ currency: "KES", tax_enabled: false, tax_rate: 0 }),
}));

// Keeps this test focused on billableItems/scope logic, not the payment
// method picker's own insurance-provider/permissions plumbing.
vi.mock("@/components/billing/PaymentMethodField", () => ({
  default: () => null,
}));

import CreateInvoiceFromPlanModal from "./CreateInvoiceFromPlanModal";
import {
  TreatmentPlanItem,
  TreatmentPlanWithItems,
} from "@/types/treatmentPlan";

function makeItem(
  overrides: Partial<TreatmentPlanItem> = {}
): TreatmentPlanItem {
  return {
    id: "item-1",
    clinic_id: "clinic-1",
    treatment_plan_id: "plan-1",
    procedure: "Composite Restoration",
    tooth_number: 16,
    estimated_price: 5000,
    quantity: 1,
    notes: null,
    priority: "Medium",
    status: "Planned",
    sort_order: 0,
    charge_id: null,
    deposit_charge_id: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makePlan(
  items: TreatmentPlanItem[]
): TreatmentPlanWithItems {
  return {
    id: "plan-1",
    clinic_id: "clinic-1",
    patient_id: "patient-1",
    created_by: null,
    title: "Root Canal Plan",
    notes: null,
    status: "Planned",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    treatment_plan_items: items,
  };
}

describe("CreateInvoiceFromPlanModal - billable-items filtering", () => {
  // Regression test for the Phase H gap: every billable Treatment gets a
  // charge_id immediately on creation (auto-staged, still Pending) - the
  // modal must treat that as billable, not as "already invoiced".
  it("treats an item with a Pending auto-created charge as billable", () => {
    const plan = makePlan([
      makeItem({
        id: "item-1",
        charge_id: "charge-1",
        clinic_charges: { status: "Pending", amount: 5000 },
      }),
    ]);

    render(
      <CreateInvoiceFromPlanModal
        open
        plan={plan}
        currency="KES"
        onClose={vi.fn()}
        onInvoiced={vi.fn()}
      />
    );

    expect(
      screen.queryByText(/already been invoiced/i)
    ).not.toBeInTheDocument();

    expect(
      screen.getByRole("radio", { name: /entire plan/i })
    ).toBeInTheDocument();

    expect(
      screen.getByRole("button", { name: "Create Invoice" })
    ).not.toBeDisabled();
  });

  it("excludes an item whose charge has actually been invoiced", () => {
    const plan = makePlan([
      makeItem({
        id: "item-1",
        charge_id: "charge-1",
        clinic_charges: { status: "Invoiced", amount: 5000 },
      }),
    ]);

    render(
      <CreateInvoiceFromPlanModal
        open
        plan={plan}
        currency="KES"
        onClose={vi.fn()}
        onInvoiced={vi.fn()}
      />
    );

    expect(
      screen.getByText(/every treatment in this plan has already been invoiced/i)
    ).toBeInTheDocument();

    expect(
      screen.getByRole("button", { name: "Create Invoice" })
    ).toBeDisabled();
  });

  it("defaults to billing only completed items when an unbilled completed item exists", () => {
    const plan = makePlan([
      makeItem({
        id: "item-1",
        status: "Completed",
        charge_id: "charge-1",
        clinic_charges: { status: "Pending", amount: 5000 },
      }),
      makeItem({
        id: "item-2",
        status: "Planned",
        charge_id: "charge-2",
        clinic_charges: { status: "Pending", amount: 5000 },
      }),
    ]);

    render(
      <CreateInvoiceFromPlanModal
        open
        plan={plan}
        currency="KES"
        onClose={vi.fn()}
        onInvoiced={vi.fn()}
      />
    );

    const completedRadio = screen.getByRole("radio", {
      name: /only completed items/i,
    }) as HTMLInputElement;

    expect(completedRadio.checked).toBe(true);
  });

  it("defaults to the entire plan when nothing is completed yet", () => {
    const plan = makePlan([
      makeItem({
        id: "item-1",
        status: "Planned",
        charge_id: "charge-1",
        clinic_charges: { status: "Pending", amount: 5000 },
      }),
    ]);

    render(
      <CreateInvoiceFromPlanModal
        open
        plan={plan}
        currency="KES"
        onClose={vi.fn()}
        onInvoiced={vi.fn()}
      />
    );

    const entireRadio = screen.getByRole("radio", {
      name: /entire plan/i,
    }) as HTMLInputElement;

    expect(entireRadio.checked).toBe(true);
  });
});
