"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import FormModal from "@/components/ui/FormModal";
import FormInput from "@/components/ui/FormInput";
import FormTextarea from "@/components/ui/FormTextarea";
import SearchInput from "@/components/ui/SearchInput";

import { getInventoryItems, ClinicInventoryItem } from "@/services/inventory";
import { getSafeErrorMessage, logError } from "@/lib/logError";

import { GRNItem, GRNItemInput } from "@/types/procurement";

interface Props {
  open: boolean;
  item: GRNItem | null;
  /** True for a manual GRN (no purchase order) - lets the user pick any inventory item. */
  allowItemPicker: boolean;
  onClose: () => void;
  onSave: (input: GRNItemInput) => Promise<void>;
}

export default function GRNItemModal({
  open,
  item,
  allowItemPicker,
  onClose,
  onSave,
}: Props) {
  const isPoLine = Boolean(item?.purchase_order_item_id);

  const [items, setItems] = useState<ClinicInventoryItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedItem, setSelectedItem] = useState<ClinicInventoryItem | null>(
    null
  );

  const [quantityReceived, setQuantityReceived] = useState("");
  const [unit, setUnit] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [batchNumber, setBatchNumber] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;

    setSearch("");
    setQuantityReceived(item ? String(item.quantity_received) : "");
    setUnit(item?.unit ?? "");
    setUnitCost(item ? String(item.unit_cost) : "");
    setBatchNumber(item?.batch_number ?? "");
    setExpiryDate(item?.expiry_date ?? "");
    setNotes(item?.notes ?? "");
    setSelectedItem(null);

    if (allowItemPicker && !isPoLine) {
      setLoadingItems(true);

      getInventoryItems()
        .then((data) => {
          setItems(data);

          if (item) {
            const match = data.find((i) => i.id === item.inventory_item_id);
            if (match) setSelectedItem(match);
          }
        })
        .catch((error) => {
          logError("[GRNItemModal] load inventory items failed:", error);

          toast.error("Failed to load inventory items.");
        })
        .finally(() => setLoadingItems(false));
    }
  }, [open, item, allowItemPicker, isPoLine]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();

    if (!term) return items;

    return items.filter((i) => i.name.toLowerCase().includes(term));
  }, [items, search]);

  function selectItem(inventoryItem: ClinicInventoryItem) {
    setSelectedItem(inventoryItem);
    setUnit(inventoryItem.unit);

    if (!unitCost) {
      setUnitCost(String(inventoryItem.cost_per_unit));
    }
  }

  async function handleSubmit() {
    const inventoryItemId = isPoLine
      ? item!.inventory_item_id
      : selectedItem?.id;

    if (!inventoryItemId) {
      toast.error("Select an inventory item.");
      return;
    }

    const qty = Number(quantityReceived);

    if (qty < 0) {
      toast.error("Quantity received cannot be negative.");
      return;
    }

    if (isPoLine && item?.quantity_ordered != null) {
      const remaining =
        Number(item.quantity_ordered) - Number(item.quantity_previously_received);

      if (qty > remaining) {
        toast.error(
          `Cannot receive more than the remaining ${remaining} ${item.unit}.`
        );
        return;
      }
    }

    if (!unit.trim()) {
      toast.error("Enter a unit.");
      return;
    }

    try {
      setSaving(true);

      await onSave({
        purchase_order_item_id: item?.purchase_order_item_id ?? null,
        inventory_item_id: inventoryItemId,
        description: item?.description ?? null,
        quantity_ordered: item?.quantity_ordered ?? null,
        quantity_previously_received: item?.quantity_previously_received ?? 0,
        quantity_received: qty,
        unit: unit.trim(),
        unit_cost: Number(unitCost) || 0,
        batch_number: batchNumber.trim() || null,
        expiry_date: expiryDate || null,
        notes: notes.trim() || null,
      });

      onClose();
    } catch (error) {
      toast.error(
        getSafeErrorMessage(error, "Failed to save item.", "[GRNItemModal] save failed:")
      );
    } finally {
      setSaving(false);
    }
  }

  const remaining =
    item?.quantity_ordered != null
      ? Number(item.quantity_ordered) - Number(item.quantity_previously_received)
      : null;

  return (
    <FormModal
      open={open}
      title={item ? "Edit Line" : "Add Item"}
      loading={saving}
      onClose={onClose}
      onSubmit={handleSubmit}
      submitText={item ? "Save Changes" : "Add Item"}
    >
      {isPoLine ? (
        <div className="rounded-lg border border-sea-glass bg-porcelain p-4 text-sm">
          <p className="font-semibold text-graphite">
            {item?.clinic_inventory_items?.name ?? "Item"}
          </p>
          <div className="mt-2 grid grid-cols-3 gap-2 text-center">
            <div>
              <p className="text-xs text-mineral">Ordered</p>
              <p className="font-medium">{item?.quantity_ordered}</p>
            </div>
            <div>
              <p className="text-xs text-mineral">Previously Received</p>
              <p className="font-medium">{item?.quantity_previously_received}</p>
            </div>
            <div>
              <p className="text-xs text-mineral">Remaining</p>
              <p className="font-medium">{remaining}</p>
            </div>
          </div>
        </div>
      ) : (
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
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <FormInput
          label="Receiving Now"
          type="number"
          required
          value={quantityReceived}
          onChange={setQuantityReceived}
        />
        <FormInput label="Unit" required value={unit} onChange={setUnit} />
      </div>

      <FormInput
        label="Unit Cost (actual received cost)"
        type="number"
        value={unitCost}
        onChange={setUnitCost}
      />

      <div className="grid grid-cols-2 gap-4">
        <FormInput
          label="Batch / Lot Number (optional)"
          value={batchNumber}
          onChange={setBatchNumber}
        />
        <FormInput
          label="Expiry Date (optional)"
          type="date"
          value={expiryDate}
          onChange={setExpiryDate}
        />
      </div>

      <FormTextarea label="Notes (optional)" value={notes} onChange={setNotes} />
    </FormModal>
  );
}
