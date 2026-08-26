import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// ActiveTreatmentsForTooth reads from services/treatmentTeeth.ts and
// services/treatmentPlans.ts, both of which do `import { supabase } from
// "@/lib/supabase"` at module scope - constructing a real supabase-js
// client and throwing without NEXT_PUBLIC_SUPABASE_URL/ANON_KEY, not set
// in this test environment. Same workaround as the rest of this phase's
// tests; getTreatmentsForTooth itself is mocked directly below so the
// stub client is never actually called.
vi.mock("@/lib/supabase", () => ({ supabase: {} }));

const getTreatmentsForTooth = vi.fn();

vi.mock("@/services/treatmentTeeth", () => ({
  getTreatmentsForTooth: (...args: unknown[]) => getTreatmentsForTooth(...args),
}));

import ActiveTreatmentsForTooth from "./ActiveTreatmentsForTooth";
import { TreatmentPlanItem } from "@/types/treatmentPlan";

function makeItem(
  overrides: Partial<TreatmentPlanItem> = {}
): TreatmentPlanItem {
  return {
    id: "item-1",
    clinic_id: "clinic-1",
    treatment_plan_id: "plan-1",
    procedure: "Composite Restoration",
    tooth_number: null,
    estimated_price: 5000,
    quantity: 3,
    notes: null,
    priority: "Medium",
    status: "Planned",
    sort_order: 0,
    charge_id: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    treatment_teeth: [
      { tooth_number: 16 },
      { tooth_number: 17 },
      { tooth_number: 18 },
    ],
    ...overrides,
  };
}

describe("ActiveTreatmentsForTooth", () => {
  it("shows the explicit empty state when no Treatment is associated with this tooth", async () => {
    getTreatmentsForTooth.mockResolvedValue([]);

    render(
      <ActiveTreatmentsForTooth patientId="patient-1" tooth={24} currency="KES" />
    );

    await waitFor(() =>
      expect(
        screen.getByText("No Treatments are associated with this tooth.")
      ).toBeInTheDocument()
    );
  });

  it("shows a grouped Treatment's full teeth badge - the same record regardless of which of its teeth is open", async () => {
    getTreatmentsForTooth.mockResolvedValue([makeItem()]);

    render(
      <ActiveTreatmentsForTooth patientId="patient-1" tooth={17} currency="KES" />
    );

    // Opened from tooth 17 (one of its three teeth), but the card still
    // shows the whole group - never implying three separate Treatments.
    expect(
      await screen.findByText("Composite Restoration")
    ).toBeInTheDocument();
    expect(screen.getByText("Teeth 16 · 17 · 18")).toBeInTheDocument();
    expect(screen.getByText(/KES\s*15,000/)).toBeInTheDocument();
  });

  it("excludes cancelled treatments", async () => {
    getTreatmentsForTooth.mockResolvedValue([
      makeItem({ status: "Cancelled" }),
    ]);

    render(
      <ActiveTreatmentsForTooth patientId="patient-1" tooth={16} currency="KES" />
    );

    await waitFor(() =>
      expect(
        screen.getByText("No Treatments are associated with this tooth.")
      ).toBeInTheDocument()
    );
  });

  it("shows 'No tooth association' for a tooth-less Treatment somehow returned for this lookup", async () => {
    getTreatmentsForTooth.mockResolvedValue([
      makeItem({ treatment_teeth: [], tooth_number: null }),
    ]);

    render(
      <ActiveTreatmentsForTooth patientId="patient-1" tooth={16} currency="KES" />
    );

    expect(
      await screen.findByText("No tooth association")
    ).toBeInTheDocument();
  });
});
