"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pencil, Trash2 } from "lucide-react";

import jsPDF from "jspdf";
import { toPng } from "html-to-image";

import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import FormInput from "@/components/ui/FormInput";
import FormTextarea from "@/components/ui/FormTextarea";
import LoadingSpinner from "@/components/ui/LoadingSpinner";
import EmptyState from "@/components/ui/EmptyState";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import PermissionGuard from "@/components/auth/PermissionGuard";

import GRNStatusBadge from "@/components/procurement/GRNStatusBadge";
import GRNItemModal from "@/components/procurement/GRNItemModal";
import GRNDocument from "@/components/procurement/GRNDocument";
import SendDocumentModal from "@/components/procurement/SendDocumentModal";

import usePermissions from "@/hooks/usePermissions";
import {
  getGRN,
  updateGRNHeader,
  addGRNItem,
  updateGRNItem,
  removeGRNItem,
  confirmGRNReceipt,
  cancelGRN,
  sendGRN,
} from "@/services/grns";
import { getClinicSettings, ClinicSettings } from "@/services/settings";
import { getProcurementSettings } from "@/services/procurementSettings";
import { getSafeErrorMessage, logError } from "@/lib/logError";

import {
  GRNWithItems,
  GRNItem,
  GRNItemInput,
  ProcurementSettings,
} from "@/types/procurement";

