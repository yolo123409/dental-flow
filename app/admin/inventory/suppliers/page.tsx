"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";

import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import FormInput from "@/components/ui/FormInput";
import LoadingSpinner from "@/components/ui/LoadingSpinner";
import EmptyState from "@/components/ui/EmptyState";
import Badge from "@/components/ui/Badge";
import PermissionGuard from "@/components/auth/PermissionGuard";

import SupplierFormModal from "@/components/procurement/SupplierFormModal";

import usePermissions from "@/hooks/usePermissions";
import { getSuppliers } from "@/services/suppliers";
import { logError } from "@/lib/logError";

import { Supplier } from "@/types/procurement";

function SuppliersPageContent() {
  const { hasPermission } = usePermissions();
  const canManage = hasPermission("procurement_manage");

  const [loading, setLoading] = useState(true);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    try {
      setLoading(true);

      const data = await getSuppliers();

      setSuppliers(data);
    } catch (error) {
      logError("[SuppliersPage] load failed:", error);

      toast.error(
        error instanceof Error ? error.message : "Failed to load suppliers."
      );
    } finally {
      setLoading(false);
    }
  }

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();

    if (!term) return suppliers;

    return suppliers.filter(
      (supplier) =>
        supplier.name.toLowerCase().includes(term) ||
        (supplier.address ?? "").toLowerCase().includes(term)
    );
  }, [suppliers, search]);

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Suppliers</h1>
          <p className="mt-2 text-slate-500">
            Manage the supplier directory your clinic orders materials from.
          </p>
        </div>

        {canManage && (
          <Button onClick={() => setModalOpen(true)}>+ Add Supplier</Button>
        )}
      </div>

      <Card>
        <div className="mb-6 max-w-sm">
          <FormInput
            label="Search"
            placeholder="Search by name, contact, phone, or email..."
            value={search}
            onChange={setSearch}
          />
        </div>

        {loading ? (
          <LoadingSpinner text="Loading suppliers..." />
        ) : filtered.length === 0 && suppliers.length === 0 ? (
          <EmptyState
            title="No suppliers yet"
            description="Add your first supplier to start raising purchase orders."
            action={
              canManage ? (
                <Button onClick={() => setModalOpen(true)}>
                  + Add First Supplier
                </Button>
              ) : undefined
            }
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            title="No suppliers match this search"
            description="Try a different search term."
          />
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-slate-200">
            <table className="min-w-full">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-6 py-4 text-left text-sm font-semibold">
                    Supplier
                  </th>
                  <th className="px-6 py-4 text-left text-sm font-semibold">
                    Address
                  </th>
                  <th className="px-6 py-4 text-left text-sm font-semibold">
                    Status
                  </th>
                </tr>
              </thead>

              <tbody>
                {filtered.map((supplier) => (
                  <tr key={supplier.id} className="border-t border-slate-200">
                    <td className="px-6 py-5 font-medium">
                      <Link
                        href={`/admin/inventory/suppliers/${supplier.id}`}
                        className="text-eucalyptus hover:underline"
                      >
                        {supplier.name}
                      </Link>
                    </td>
                    <td className="px-6 py-5 text-slate-600">
                      {supplier.address || "-"}
                    </td>
                    <td className="px-6 py-5">
                      <Badge color={supplier.active ? "green" : "gray"}>
                        {supplier.active ? "Active" : "Inactive"}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <SupplierFormModal
        open={modalOpen}
        supplier={null}
        onClose={() => setModalOpen(false)}
        onSaved={load}
      />
    </div>
  );
}

export default function SuppliersPage() {
  return (
    <PermissionGuard permission="procurement">
      <SuppliersPageContent />
    </PermissionGuard>
  );
}
