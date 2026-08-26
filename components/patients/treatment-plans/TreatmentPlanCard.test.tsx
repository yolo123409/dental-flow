import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// TreatmentPlanCard only uses the pure calculatePlanTotals() export from
// services/treatmentPlans.ts, but that file also does `import { supabase }
// from "@/lib/supabase"` at module scope, which constructs a real
// supabase-js client and throws without NEXT_PUBLIC_SUPABASE_URL/ANON_KEY
// - not set in this test environment. Stubbing the client (never actually
// called by calculatePlanTotals) is the same workaround already used in
// services/treatmentTeeth.test.ts.
vi.mock("@/lib/supabase", () => ({ supabase: {} }));

import TreatmentPlanCard from "./TreatmentPlanCard";
import { TreatmentPlanItem, TreatmentPlanWithItems } from "@/types/treatmentPlan";

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
    title: "Full Mouth Rehabilitation",
    notes: null,
    status: "Planned",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    treatment_plan_items: items,
  };
}

describe("TreatmentPlanCard", () => {
  it("shows the treatment count using Treatment wording, not Procedure", () => {
    render(
      <TreatmentPlanCard
        plan={makePlan([makeItem(), makeItem({ id: "item-2" })])}
        currency="KES"
        onClick={vi.fn()}
      />
    );

    expect(screen.getByText(/2 treatments/)).toBeInTheDocument();
    expect(screen.queryByText(/procedure/i)).not.toBeInTheDocument();
  });

  it("uses singular wording for exactly one treatment", () => {
    render(
      <TreatmentPlanCard
        plan={makePlan([makeItem()])}
        currency="KES"
        onClick={vi.fn()}
      />
    );

    expect(screen.getByText(/1 treatment(?!s)/)).toBeInTheDocument();
  });

  it("formats the total estimated cost across active items", () => {
    render(
      <TreatmentPlanCard
        plan={makePlan([
          makeItem({ estimated_price: 5000, quantity: 1 }),
          makeItem({ id: "item-2", estimated_price: 25000, quantity: 1 }),
        ])}
        currency="KES"
        onClick={vi.fn()}
      />
    );

    expect(screen.getByText(/KES\s*30,000/)).toBeInTheDocument();
  });

  it("excludes cancelled items from the total", () => {
    render(
      <TreatmentPlanCard
        plan={makePlan([
          makeItem({ estimated_price: 5000, quantity: 1 }),
          makeItem({
            id: "item-2",
            estimated_price: 25000,
            quantity: 1,
            status: "Cancelled",
          }),
        ])}
        currency="KES"
        onClick={vi.fn()}
      />
    );

    expect(screen.getByText(/KES\s*5,000/)).toBeInTheDocument();
  });

  it("fires onClick when the card is activated", () => {
    const onClick = vi.fn();

    render(
      <TreatmentPlanCard
        plan={makePlan([makeItem()])}
        currency="KES"
        onClick={onClick}
      />
    );

    fireEvent.click(screen.getByRole("button"));

    expect(onClick).toHaveBeenCalledOnce();
  });
});
