import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// TreatmentItemRow reads getItemTeeth() from services/treatmentPlans.ts
// (Phase C), which also does `import { supabase } from "@/lib/supabase"`
// at module scope - constructing a real supabase-js client and throwing
// without NEXT_PUBLIC_SUPABASE_URL/ANON_KEY, not set in this test
// environment. Same workaround as TreatmentPlanCard.test.tsx /
// services/treatmentTeeth.test.ts.
vi.mock("@/lib/supabase", () => ({ supabase: {} }));

import TreatmentItemRow from "./TreatmentItemRow";
import { TreatmentPlanItem } from "@/types/treatmentPlan";

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

function renderRow(overrides: Partial<TreatmentPlanItem> = {}) {
  return render(
    <TreatmentItemRow
      item={makeItem(overrides)}
      currency="KES"
      isFirst={false}
      isLast={false}
      onEdit={vi.fn()}
      onDelete={vi.fn()}
      onMoveUp={vi.fn()}
      onMoveDown={vi.fn()}
      onViewOnChart={vi.fn()}
    />
  );
}

describe("TreatmentItemRow", () => {
  it("renders the treatment's name, tooth and cost", () => {
    renderRow({ estimated_price: 5000, quantity: 1 });

    expect(screen.getByText("Composite Restoration")).toBeInTheDocument();
    expect(screen.getByText(/Tooth 16/)).toBeInTheDocument();
    // A quantity of 1 shows just the total - no redundant "1 x price".
    expect(screen.getByText(/KES\s*5,000/)).toBeInTheDocument();
  });

  it("shows the per-unit price breakdown for a quantity above 1 (Phase E section 28)", () => {
    renderRow({ estimated_price: 5000, quantity: 3 });

    expect(screen.getByText(/KES\s*5,000\s*×\s*3\s*=\s*KES\s*15,000/)).toBeInTheDocument();
  });

  it("never renders the word Procedure anywhere in the dentist-facing row", () => {
    renderRow({ charge_id: "charge-1" });

    expect(screen.queryByText(/procedure/i)).not.toBeInTheDocument();
  });

  it("uses Treatment wording for the edit/delete controls", () => {
    renderRow();

    expect(
      screen.getByRole("button", { name: "Edit treatment" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Delete treatment" })
    ).toBeInTheDocument();
  });

  it("shows a Billed indicator once the item's charge is actually Invoiced", () => {
    renderRow({ charge_id: "charge-1", clinic_charges: { status: "Invoiced" } });

    expect(screen.getByText("Billed")).toBeInTheDocument();
  });

  it("does not show a Billed indicator for an unbilled item", () => {
    renderRow({ charge_id: null, clinic_charges: null });

    expect(screen.queryByText("Billed")).not.toBeInTheDocument();
  });

  // Phase H: a billable Treatment gets a charge_id immediately on
  // creation, while the charge is still Pending - the row must not show
  // "Billed" until the linked charge's real status says Invoiced.
  it("does NOT show a Billed indicator while the linked charge is still Pending", () => {
    renderRow({ charge_id: "charge-1", clinic_charges: { status: "Pending" } });

    expect(screen.queryByText("Billed")).not.toBeInTheDocument();
    expect(screen.getByText("Not invoiced")).toBeInTheDocument();
  });

  it("shows clinical status and billing state as two separate signals", () => {
    // Clinically Completed but financially Not invoiced at the same time -
    // these must never collapse into a single status (Phase E section 8).
    renderRow({ status: "Completed", charge_id: null });

    expect(screen.getByText("Completed")).toBeInTheDocument();
    expect(screen.getByText("Not invoiced")).toBeInTheDocument();
    expect(screen.queryByText("Billed")).not.toBeInTheDocument();
  });

  it("shows a 'No tooth association' badge when the item has no associated tooth", () => {
    renderRow({ tooth_number: null, treatment_teeth: [] });

    expect(screen.getByText("No tooth association")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /tooth/i })
    ).not.toBeInTheDocument();
  });

  it("renders a single clickable tooth badge sourced from treatment_teeth", () => {
    renderRow({
      tooth_number: null,
      treatment_teeth: [{ tooth_number: 24 }],
    });

    expect(screen.getByText(/Tooth 24/)).toBeInTheDocument();
  });

  it("calls onViewOnChart with a single-element array for one tooth", () => {
    const onViewOnChart = vi.fn();

    render(
      <TreatmentItemRow
        item={makeItem({ tooth_number: null, treatment_teeth: [{ tooth_number: 24 }] })}
        currency="KES"
        isFirst={false}
        isLast={false}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onMoveUp={vi.fn()}
        onMoveDown={vi.fn()}
        onViewOnChart={onViewOnChart}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /tooth 24/i }));

    expect(onViewOnChart).toHaveBeenCalledWith([24]);
  });

  it("renders a clickable Teeth badge for a grouped (multi-tooth) treatment", () => {
    const onViewOnChart = vi.fn();

    render(
      <TreatmentItemRow
        item={makeItem({
          tooth_number: null,
          treatment_teeth: [
            { tooth_number: 18 },
            { tooth_number: 17 },
            { tooth_number: 16 },
          ],
        })}
        currency="KES"
        isFirst={false}
        isLast={false}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onMoveUp={vi.fn()}
        onMoveDown={vi.fn()}
        onViewOnChart={onViewOnChart}
      />
    );

    const badge = screen.getByRole("button", { name: /teeth 16.*17.*18/i });
    fireEvent.click(badge);

    // Clicking a grouped treatment's teeth badge selects every one of its
    // teeth at once (Phase E section 10), not just the first.
    expect(onViewOnChart).toHaveBeenCalledWith([16, 17, 18]);
  });

  it("falls back to the legacy tooth_number when treatment_teeth wasn't fetched", () => {
    renderRow({ tooth_number: 30, treatment_teeth: undefined });

    expect(screen.getByText(/Tooth 30/)).toBeInTheDocument();
  });
});
