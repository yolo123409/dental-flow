import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// TreatmentForm reads from services/clinicalCodes.ts, which does
// `import { supabase } from "@/lib/supabase"` at module scope -
// constructing a real supabase-js client and throwing without
// NEXT_PUBLIC_SUPABASE_URL/ANON_KEY, not set in this test environment.
vi.mock("@/lib/supabase", () => ({ supabase: {} }));

vi.mock("@/services/clinicalCodes", () => ({
  ClinicalCodingUnavailableError: class ClinicalCodingUnavailableError extends Error {},
  addPatientDiagnosisCode: vi.fn(),
  addPatientProcedureCode: vi.fn(),
  addProcedureCodeModifier: vi.fn(),
  getDiagnosisCodesForTooth: vi.fn().mockResolvedValue([]),
  getProcedureCodesForTooth: vi.fn().mockResolvedValue([]),
  removePatientDiagnosisCode: vi.fn(),
  removePatientProcedureCode: vi.fn(),
  removeProcedureCodeModifier: vi.fn(),
  searchClinicalCodes: vi.fn().mockResolvedValue([]),
}));

import TreatmentForm from "./TreatmentForm";

const baseInitialValues = {
  condition: "Healthy" as const,
  diagnosis: "",
  treatment: "Old Filling",
  treatment_status: "Planned" as const,
  materials: "",
  estimated_cost: 5000,
  notes: "",
};

describe("TreatmentForm (Phase H - treatment/cost fields removed)", () => {
  it("does not render a treatment name or estimated cost field", () => {
    render(
      <TreatmentForm
        patientId="patient-1"
        tooth={16}
        initialValues={baseInitialValues}
        saving={false}
        onSave={vi.fn()}
      />
    );

    expect(
      screen.queryByText("Treatment Performed")
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Estimated Cost")).not.toBeInTheDocument();
    expect(screen.queryByText("Custom Treatment")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Treatment Catalogue")
    ).not.toBeInTheDocument();

    // Genuinely clinical fields remain.
    expect(screen.getByText("Condition")).toBeInTheDocument();
    expect(screen.getByText("Diagnosis")).toBeInTheDocument();
    expect(screen.getByText("Treatment Status")).toBeInTheDocument();
    expect(screen.getByText("Materials Used")).toBeInTheDocument();
    expect(screen.getByText("Clinical Notes")).toBeInTheDocument();
  });

  it("preserves the historical treatment/estimated_cost unchanged on save, even though they aren't editable here", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);

    render(
      <TreatmentForm
        patientId="patient-1"
        tooth={16}
        initialValues={baseInitialValues}
        saving={false}
        onSave={onSave}
      />
    );

    fireEvent.click(screen.getByText("Save Treatment"));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        treatment: "Old Filling",
        estimated_cost: 5000,
      })
    );
  });

  it("passes through null treatment/estimated_cost for a tooth with no legacy history", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);

    render(
      <TreatmentForm
        patientId="patient-1"
        tooth={17}
        initialValues={{
          ...baseInitialValues,
          treatment: "",
          estimated_cost: null,
        }}
        saving={false}
        onSave={onSave}
      />
    );

    fireEvent.click(screen.getByText("Save Treatment"));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ treatment: "", estimated_cost: null })
    );
  });
});
