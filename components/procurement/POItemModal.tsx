"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import FormModal from "@/components/ui/FormModal";
import FormInput from "@/components/ui/FormInput";
import SearchInput from "@/components/ui/SearchInput";
import Button from "@/components/ui/Button";

import MaterialModal from "@/components/inventory/MaterialModal";

import { getInventoryItems, ClinicInventoryItem } from "@/services/inventory";
import { logError } from "@/lib/logError";

import { PurchaseOrderItem } from "@/types/procurement";

interface Props {
  open: boolean;
  item: PurchaseOrderItem | null;
  onClose: () => void;
  onSave: (input: {
    inventory_item_id: string;
    description: string | null;
    quantity: number;
    unit: string;
    unit_price: number;
  }) => Promise<void>;
}

export default function POItemModal({ open, item, onClose, onSave }: Props) {
  const [items, setItems] = useState<ClinicInventoryItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [search, setSearch] = useState("");

  const [selectedItem, setSelectedItem] = useState<ClinicInventoryItem | null>(
    null
  );
  const [description, setDescription] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState("");
  const [unitPrice, setUnitPrice] = useState("");

  const [materialModalOpen, setMaterialModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  async function loadItems(preferredId?: string) {
    try {
      setLoadingItems(true);

      const data = await getInventoryItems();

      setItems(data);

      const targetId = preferredId ?? item?.inventory_item_id;

      if (targetId) {
        const match = data.find((i) => i.id === targetId);

        if (match) {
          setSelectedItem(match);

          if (!item) {
            setUnit(match.unit);
            setUnitPrice(String(match.cost_per_unit));
          }
        }
      }
    } catch (error) {
      logError("[POItemModal] load inventory items failed:", error);

      toast.error("Failed to load inventory items.");
    } finally {
      setLoadingItems(false);
    }
  }

  useEffect(() => {
    if (!open) return;

    loadItems();

    setSearch("");
    setDescription(item?.description ?? "");
    setQuantity(item ? String(item.quantity) : "");
    setUnit(item?.unit ?? "");
    setUnitPrice(item ? String(item.unit_price) : "");
    setSelectedItem(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, item]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();

    if (!term) return items;

    return items.filter((i) => i.name.toLowerCase().includes(term));
  }, [items, search]);

  function selectItem(inventoryItem: ClinicInventoryItem) {
    setSelectedItem(inventoryItem);
    setUnit(inventoryItem.unit);

    if (!unitPrice) {
      setUnitPrice(String(inventoryItem.cost_per_unit));
    }
  }

  async function handleNewItemSaved() {
    const previousIds = items.map((i) => i.id);

    const data = await getInventoryItems();
    setItems(data);

    const newlyAdded = data.filter((i) => !previousIds.includes(i.id));

    if (newlyAdded.length === 1) {
      selectItem(newlyAdded[0]);
    }
  }

  async function handleSubmit() {
    if (!selectedItem) {
      toast.error("Select an inventory item.");
      return;
    }

    const qty = Number(quantity);
    const price = Number(unitPrice);

    if (!qty || qty <= 0) {
      toast.error("Enter a quantity greater than 0.");
      return;
    }

    if (!unit.trim()) {
      toast.error("Enter a unit.");
      return;
    }

    if (price < 0) {
      toast.error("Unit price cannot be negative.");
      return;
    }

    try {
      setSaving(true);

      await onSave({
        inventory_item_id: selectedItem.id,
        description: description.trim() || null,
        quantity: qty,
        unit: unit.trim(),
        unit_price: price,
      });

      onClose();
    } catch (error) {
      logError("[POItemModal] save failed:", error);

      toast.error(
        error instanceof Error ? error.message : "Failed to save item."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <FormModal
        open={open}
        title={item ? "Edit Item" : "Add Item"}
        loading={saving}
        onClose={onClose}
        onSubmit={handleSubmit}
        submitText={item ? "Save Changes" : "Add Item"}
      >
        <div>
          <label className="mb-2 block text-sm font-semibold text-graphite">
            Inventory Item
            <span className="ml-1 text-clay">*</span>
          </label>

          {selectedItem ? (
            <div className="flex items-center justify-between rounded-lg border border-sea-glass bg-porcelain px-3 py-2.5 text-sm">
              <span className="font-medium text-graphite">
                {selectedItem.name}
              </span>
              <button
                type="button"
                className="text-xs font-semibold text-eucalyptus hover:underline"
                onClick={() => setSelectedItem(null)}
              >
                Change
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <SearchInput
                value={search}
                onChange={setSearch}
                placeholder="Search inventory items..."
              />

              <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-sea-glass p-2">
                {loadingItems ? (
                  <p className="py-4 text-center text-sm text-mineral">
                    Loading...
                  </p>
                ) : filtered.length === 0 ? (
                  <p className="py-4 text-center text-sm text-mineral">
                    No matching items.
                  </p>
                ) : (
                  filtered.map((i) => (
                    <button
                      type="button"
                      key={i.id}
                      onClick={() => selectItem(i)}
                      className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-sm text-graphite hover:bg-porcelain"
                    >
                      <span>{i.name}</span>
                      <span className="text-xs text-mineral">
                        {i.quantity} {i.unit} in stock
                      </span>
                    </button>
                  ))
                )}
              </div>

              <Button
                type="button"
                variant="secondary"
                className="w-full"
                onClick={() => setMaterialModalOpen(true)}
              >
                + Add New Inventory Item
              </Button>
            </div>
          )}
        </div>

        <FormInput
          label="Description (optional)"
          value={description}
          onChange={setDescription}
        />

        <div className="grid grid-cols-3 gap-4">
          <FormInput
            label="Quantity"
            type="number"
            required
            value={quantity}
            onChange={setQuantity}
          />
          <FormInput label="Unit" required value={unit} onChange={setUnit} />
          <FormInput
            label="Unit Price"
            type="number"
            required
            value={unitPrice}
            onChange={setUnitPrice}
          />
        </div>
      </FormModal>

      <MaterialModal
        open={materialModalOpen}
        material={null}
        onClose={() => setMaterialModalOpen(false)}
        onSaved={handleNewItemSaved}
      />
    </>
  );
}
