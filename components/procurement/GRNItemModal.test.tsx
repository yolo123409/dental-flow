import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
import { toast } from "sonner";

const getInventoryItems = vi.fn();
vi.mock("@/services/inventory", () => ({
  getInventoryItems: (...args: unknown[]) => getInventoryItems(...args),
}));

import GRNItemModal from "./GRNItemModal";
import { GRNItem } from "@/types/procurement";

function makePoLine(overrides: Partial<GRNItem> = {}): GRNItem {
  return {
    id: "line-1",
    grn_id: "grn-1",
    clinic_id: "clinic-1",
    purchase_order_item_id: "poi-1",
    inventory_item_id: "item-1",
    description: "Nitrile Gloves",
    quantity_ordered: 20,
    quantity_previously_received: 0,
    quantity_received: 10,
    unit: "box",
    unit_cost: 0,
    batch_number: null,
    expiry_date: null,
    notes: null,
    display_order: 0,
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
    clinic_inventory_items: { name: "Nitrile Gloves", unit: "box" },
    ...overrides,
  };
}

describe("GRNItemModal (full-app audit fix H13)", () => {
  it("rejects submission when Unit Cost is left blank - the exact bug that silently defaulted to 0", async () => {
    const onSave = vi.fn();

    render(
      <GRNItemModal
        open
        item={makePoLine({ unit_cost: 0 })}
        allowItemPicker={false}
        onClose={vi.fn()}
        onSave={onSave}
      />
    );

    fireEvent.change(screen.getByLabelText(/Unit Cost/i), {
      target: { value: "" },
    });

    fireEvent.click(screen.getByRole("button", { name: /Save Changes/i }));

    expect(toast.error).toHaveBeenCalledWith(
      "Enter a unit cost greater than 0."
    );
    expect(onSave).not.toHaveBeenCalled();
  });

  it("rejects a unit cost of exactly 0", async () => {
    const onSave = vi.fn();

    render(
      <GRNItemModal
        open
        item={makePoLine({ unit_cost: 0 })}
        allowItemPicker={false}
        onClose={vi.fn()}
        onSave={onSave}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /Save Changes/i }));

    expect(toast.error).toHaveBeenCalledWith(
      "Enter a unit cost greater than 0."
    );
    expect(onSave).not.toHaveBeenCalled();
  });

  it("saves with the exact entered unit cost when it's a valid positive number", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);

    render(
      <GRNItemModal
        open
        item={makePoLine()}
        allowItemPicker={false}
        onClose={vi.fn()}
        onSave={onSave}
      />
    );

    fireEvent.change(screen.getByLabelText(/Unit Cost/i), {
      target: { value: "45.5" },
    });

    fireEvent.click(screen.getByRole("button", { name: /Save Changes/i }));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ unit_cost: 45.5 })
    );
  });
});
