import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// TreatmentItemModal reads getItemTeeth() from services/treatmentPlans.ts
// (Phase D), which also does `import { supabase } from "@/lib/supabase"`
// at module scope - constructing a real supabase-js client and throwing
// without NEXT_PUBLIC_SUPABASE_URL/ANON_KEY, not set in this test
// environment. Same workaround as TreatmentItemRow.test.tsx.
vi.mock("@/lib/supabase", () => ({ supabase: {} }));

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

vi.mock("@/services/treatments", () => ({
  searchTreatments: vi.fn().mockResolvedValue([]),
}));

// Stubbed rather than left real: the real module's functions would hit
// the stubbed {} supabase client above and throw, since TreatmentItemCoding
// calls getProcedureCodesForTreatmentPlanItem() on mount whenever the modal
// is editing an existing item, and TreatmentDiagnosisContext (Phase E)
// calls getDiagnosisCodesForTooth() on mount whenever exactly one tooth is
// selected. The class is kept real-shaped so the component's `instanceof
// ClinicalCodingUnavailableError` checks still work.
vi.mock("@/services/clinicalCodes", () => ({
  ClinicalCodingUnavailableError: class ClinicalCodingUnavailableError extends Error {},
  addPatientProcedureCode: vi.fn(),
  addProcedureCodeModifier: vi.fn(),
  getDiagnosisCodesForTooth: vi.fn().mockResolvedValue([]),
  getProcedureCodesForTreatmentPlanItem: vi.fn().mockResolvedValue([]),
  removePatientProcedureCode: vi.fn(),
  removeProcedureCodeModifier: vi.fn(),
}));

// FIN-2: TreatmentMaterialsUsed (rendered alongside TreatmentItemCoding
// whenever editing an existing item) calls getTreatmentMaterialUsage() on
// mount - same reasoning as the clinicalCodes mock above, stubbed so it
// never hits the stubbed {} supabase client.
vi.mock("@/services/treatmentMaterialUsage", () => ({
  getTreatmentMaterialUsage: vi.fn().mockResolvedValue([]),
  addTreatmentMaterial: vi.fn(),
  updateTreatmentMaterialQuantity: vi.fn(),
  removeTreatmentMaterial: vi.fn(),
}));

import { toast } from "sonner";
import TreatmentItemModal from "./TreatmentItemModal";
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

const toothInputPlaceholder = "e.g. 16";

