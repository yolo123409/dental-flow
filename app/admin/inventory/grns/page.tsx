"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import LoadingSpinner from "@/components/ui/LoadingSpinner";
import EmptyState from "@/components/ui/EmptyState";
import PermissionGuard from "@/components/auth/PermissionGuard";

import GRNStatusBadge from "@/components/procurement/GRNStatusBadge";
import NewGRNModal from "@/components/procurement/NewGRNModal";

import usePermissions from "@/hooks/usePermissions";
import { getGRNs } from "@/services/grns";
import { logError } from "@/lib/logError";

import { GRN, GRNStatus } from "@/types/procurement";

const STATUS_FILTERS: ("All" | GRNStatus)[] = [
  "All",
  "Draft",
  "Received",
  "Cancelled",
];

function GRNsPageContent() {
  const router = useRouter();
  const { hasPermission } = usePermissions();
  const canManage = hasPermission("procurement_manage");

  const [loading, setLoading] = useState(true);
  const [grns, setGrns] = useState<GRN[]>([]);
  const [statusFilter, setStatusFilter] = useState<"All" | GRNStatus>("All");
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    load();
  }, [statusFilter]);

  async function load() {
    try {
      setLoading(true);

      const data = await getGRNs(
        statusFilter === "All" ? {} : { status: statusFilter }
      );

      setGrns(data);
    } catch (error) {
      logError("[GRNsPage] load failed:", error);

      toast.error(
        error instanceof Error ? error.message : "Failed to load GRNs."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Goods Received Notes</h1>
          <p className="mt-2 text-slate-500">
            Record what your clinic actually received from suppliers.
          </p>
        </div>

        {canManage && (
          <Button onClick={() => setModalOpen(true)}>+ New GRN</Button>
        )}
      </div>

      <Card>
        <div className="mb-6 flex flex-wrap gap-2">
          {STATUS_FILTERS.map((status) => (
            <Button
              key={status}
              variant={statusFilter === status ? "primary" : "secondary"}
              className="px-3 py-2 text-xs"
              onClick={() => setStatusFilter(status)}
            >
              {status}
            </Button>
          ))}
        </div>

        {loading ? (
          <LoadingSpinner text="Loading GRNs..." />
        ) : grns.length === 0 ? (
          <EmptyState
            title="No goods received notes"
            description="Create a GRN when goods arrive from a supplier."
            action={
              canManage ? (
                <Button onClick={() => setModalOpen(true)}>+ New GRN</Button>
              ) : undefined
            }
          />
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-slate-200">
            <table className="min-w-full">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-6 py-4 text-left text-sm font-semibold">
                    GRN Number
                  </th>
                  <th className="px-6 py-4 text-left text-sm font-semibold">
                    PO Number
                  </th>
                  <th className="px-6 py-4 text-left text-sm font-semibold">
                    Supplier
                  </th>
                  <th className="px-6 py-4 text-left text-sm font-semibold">
                    Date Received
                  </th>
                  <th className="px-6 py-4 text-left text-sm font-semibold">
                    Status
                  </th>
                </tr>
              </thead>

              <tbody>
                {grns.map((grn) => (
                  <tr key={grn.id} className="border-t border-slate-200">
                    <td className="px-6 py-5 font-medium">
                      <Link
                        href={`/admin/inventory/grns/${grn.id}`}
                        className="text-eucalyptus hover:underline"
                      >
                        {grn.grn_number}
                      </Link>
                    </td>
                    <td className="px-6 py-5 text-slate-600">
                      {grn.clinic_purchase_orders?.po_number ?? "Manual"}
                    </td>
                    <td className="px-6 py-5 text-slate-600">
                      {grn.clinic_suppliers?.name ?? "-"}
                    </td>
                    <td className="px-6 py-5 text-slate-600">
                      {new Date(grn.date_received).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-5">
                      <GRNStatusBadge status={grn.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <NewGRNModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={(id) => router.push(`/admin/inventory/grns/${id}`)}
      />
    </div>
  );
}

export default function GRNsPage() {
  return (
    <PermissionGuard permission="procurement">
      <GRNsPageContent />
    </PermissionGuard>
  );
}
