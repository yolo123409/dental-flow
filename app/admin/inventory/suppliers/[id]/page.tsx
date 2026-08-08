"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Star } from "lucide-react";

import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import LoadingSpinner from "@/components/ui/LoadingSpinner";
import EmptyState from "@/components/ui/EmptyState";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import PermissionGuard from "@/components/auth/PermissionGuard";

import SupplierFormModal from "@/components/procurement/SupplierFormModal";
import SupplierContactFormModal from "@/components/procurement/SupplierContactFormModal";
import POStatusBadge from "@/components/procurement/POStatusBadge";
import GRNStatusBadge from "@/components/procurement/GRNStatusBadge";

import usePermissions from "@/hooks/usePermissions";
import { getPurchaseOrders } from "@/services/purchaseOrders";
import { getGRNs } from "@/services/grns";
import {
  getSupplier,
  archiveSupplier,
  reactivateSupplier,
  archiveSupplierContact,
  setPrimaryContact,
} from "@/services/suppliers";
import { logError } from "@/lib/logError";

import {
  SupplierWithContacts,
  SupplierContact,
  PurchaseOrder,
  GRN,
} from "@/types/procurement";

function SupplierDetailContent() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const { hasPermission } = usePermissions();
  const canManage = hasPermission("procurement_manage");

  const [loading, setLoading] = useState(true);
  const [supplier, setSupplier] = useState<SupplierWithContacts | null>(null);
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [grns, setGrns] = useState<GRN[]>([]);

  const [supplierModalOpen, setSupplierModalOpen] = useState(false);
  const [contactModalOpen, setContactModalOpen] = useState(false);
  const [selectedContact, setSelectedContact] =
    useState<SupplierContact | null>(null);

  const [archiveDialogOpen, setArchiveDialogOpen] = useState(false);
  const [archivingContact, setArchivingContact] =
    useState<SupplierContact | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    load();
  }, [id]);

  async function load() {
    try {
      setLoading(true);

      const [data, orderData, grnData] = await Promise.all([
        getSupplier(id),
        getPurchaseOrders({ supplierId: id }),
        getGRNs({ supplierId: id }),
      ]);

      setSupplier(data);
      setOrders(orderData);
      setGrns(grnData);
    } catch (error) {
      logError("[SupplierDetail] load failed:", error);

      toast.error(
        error instanceof Error ? error.message : "Failed to load supplier."
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleToggleActive() {
    if (!supplier) return;

    try {
      setBusy(true);

      if (supplier.active) {
        await archiveSupplier(supplier.id);
        toast.success("Supplier archived.");
      } else {
        await reactivateSupplier(supplier.id);
        toast.success("Supplier reactivated.");
      }

      await load();
    } catch (error) {
      logError("[SupplierDetail] toggle active failed:", error);

      toast.error(
        error instanceof Error ? error.message : "Failed to update supplier."
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleSetPrimary(contact: SupplierContact) {
    if (!supplier) return;

    try {
      await setPrimaryContact(supplier.id, contact.id);

      toast.success(`${contact.name} is now the primary contact.`);

      await load();
    } catch (error) {
      logError("[SupplierDetail] setPrimaryContact failed:", error);

      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to set primary contact."
      );
    }
  }

  async function confirmArchiveContact() {
    if (!archivingContact) return;

    try {
      setBusy(true);

      await archiveSupplierContact(archivingContact.id);

      toast.success("Contact archived.");

      setArchiveDialogOpen(false);
      setArchivingContact(null);

      await load();
    } catch (error) {
      logError("[SupplierDetail] archiveSupplierContact failed:", error);

      toast.error(
        error instanceof Error ? error.message : "Failed to archive contact."
      );
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <LoadingSpinner text="Loading supplier..." />;
  }

  if (!supplier) {
    return (
      <EmptyState
        title="Supplier not found"
        description="This supplier may have been removed."
      />
    );
  }

  const activeContacts = supplier.clinic_supplier_contacts.filter(
    (c) => c.active
  );

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <button
            onClick={() => router.push("/admin/inventory/suppliers")}
            className="mb-2 text-sm font-semibold text-eucalyptus hover:underline"
          >
            ← Back to Suppliers
          </button>

          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold">{supplier.name}</h1>
            <Badge color={supplier.active ? "green" : "gray"}>
              {supplier.active ? "Active" : "Inactive"}
            </Badge>
          </div>
        </div>

        {canManage && (
          <div className="flex gap-3">
            <Button variant="secondary" onClick={() => setSupplierModalOpen(true)}>
              Edit
            </Button>
            <Button
              variant={supplier.active ? "danger" : "secondary"}
              disabled={busy}
              onClick={handleToggleActive}
            >
              {supplier.active ? "Archive" : "Reactivate"}
            </Button>
          </div>
        )}
      </div>

      <Card title="Supplier Information">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-mineral">
              Address
            </p>
            <p className="mt-1 text-graphite">{supplier.address || "-"}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-mineral">
              Notes
            </p>
            <p className="mt-1 text-graphite">{supplier.notes || "-"}</p>
          </div>
        </div>
      </Card>

      <Card title="Contacts">
        <div className="mb-4 flex justify-end">
          {canManage && (
            <Button
              variant="secondary"
              onClick={() => {
                setSelectedContact(null);
                setContactModalOpen(true);
              }}
            >
              + Add Another Contact
            </Button>
          )}
        </div>

        {activeContacts.length === 0 ? (
          <p className="py-6 text-center text-sm text-mineral">
            No contacts added yet.
          </p>
        ) : (
          <div className="space-y-3">
            {activeContacts.map((contact) => (
              <div
                key={contact.id}
                className="flex flex-col gap-3 rounded-lg border border-sea-glass px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-graphite">
                      {contact.name}
                    </p>
                    {contact.is_primary && (
                      <span className="flex items-center gap-1 text-xs font-bold text-amber-600">
                        <Star size={12} fill="currentColor" /> PRIMARY
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-mineral">
                    {[contact.job_title, contact.department]
                      .filter(Boolean)
                      .join(" · ") || "-"}
                  </p>
                  <p className="mt-1 text-sm text-slate-600">
                    {[contact.phone, contact.whatsapp_number, contact.email]
                      .filter(Boolean)
                      .join(" · ") || "No contact details"}
                  </p>
                </div>

                {canManage && (
                  <div className="flex flex-wrap gap-2">
                    {!contact.is_primary && (
                      <Button
                        variant="secondary"
                        className="px-3 py-2 text-xs"
                        onClick={() => handleSetPrimary(contact)}
                      >
                        Make Primary
                      </Button>
                    )}
                    <Button
                      variant="secondary"
                      className="px-3 py-2 text-xs"
                      onClick={() => {
                        setSelectedContact(contact);
                        setContactModalOpen(true);
                      }}
                    >
                      Edit
                    </Button>
                    <Button
                      variant="danger"
                      className="px-3 py-2 text-xs"
                      onClick={() => {
                        setArchivingContact(contact);
                        setArchiveDialogOpen(true);
                      }}
                    >
                      Archive
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title="Purchase Orders">
        {orders.length === 0 ? (
          <p className="py-6 text-center text-sm text-mineral">
            No purchase orders yet.
          </p>
        ) : (
          <div className="space-y-2">
            {orders.map((po) => (
              <div
                key={po.id}
                className="flex items-center justify-between rounded-lg border border-sea-glass px-4 py-3 text-sm"
              >
                <Link
                  href={`/admin/inventory/purchase-orders/${po.id}`}
                  className="font-semibold text-eucalyptus hover:underline"
                >
                  {po.po_number}
                </Link>
                <POStatusBadge status={po.status} />
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title="Goods Received Notes">
        {grns.length === 0 ? (
          <p className="py-6 text-center text-sm text-mineral">
            No goods received notes yet.
          </p>
        ) : (
          <div className="space-y-2">
            {grns.map((grn) => (
              <div
                key={grn.id}
                className="flex items-center justify-between rounded-lg border border-sea-glass px-4 py-3 text-sm"
              >
                <Link
                  href={`/admin/inventory/grns/${grn.id}`}
                  className="font-semibold text-eucalyptus hover:underline"
                >
                  {grn.grn_number}
                </Link>
                <GRNStatusBadge status={grn.status} />
              </div>
            ))}
          </div>
        )}
      </Card>

      <SupplierFormModal
        open={supplierModalOpen}
        supplier={supplier}
        onClose={() => setSupplierModalOpen(false)}
        onSaved={load}
      />

      <SupplierContactFormModal
        open={contactModalOpen}
        supplierId={supplier.id}
        contact={selectedContact}
        onClose={() => setContactModalOpen(false)}
        onSaved={load}
      />

      <ConfirmDialog
        open={archiveDialogOpen}
        title="Archive contact"
        description={
          archivingContact
            ? `Archive "${archivingContact.name}"? They will no longer appear as a contact option.`
            : undefined
        }
        confirmText="Archive"
        loading={busy}
        onCancel={() => setArchiveDialogOpen(false)}
        onConfirm={confirmArchiveContact}
      />
    </div>
  );
}

export default function SupplierDetailPage() {
  return (
    <PermissionGuard permission="procurement">
      <SupplierDetailContent />
    </PermissionGuard>
  );
}
