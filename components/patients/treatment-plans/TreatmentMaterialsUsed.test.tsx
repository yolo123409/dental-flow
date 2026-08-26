import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const hasPermission = vi.fn();
vi.mock("@/hooks/usePermissions", () => ({
  default: () => ({ role: "Owner", hasPermission: (p: string) => hasPermission(p) }),
}));

const getInventoryItems = vi.fn();
vi.mock("@/services/inventory", () => ({
  getInventoryItems: () => getInventoryItems(),
}));

const getTreatmentMaterialUsage = vi.fn();
const addTreatmentMaterial = vi.fn();
const updateTreatmentMaterialQuantity = vi.fn();

vi.mock("@/services/treatmentMaterialUsage", () => ({
  getTreatmentMaterialUsage: (...args: unknown[]) => getTreatmentMaterialUsage(...args),
  addTreatmentMaterial: (...args: unknown[]) => addTreatmentMaterial(...args),
  updateTreatmentMaterialQuantity: (...args: unknown[]) =>
    updateTreatmentMaterialQuantity(...args),
  removeTreatmentMaterial: vi.fn(),
}));

import TreatmentMaterialsUsed from "./TreatmentMaterialsUsed";

const TREATMENT_PLAN_ITEM_ID = "tpi-1";

const GUTTA_PERCHA = {
  id: "inv-gutta",
  name: "Gutta-percha",
  category: null,
  quantity: 100,
  unit: "unit",
  cost_per_unit: 500,
  minimum_stock_level: 5,
  batch_number: null,
  expiry_date: null,
  notes: null,
  selling_price: null,
  target_markup_percent: null,
  priced_at_cost: null,
  created_at: "2026-01-01",
  updated_at: "2026-01-01",
};

const GLOVES = {
  ...GUTTA_PERCHA,
  id: "inv-gloves",
  name: "Gloves",
  cost_per_unit: 50,
};

function usageRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "usage-1",
    clinic_id: "clinic-1",
    treatment_plan_item_id: TREATMENT_PLAN_ITEM_ID,
    inventory_item_id: GUTTA_PERCHA.id,
    quantity: 1,
    unit_cost: 500,
    created_by: null,
    created_at: "2026-08-01",
    updated_at: "2026-08-01",
    clinic_inventory_items: { name: "Gutta-percha", unit: "unit" },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  hasPermission.mockReturnValue(true);
  getInventoryItems.mockResolvedValue([GUTTA_PERCHA, GLOVES]);
  getTreatmentMaterialUsage.mockResolvedValue([]);
});

describe("TreatmentMaterialsUsed", () => {
  it("shows already-recorded materials with unit cost from inventory (never user-entered) and a correct line total", async () => {
    getTreatmentMaterialUsage.mockResolvedValue([usageRow({ quantity: 2, unit_cost: 500 })]);

    render(<TreatmentMaterialsUsed treatmentPlanItemId={TREATMENT_PLAN_ITEM_ID} currency="KES" />);

    expect(await screen.findByText("Gutta-percha")).toBeInTheDocument();

    // Total Material Cost footer = 2 * 500 = 1000, and it appears at least
    // once as the line total too.
    await waitFor(() => {
      expect(screen.getAllByText(/KES\s*1,000/).length).toBeGreaterThan(0);
    });
  });

  it("lets the user search for and select an inventory item, then add it with a quantity", async () => {
    render(<TreatmentMaterialsUsed treatmentPlanItemId={TREATMENT_PLAN_ITEM_ID} currency="KES" />);

    await waitFor(() => expect(getInventoryItems).toHaveBeenCalled());

    const search = screen.getByPlaceholderText("+ Add Inventory Item");
    fireEvent.change(search, { target: { value: "Gutta" } });

    const option = await screen.findByText("Gutta-percha");
    fireEvent.click(option);

    const quantityInput = screen.getByLabelText("Quantity to add");
    fireEvent.change(quantityInput, { target: { value: "1" } });

    addTreatmentMaterial.mockResolvedValue(usageRow());
    getTreatmentMaterialUsage.mockResolvedValue([usageRow({ quantity: 1 })]);

    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => {
      expect(addTreatmentMaterial).toHaveBeenCalledWith(
        TREATMENT_PLAN_ITEM_ID,
        GUTTA_PERCHA.id,
        1
      );
    });
  });

  it("sums Total Material Cost across multiple attached materials", async () => {
    getTreatmentMaterialUsage.mockResolvedValue([
      usageRow({ id: "u1", inventory_item_id: GUTTA_PERCHA.id, quantity: 1, unit_cost: 500, clinic_inventory_items: { name: "Gutta-percha", unit: "unit" } }),
      usageRow({ id: "u2", inventory_item_id: GLOVES.id, quantity: 1, unit_cost: 50, clinic_inventory_items: { name: "Gloves", unit: "unit" } }),
    ]);

    render(<TreatmentMaterialsUsed treatmentPlanItemId={TREATMENT_PLAN_ITEM_ID} currency="KES" />);

    await screen.findByText("Gutta-percha");
    await screen.findByText("Gloves");

    await waitFor(() => {
      expect(screen.getByText("Total Material Cost").parentElement?.textContent).toMatch(/550/);
    });
  });

  it("commits a quantity edit only on blur, not on every keystroke, and reconciles via the update RPC", async () => {
    getTreatmentMaterialUsage.mockResolvedValue([usageRow({ quantity: 1 })]);
    updateTreatmentMaterialQuantity.mockResolvedValue(usageRow({ quantity: 2 }));

    render(<TreatmentMaterialsUsed treatmentPlanItemId={TREATMENT_PLAN_ITEM_ID} currency="KES" />);

    const quantityInput = await screen.findByLabelText("Quantity for Gutta-percha");

    fireEvent.change(quantityInput, { target: { value: "2" } });
    expect(updateTreatmentMaterialQuantity).not.toHaveBeenCalled();

    fireEvent.blur(quantityInput);

    await waitFor(() => {
      expect(updateTreatmentMaterialQuantity).toHaveBeenCalledWith("usage-1", 2);
    });
  });

  it("removing a line calls the update RPC with quantity 0", async () => {
    getTreatmentMaterialUsage.mockResolvedValue([usageRow({ quantity: 1 })]);
    updateTreatmentMaterialQuantity.mockResolvedValue(null);

    render(<TreatmentMaterialsUsed treatmentPlanItemId={TREATMENT_PLAN_ITEM_ID} currency="KES" />);

    const removeButton = await screen.findByLabelText("Remove Gutta-percha");
    fireEvent.click(removeButton);

    await waitFor(() => {
      expect(updateTreatmentMaterialQuantity).toHaveBeenCalledWith("usage-1", 0);
    });
  });

  it("hides the add-material controls (but still shows recorded materials read-only) without inventory_manage permission", async () => {
    hasPermission.mockReturnValue(false);
    getTreatmentMaterialUsage.mockResolvedValue([usageRow({ quantity: 1 })]);

    render(<TreatmentMaterialsUsed treatmentPlanItemId={TREATMENT_PLAN_ITEM_ID} currency="KES" />);

    await screen.findByText("Gutta-percha");

    expect(screen.queryByPlaceholderText("+ Add Inventory Item")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Remove Gutta-percha")).not.toBeInTheDocument();
    expect(getInventoryItems).not.toHaveBeenCalled();
  });
});
