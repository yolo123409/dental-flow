"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import FormModal from "@/components/ui/FormModal";
import FormInput from "@/components/ui/FormInput";
import FormTextarea from "@/components/ui/FormTextarea";

import { getSuppliers } from "@/services/suppliers";
import { getSupplier } from "@/services/suppliers";
import { updatePurchaseOrderHeader } from "@/services/purchaseOrders";
import { getSafeErrorMessage, logError } from "@/lib/logError";

import { PurchaseOrder } from "@/types/procurement";
import { Supplier, SupplierContact } from "@/types/procurement";

interface Props {
  open: boolean;
  po: PurchaseOrder;
  onClose: () => void;
  onSaved: () => void;
}

export default function POHeaderModal({ open, po, onClose, onSaved }: Props) {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [contacts, setContacts] = useState<SupplierContact[]>([]);

  const [supplierId, setSupplierId] = useState(po.supplier_id);
  const [contactId, setContactId] = useState(po.supplier_contact_id ?? "");
  const [orderDate, setOrderDate] = useState(po.order_date);
  const [expectedDelivery, setExpectedDelivery] = useState(
    po.expected_delivery_date ?? ""
  );
  const [deliveryLocation, setDeliveryLocation] = useState(
    po.delivery_location ?? ""
  );
  const [notes, setNotes] = useState(po.notes ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;

    setSupplierId(po.supplier_id);
    setContactId(po.supplier_contact_id ?? "");
    setOrderDate(po.order_date);
    setExpectedDelivery(po.expected_delivery_date ?? "");
    setDeliveryLocation(po.delivery_location ?? "");
    setNotes(po.notes ?? "");

    getSuppliers().then(setSuppliers).catch(() => {});
  }, [open, po]);

  useEffect(() => {
    if (!open || !supplierId) {
      setContacts([]);
      return;
    }

    getSupplier(supplierId)
      .then((supplier) =>
        setContacts(supplier.clinic_supplier_contacts.filter((c) => c.active))
      )
      .catch(() => setContacts([]));
  }, [open, supplierId]);

  async function handleSubmit() {
    if (!supplierId) {
      toast.error("Select a supplier.");
      return;
    }

    try {
      setSaving(true);

      await updatePurchaseOrderHeader(po.id, {
        supplier_id: supplierId,
        supplier_contact_id: contactId || null,
        order_date: orderDate,
        expected_delivery_date: expectedDelivery || null,
        delivery_location: deliveryLocation.trim() || null,
        notes: notes.trim() || null,
      });

      toast.success("Purchase order updated.");

      onClose();
      onSaved();
    } catch (error) {
      toast.error(
        getSafeErrorMessage(error, "Failed to save changes.", "[POHeaderModal] save failed:")
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <FormModal
      open={open}
      title="Edit Purchase Order"
      loading={saving}
      onClose={onClose}
      onSubmit={handleSubmit}
    >
      <div>
        <label className="mb-2 block text-sm font-semibold text-graphite">
          Supplier
          <span className="ml-1 text-clay">*</span>
        </label>

        <select
          value={supplierId}
          onChange={(e) => {
            setSupplierId(e.target.value);
            setContactId("");
          }}
          className="min-h-11 w-full rounded-lg border border-sea-glass bg-enamel px-3 py-2.5 text-sm text-graphite transition-colors hover:border-mineral/50 focus:border-eucalyptus focus:outline-none"
        >
          {suppliers.map((supplier) => (
            <option key={supplier.id} value={supplier.id}>
              {supplier.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="mb-2 block text-sm font-semibold text-graphite">
          Supplier Contact
        </label>

        <select
          value={contactId}
          onChange={(e) => setContactId(e.target.value)}
          className="min-h-11 w-full rounded-lg border border-sea-glass bg-enamel px-3 py-2.5 text-sm text-graphite transition-colors hover:border-mineral/50 focus:border-eucalyptus focus:outline-none"
        >
          <option value="">No specific contact</option>
          {contacts.map((contact) => (
            <option key={contact.id} value={contact.id}>
              {contact.name}
              {contact.is_primary ? " (Primary)" : ""}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <FormInput
          label="Order Date"
          type="date"
          value={orderDate}
          onChange={setOrderDate}
        />
        <FormInput
          label="Expected Delivery"
          type="date"
          value={expectedDelivery}
          onChange={setExpectedDelivery}
        />
      </div>

      <FormInput
        label="Delivery Location"
        value={deliveryLocation}
        onChange={setDeliveryLocation}
      />

      <FormTextarea label="Notes" value={notes} onChange={setNotes} />
    </FormModal>
  );
}