function GRNDetailContent() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const { hasPermission } = usePermissions();
  const canManage = hasPermission("procurement_manage");

  const [loading, setLoading] = useState(true);
  const [grn, setGrn] = useState<GRNWithItems | null>(null);
  const [clinic, setClinic] = useState<ClinicSettings | null>(null);
  const [procurementSettings, setProcurementSettings] =
    useState<ProcurementSettings | null>(null);

  const documentRef = useRef<HTMLDivElement>(null);

  const [deliveryNote, setDeliveryNote] = useState("");
  const [dateReceived, setDateReceived] = useState("");
  const [notes, setNotes] = useState("");
  const [savingHeader, setSavingHeader] = useState(false);

  const [itemModalOpen, setItemModalOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<GRNItem | null>(null);

  const [removeDialogOpen, setRemoveDialogOpen] = useState(false);
  const [removingItem, setRemovingItem] = useState<GRNItem | null>(null);

  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [sendModalOpen, setSendModalOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    load();
  }, [id]);

  async function load() {
    try {
      setLoading(true);

      const [data, clinicData, settingsData] = await Promise.all([
        getGRN(id),
        getClinicSettings(),
        getProcurementSettings(),
      ]);

      setGrn(data);
      setClinic(clinicData);
      setProcurementSettings(settingsData);
      setDeliveryNote(data.supplier_delivery_note ?? "");
      setDateReceived(data.date_received);
      setNotes(data.notes ?? "");
    } catch (error) {
      toast.error(
        getSafeErrorMessage(error, "Failed to load GRN.", "[GRNDetail] load failed:")
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveHeader() {
    if (!grn) return;

    try {
      setSavingHeader(true);

      await updateGRNHeader(grn.id, {
        supplier_id: grn.supplier_id,
        supplier_delivery_note: deliveryNote.trim() || null,
        date_received: dateReceived,
        notes: notes.trim() || null,
      });

      toast.success("Saved.");

      await load();
    } catch (error) {
      toast.error(
        getSafeErrorMessage(error, "Failed to save changes.", "[GRNDetail] save header failed:")
      );
    } finally {
      setSavingHeader(false);
    }
  }

  async function handleSaveItem(input: GRNItemInput) {
    if (!grn) return;

    if (selectedItem) {
      await updateGRNItem(selectedItem.id, input);
    } else {
      await addGRNItem(grn.id, input, grn.clinic_grn_items.length);
    }

    await load();
  }

  async function confirmRemoveItem() {
    if (!removingItem) return;

    try {
      setBusy(true);

      await removeGRNItem(removingItem.id);

      toast.success("Item removed.");

      setRemoveDialogOpen(false);
      setRemovingItem(null);

      await load();
    } catch (error) {
      toast.error(
        getSafeErrorMessage(error, "Failed to remove item.", "[GRNDetail] remove item failed:")
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirmReceipt() {
    if (!grn) return;

    try {
      setBusy(true);

      await confirmGRNReceipt(grn.id);

      toast.success("Goods received - inventory updated.");

      setConfirmDialogOpen(false);

      await load();
    } catch (error) {
      toast.error(
        getSafeErrorMessage(
          error,
          "Failed to confirm goods received.",
          "[GRNDetail] confirm receipt failed:"
        )
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleCancel() {
    if (!grn) return;

    try {
      setBusy(true);

      await cancelGRN(grn.id);

      toast.success("GRN cancelled.");

      setCancelDialogOpen(false);

      await load();
    } catch (error) {
      toast.error(
        getSafeErrorMessage(error, "Failed to cancel GRN.", "[GRNDetail] cancel failed:")
      );
    } finally {
      setBusy(false);
    }
  }

  async function downloadPDF() {
    if (!documentRef.current || !grn) return;

    try {
      const dataUrl = await toPng(documentRef.current, {
        cacheBust: true,
        pixelRatio: 2,
        backgroundColor: "#ffffff",
      });

      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

      const img = new Image();
      img.src = dataUrl;

      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("Failed to load generated image."));
      });

      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = (img.height * pageWidth) / img.width;

      pdf.addImage(dataUrl, "PNG", 0, 0, pageWidth, pageHeight);
      pdf.save(`${grn.grn_number}.pdf`);
    } catch (error) {
      logError("[GRNDetail] downloadPDF failed:", error);

      toast.error("Failed to generate PDF.");
    }
  }

  async function handleSent(via: "Email" | "WhatsApp", contactId: string | null) {
    if (!grn) return;

    await sendGRN(grn.id, via, contactId);

    await load();
  }

  if (loading) {
    return <LoadingSpinner text="Loading GRN..." />;
  }

  if (!grn) {
    return (
      <EmptyState
        title="GRN not found"
        description="This goods received note may have been removed."
      />
    );
  }

  const isDraft = grn.status === "Draft";
  const isManual = grn.purchase_order_id === null;
  const itemsWithReceipt = grn.clinic_grn_items.filter(
    (i) => i.quantity_received > 0
  );

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <button
            onClick={() => router.push("/admin/inventory/grns")}
            className="mb-2 text-sm font-semibold text-eucalyptus hover:underline"
          >
            ← Back to Goods Received Notes
          </button>

          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold">{grn.grn_number}</h1>
            <GRNStatusBadge status={grn.status} />
          </div>

          {grn.clinic_purchase_orders && (
            <p className="mt-1 text-sm text-mineral">
              Against {grn.clinic_purchase_orders.po_number}
            </p>
          )}
        </div>

        {canManage && (
          <div className="flex gap-3">
            <Button variant="secondary" onClick={() => setSendModalOpen(true)}>
              Send
            </Button>
            {isDraft && (
              <>
                <Button variant="danger" onClick={() => setCancelDialogOpen(true)}>
                  Cancel
                </Button>
                <Button
                  disabled={itemsWithReceipt.length === 0}
                  onClick={() => setConfirmDialogOpen(true)}
                >
                  Confirm Received
                </Button>
              </>
            )}
          </div>
        )}
      </div>

      <Card title="Delivery Details">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-mineral">
              Supplier
            </p>
            <p className="mt-1 text-graphite">{grn.clinic_suppliers?.name ?? "-"}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-mineral">
              Contact
            </p>
            <p className="mt-1 text-graphite">
              {grn.clinic_supplier_contacts?.name ?? "-"}
            </p>
          </div>

          {isDraft && canManage ? (
            <>
              <FormInput
                label="Date Received"
                type="date"
                value={dateReceived}
                onChange={setDateReceived}
              />
              <FormInput
                label="Supplier Delivery Note"
                value={deliveryNote}
                onChange={setDeliveryNote}
              />
              <div className="sm:col-span-2">
                <FormTextarea label="Notes" value={notes} onChange={setNotes} />
              </div>
              <div className="sm:col-span-2">
                <Button
                  variant="secondary"
                  disabled={savingHeader}
                  onClick={handleSaveHeader}
                >
                  {savingHeader ? "Saving..." : "Save Details"}
                </Button>
              </div>
            </>
          ) : (
            <>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-mineral">
                  Date Received
                </p>
                <p className="mt-1 text-graphite">
                  {new Date(grn.date_received).toLocaleDateString()}
                </p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-mineral">
                  Supplier Delivery Note
                </p>
                <p className="mt-1 text-graphite">
                  {grn.supplier_delivery_note || "-"}
                </p>
              </div>
              <div className="sm:col-span-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-mineral">
                  Notes
                </p>
                <p className="mt-1 text-graphite">{grn.notes || "-"}</p>
              </div>
            </>
          )}
        </div>
      </Card>

      <Card title="Items">
        {isDraft && canManage && isManual && (
          <div className="mb-4 flex justify-end">
            <Button
              variant="secondary"
              onClick={() => {
                setSelectedItem(null);
                setItemModalOpen(true);
              }}
            >
              + Add Item
            </Button>
          </div>
        )}

        {grn.clinic_grn_items.length === 0 ? (
          <p className="py-6 text-center text-sm text-mineral">
            No items yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold">Item</th>
                  {!isManual && (
                    <>
                      <th className="px-4 py-3 text-right font-semibold">
                        Ordered
                      </th>
                      <th className="px-4 py-3 text-right font-semibold">
                        Previously Received
                      </th>
                    </>
                  )}
                  <th className="px-4 py-3 text-right font-semibold">
                    Receiving Now
                  </th>
                  {!isManual && (
                    <th className="px-4 py-3 text-right font-semibold">
                      Remaining
                    </th>
                  )}
                  <th className="px-4 py-3 text-right font-semibold">
                    Unit Cost
                  </th>
                  {isDraft && canManage && (
                    <th className="px-4 py-3 text-right font-semibold">
                      Actions
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {grn.clinic_grn_items.map((item) => {
                  const remaining =
                    item.quantity_ordered != null
                      ? Number(item.quantity_ordered) -
                        Number(item.quantity_previously_received) -
                        Number(item.quantity_received)
                      : null;

                  return (
                    <tr key={item.id} className="border-t border-slate-200">
                      <td className="px-4 py-4 font-medium">
                        {item.clinic_inventory_items?.name ?? "Item"}
                        {item.batch_number && (
                          <p className="text-xs text-mineral">
                            Batch: {item.batch_number}
                          </p>
                        )}
                      </td>
                      {!isManual && (
                        <>
                          <td className="px-4 py-4 text-right">
                            {item.quantity_ordered}
                          </td>
                          <td className="px-4 py-4 text-right">
                            {item.quantity_previously_received}
                          </td>
                        </>
                      )}
                      <td className="px-4 py-4 text-right font-semibold">
                        {item.quantity_received} {item.unit}
                      </td>
                      {!isManual && (
                        <td className="px-4 py-4 text-right">{remaining}</td>
                      )}
                      <td className="px-4 py-4 text-right">{item.unit_cost}</td>
                      {isDraft && canManage && (
                        <td className="px-4 py-4">
                          <div className="flex justify-end gap-2">
                            <button
                              onClick={() => {
                                setSelectedItem(item);
                                setItemModalOpen(true);
                              }}
                              className="rounded-lg p-2 text-slate-500 hover:bg-porcelain"
                              aria-label="Edit line"
                            >
                              <Pencil size={16} />
                            </button>
                            {isManual && (
                              <button
                                onClick={() => {
                                  setRemovingItem(item);
                                  setRemoveDialogOpen(true);
                                }}
                                className="rounded-lg p-2 text-clay hover:bg-porcelain"
                                aria-label="Remove line"
                              >
                                <Trash2 size={16} />
                              </button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {clinic && procurementSettings && (
        <>
          <div className="flex justify-end gap-3 print:hidden">
            <Button variant="secondary" onClick={downloadPDF}>
              Download PDF
            </Button>
            <Button variant="secondary" onClick={() => window.print()}>
              Print
            </Button>
          </div>

          <div ref={documentRef}>
            <GRNDocument grn={grn} clinic={clinic} settings={procurementSettings} />
          </div>
        </>
      )}

      <SendDocumentModal
        open={sendModalOpen}
        supplierId={grn.supplier_id}
        defaultSubject={`GRN ${grn.grn_number} — ${clinic?.clinic_name ?? ""}`}
        defaultMessage={`Hello,\n\nGRN ${grn.grn_number} has been recorded by ${clinic?.clinic_name ?? "our clinic"}${
          grn.clinic_purchase_orders ? ` against ${grn.clinic_purchase_orders.po_number}` : ""
        }.\n\nReceived:\n${grn.clinic_grn_items
          .map(
            (item) =>
              `- ${item.clinic_inventory_items?.name ?? "Item"} — ${item.quantity_received}${
                item.quantity_ordered != null ? ` of ${item.quantity_ordered}` : ""
              } ${item.unit}`
          )
          .join("\n")}${
          grn.supplier_delivery_note
            ? `\n\nSupplier Delivery Note: ${grn.supplier_delivery_note}`
            : ""
        }\n\nThank you.`}
        onClose={() => setSendModalOpen(false)}
        onSent={handleSent}
      />

      <GRNItemModal
        open={itemModalOpen}
        item={selectedItem}
        allowItemPicker={isManual}
        onClose={() => setItemModalOpen(false)}
        onSave={handleSaveItem}
      />

      <ConfirmDialog
        open={removeDialogOpen}
        title="Remove item"
        description={
          removingItem
            ? `Remove "${removingItem.clinic_inventory_items?.name ?? "this item"}" from the GRN?`
            : undefined
        }
        confirmText="Remove"
        loading={busy}
        onCancel={() => setRemoveDialogOpen(false)}
        onConfirm={confirmRemoveItem}
      />

      <ConfirmDialog
        open={confirmDialogOpen}
        title="Confirm Received"
        description={
          "You are about to receive: " +
          itemsWithReceipt
            .map(
              (i) =>
                `${i.clinic_inventory_items?.name ?? "Item"} (+${i.quantity_received} ${i.unit})`
            )
            .join(", ") +
          ". This will update inventory and cannot be undone."
        }
        confirmText="Confirm Receipt"
        loading={busy}
        onCancel={() => setConfirmDialogOpen(false)}
        onConfirm={handleConfirmReceipt}
      />

      <ConfirmDialog
        open={cancelDialogOpen}
        title="Cancel GRN"
        description="This GRN will be marked Cancelled and will not affect inventory. This cannot be undone."
        confirmText="Cancel GRN"
        loading={busy}
        onCancel={() => setCancelDialogOpen(false)}
        onConfirm={handleCancel}
      />
    </div>
  );
}

export default function GRNDetailPage() {
  return (
    <PermissionGuard permission="procurement">
      <GRNDetailContent />
    </PermissionGuard>
  );
}