describe("TreatmentItemModal - teeth editing (Phase D)", () => {
  it("prefills a single tooth chip from defaultToothNumber when creating", () => {
    render(
      <TreatmentItemModal
        open
        item={null}
        patientId="patient-1"
        defaultToothNumber={24}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />
    );

    expect(screen.getByText(/🦷\s*24/)).toBeInTheDocument();
  });

  it("prefills every tooth from an existing grouped treatment when editing", () => {
    render(
      <TreatmentItemModal
        open
        item={makeItem({
          tooth_number: null,
          treatment_teeth: [
            { tooth_number: 18 },
            { tooth_number: 17 },
            { tooth_number: 16 },
          ],
        })}
        patientId="patient-1"
        onClose={vi.fn()}
        onSave={vi.fn()}
      />
    );

    expect(screen.getByText(/🦷\s*16/)).toBeInTheDocument();
    expect(screen.getByText(/🦷\s*17/)).toBeInTheDocument();
    expect(screen.getByText(/🦷\s*18/)).toBeInTheDocument();
  });

  it("adds a valid tooth via the input + Add button", () => {
    render(
      <TreatmentItemModal
        open
        item={makeItem({ tooth_number: null })}
        patientId="patient-1"
        onClose={vi.fn()}
        onSave={vi.fn()}
      />
    );

    fireEvent.change(screen.getByPlaceholderText(toothInputPlaceholder), {
      target: { value: "27" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add tooth" }));

    expect(screen.getByText(/🦷\s*27/)).toBeInTheDocument();
  });

  it("rejects a tooth number that isn't a real FDI code and does not add a chip", () => {
    render(
      <TreatmentItemModal
        open
        item={makeItem({ tooth_number: null })}
        patientId="patient-1"
        onClose={vi.fn()}
        onSave={vi.fn()}
      />
    );

    // 4 is a legacy value seen in this codebase's own historical data
    // (see migration 0075) but is not a real FDI tooth number.
    fireEvent.change(screen.getByPlaceholderText(toothInputPlaceholder), {
      target: { value: "4" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add tooth" }));

    expect(screen.queryByText(/🦷\s*4\b/)).not.toBeInTheDocument();
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringMatching(/real FDI tooth number/i)
    );
  });

  it("removes a tooth chip via its remove button", () => {
    render(
      <TreatmentItemModal
        open
        item={makeItem({
          tooth_number: null,
          treatment_teeth: [{ tooth_number: 16 }, { tooth_number: 17 }],
        })}
        patientId="patient-1"
        onClose={vi.fn()}
        onSave={vi.fn()}
      />
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Remove tooth 16" })
    );

    expect(screen.queryByText(/🦷\s*16\b/)).not.toBeInTheDocument();
    expect(screen.getByText(/🦷\s*17/)).toBeInTheDocument();
  });

  it("submits the current tooth set on save", () => {
    const onSave = vi.fn().mockResolvedValue(undefined);

    render(
      <TreatmentItemModal
        open
        item={makeItem({ tooth_number: null })}
        patientId="patient-1"
        onClose={vi.fn()}
        onSave={onSave}
      />
    );

    fireEvent.change(screen.getByPlaceholderText(toothInputPlaceholder), {
      target: { value: "27" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add tooth" }));

    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ tooth_numbers: [27] })
    );
  });

  it("locks teeth read-only once the treatment has been invoiced", () => {
    render(
      <TreatmentItemModal
        open
        item={makeItem({
          tooth_number: null,
          charge_id: "charge-1",
          clinic_charges: { status: "Invoiced" },
          treatment_teeth: [{ tooth_number: 16 }],
        })}
        patientId="patient-1"
        onClose={vi.fn()}
        onSave={vi.fn()}
      />
    );

    expect(screen.getByText(/🦷\s*16/)).toBeInTheDocument();
    expect(
      screen.getByText(/already been invoiced/i)
    ).toBeInTheDocument();
    expect(
      screen.queryByPlaceholderText(toothInputPlaceholder)
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Remove tooth 16" })
    ).not.toBeInTheDocument();
  });

  // Phase H: a billable Treatment gets a charge_id immediately on
  // creation, while the charge is still Pending - charge_id's mere
  // presence must never lock the teeth editor by itself, or an
  // uninvoiced Treatment could never have its teeth edited again.
  it("does NOT lock teeth for a Treatment whose charge is still Pending (Phase H)", () => {
    render(
      <TreatmentItemModal
        open
        item={makeItem({
          tooth_number: null,
          charge_id: "charge-1",
          clinic_charges: { status: "Pending" },
          treatment_teeth: [{ tooth_number: 16 }],
        })}
        patientId="patient-1"
        onClose={vi.fn()}
        onSave={vi.fn()}
      />
    );

    expect(screen.getByText(/🦷\s*16/)).toBeInTheDocument();
    expect(
      screen.queryByText(/already been invoiced/i)
    ).not.toBeInTheDocument();
    expect(
      screen.getByPlaceholderText(toothInputPlaceholder)
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Remove tooth 16" })
    ).toBeInTheDocument();
  });

  it("allows a treatment with no tooth association at all", () => {
    const onSave = vi.fn().mockResolvedValue(undefined);

    render(
      <TreatmentItemModal
        open
        item={makeItem({ tooth_number: null, treatment_teeth: [] })}
        patientId="patient-1"
        onClose={vi.fn()}
        onSave={onSave}
      />
    );

    expect(
      screen.getByText(/isn't tooth-specific/i)
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ tooth_numbers: [] })
    );
  });

  // Phase E section 1/D: fixes the Phase D gap where a typed name that
  // didn't match a catalogue suggestion never committed to form.procedure.
  it("commits a custom treatment name typed directly, not just a catalogue selection", () => {
    const onSave = vi.fn().mockResolvedValue(undefined);

    render(
      <TreatmentItemModal
        open
        item={makeItem({ tooth_number: null, treatment_teeth: [] })}
        patientId="patient-1"
        onClose={vi.fn()}
        onSave={onSave}
      />
    );

    fireEvent.click(screen.getByLabelText("Custom Treatment"));

    // With "Custom Treatment" checked, TreatmentSelect's catalogue search
    // is hidden entirely - the always-bound "Treatment" field is the only
    // way to set the name.
    expect(
      screen.queryByPlaceholderText("Search treatment...")
    ).not.toBeInTheDocument();

    fireEvent.change(
      screen.getByPlaceholderText("e.g. Composite Restoration"),
      { target: { value: "Composite restoration — special" } }
    );

    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        procedure: "Composite restoration — special",
      })
    );
  });
});
