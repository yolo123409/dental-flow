import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// DentalChart's own service call and (transitively, through BulkTreatmentModal)
// treatmentPlans.ts both construct a real supabase-js client at module scope -
// same workaround used throughout this test suite (see
// ActiveTreatmentsForTooth.test.tsx).
vi.mock("@/lib/supabase", () => ({ supabase: {} }));

import { PatientTooth } from "@/types";

const getPatientTeeth = vi.fn();

vi.mock("@/services/patientTeeth", () => ({
  getPatientTeeth: (...args: unknown[]) => getPatientTeeth(...args),
}));

// ToothDetails pulls in TreatmentForm/ToothHistoryTab/ToothAttachments/
// ActiveTreatmentsForTooth - a deep, supabase-backed tree unrelated to what
// this file tests (dentition switching and tooth-number translation), so
// it's stubbed exactly like ToothWorkspace.test.tsx did in the prior phase.
vi.mock("./ToothDetails", () => ({
  default: (props: { tooth: number }) => (
    <div data-testid="tooth-details">ToothDetails for tooth {props.tooth}</div>
  ),
}));

// Not exercised by any scenario here (only ever opened via its own button,
// which none of these tests click) - stubbed to keep the tree light.
vi.mock("./BulkTreatmentModal", () => ({
  default: () => null,
}));

import DentalChart from "./DentalChart";

function toothElements(container: HTMLElement) {
  return container.querySelectorAll('[class*="teeth-"]');
}

describe("DentalChart - dentition toggle", () => {
  it("renders the permanent odontogram (32 teeth) by default, with Permanent active", async () => {
    const { container } = await renderAndGetContainer([]);

    expect(screen.getByRole("button", { name: "Permanent" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(screen.getByRole("button", { name: "Primary" })).toHaveAttribute(
      "aria-pressed",
      "false"
    );
    expect(toothElements(container)).toHaveLength(32);
  });

  it("switches to the primary odontogram (20 teeth) when Primary is selected", async () => {
    const { container } = await renderAndGetContainer([]);

    fireEvent.click(screen.getByRole("button", { name: "Primary" }));

    await waitFor(() => expect(toothElements(container)).toHaveLength(20));
    expect(screen.getByRole("button", { name: "Primary" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
  });

  it("switches back to the permanent odontogram (32 teeth) from Primary", async () => {
    const { container } = await renderAndGetContainer([]);

    fireEvent.click(screen.getByRole("button", { name: "Primary" }));
    await waitFor(() => expect(toothElements(container)).toHaveLength(20));

    fireEvent.click(screen.getByRole("button", { name: "Permanent" }));
    await waitFor(() => expect(toothElements(container)).toHaveLength(32));
  });
});

describe("DentalChart - primary tooth selection", () => {
  it("selects the correct primary FDI number and opens ToothDetails for it", async () => {
    const { container } = await renderAndGetContainer([]);

    fireEvent.click(screen.getByRole("button", { name: "Primary" }));
    await waitFor(() => expect(toothElements(container)).toHaveLength(20));

    // The vendor's own first-quadrant/first-position element is always
    // "teeth-11" internally - primaryToothToVendorId(51) maps to exactly
    // that id, so clicking it must select logical tooth 51, not 11.
    const firstPrimaryTooth = container.querySelector(".teeth-11");
    expect(firstPrimaryTooth).not.toBeNull();
    fireEvent.click(firstPrimaryTooth!);

    await waitFor(() =>
      expect(screen.getByTestId("tooth-details")).toHaveTextContent(
        "ToothDetails for tooth 51"
      )
    );
    expect(screen.queryByText("No tooth selected")).not.toBeInTheDocument();
  });

  it("selects a different primary quadrant/position correctly (tooth 65)", async () => {
    const { container } = await renderAndGetContainer([]);

    fireEvent.click(screen.getByRole("button", { name: "Primary" }));
    await waitFor(() => expect(toothElements(container)).toHaveLength(20));

    // primaryToothToVendorId(65) = "teeth-25" (quadrant 6-4=2, position 5).
    const tooth65 = container.querySelector(".teeth-25");
    expect(tooth65).not.toBeNull();
    fireEvent.click(tooth65!);

    await waitFor(() =>
      expect(screen.getByTestId("tooth-details")).toHaveTextContent(
        "ToothDetails for tooth 65"
      )
    );
  });
});

describe("DentalChart - switching dentition clears incompatible selection", () => {
  it("clears a permanent selection when switching to Primary", async () => {
    const { container } = await renderAndGetContainer([]);

    fireEvent.click(container.querySelector(".teeth-16")!);
    await waitFor(() =>
      expect(screen.getByTestId("tooth-details")).toHaveTextContent(
        "ToothDetails for tooth 16"
      )
    );

    fireEvent.click(screen.getByRole("button", { name: "Primary" }));

    await waitFor(() => expect(screen.queryByTestId("tooth-details")).not.toBeInTheDocument());
    expect(screen.getByText("No tooth selected")).toBeInTheDocument();
  });

  it("clears a primary selection when switching back to Permanent", async () => {
    const { container } = await renderAndGetContainer([]);

    fireEvent.click(screen.getByRole("button", { name: "Primary" }));
    await waitFor(() => expect(toothElements(container)).toHaveLength(20));

    fireEvent.click(container.querySelector(".teeth-11")!);
    await waitFor(() =>
      expect(screen.getByTestId("tooth-details")).toHaveTextContent(
        "ToothDetails for tooth 51"
      )
    );

    fireEvent.click(screen.getByRole("button", { name: "Permanent" }));

    await waitFor(() => expect(screen.queryByTestId("tooth-details")).not.toBeInTheDocument());
    expect(screen.getByText("No tooth selected")).toBeInTheDocument();
  });
});

describe("DentalChart - existing permanent functionality is unchanged", () => {
  it("clicking a permanent tooth still selects its own real FDI number (no translation)", async () => {
    const { container } = await renderAndGetContainer([]);

    fireEvent.click(container.querySelector(".teeth-36")!);

    await waitFor(() =>
      expect(screen.getByTestId("tooth-details")).toHaveTextContent(
        "ToothDetails for tooth 36"
      )
    );
  });

  it("quick-select 'Select All' still selects all 32 permanent teeth", async () => {
    await renderAndGetContainer([]);

    fireEvent.click(screen.getByRole("button", { name: "Select All" }));

    await waitFor(() =>
      expect(screen.getByText("All teeth selected · 32 teeth")).toBeInTheDocument()
    );
  });

  it("quick-select 'Upper Arch' still selects the 16 permanent upper-arch teeth", async () => {
    await renderAndGetContainer([]);

    fireEvent.click(screen.getByRole("button", { name: "Upper Arch" }));

    await waitFor(() =>
      expect(screen.getByText("Upper arch selected · 16 teeth")).toBeInTheDocument()
    );
  });

  it("quick-select 'UR' still selects the 8 permanent upper-right teeth", async () => {
    await renderAndGetContainer([]);

    fireEvent.click(screen.getByRole("button", { name: "UR" }));

    await waitFor(() =>
      expect(screen.getByText("Upper Right selected · 8 teeth")).toBeInTheDocument()
    );
  });
});

async function renderAndGetContainer(teeth: PatientTooth[]) {
  getPatientTeeth.mockResolvedValue(teeth);

  const result = render(<DentalChart patientId="patient-1" currency="KES" />);

  await waitFor(() =>
    expect(screen.queryByText("Loading dental chart...")).not.toBeInTheDocument()
  );

  return result;
}
