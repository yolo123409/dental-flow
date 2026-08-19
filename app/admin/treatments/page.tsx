"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import FormInput from "@/components/ui/FormInput";
import LoadingSpinner from "@/components/ui/LoadingSpinner";
import EmptyState from "@/components/ui/EmptyState";
import ConfirmDialog from "@/components/ui/ConfirmDialog";

import {
  ClinicTreatment,
  getTreatments,
  deleteTreatment,
} from "@/services/treatments";

import { getClinicSettings } from "@/services/settings";

import TreatmentModal from "@/components/treatments/TreatmentModal";
import PermissionGuard from "@/components/auth/PermissionGuard";

function TreatmentsPageContent() {
  const [loading, setLoading] =
    useState(true);

  const [search, setSearch] =
    useState("");

  const [treatments, setTreatments] =
    useState<ClinicTreatment[]>([]);

    const [modalOpen, setModalOpen] =
  useState(false);

const [selectedTreatment, setSelectedTreatment] =
  useState<ClinicTreatment | null>(
    null
  );

const [deleting, setDeleting] =
  useState(false);

  const [currency, setCurrency] =
    useState("KES");

  const [showDeleteDialog, setShowDeleteDialog] =
    useState(false);

  useEffect(() => {
    loadTreatments();
  }, []);

  async function loadTreatments() {
    try {
      setLoading(true);

      const [data, clinicSettings] =
        await Promise.all([
          getTreatments(),
          getClinicSettings(),
        ]);

      setTreatments(data);
      setCurrency(
        clinicSettings.currency || "KES"
      );
    } catch (error) {
      console.error(error);

      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to load treatments."
      );
    } finally {
      setLoading(false);
    }
  }

  function handleCreate() {
  setSelectedTreatment(null);

  setModalOpen(true);
}

function handleEdit(
  treatment: ClinicTreatment
) {
  setSelectedTreatment(
    treatment
  );

  setModalOpen(true);
}

  function handleDelete(
    treatment: ClinicTreatment
  ) {
    setSelectedTreatment(treatment);
    setShowDeleteDialog(true);
  }

  async function confirmDelete() {
    if (!selectedTreatment) return;

    try {
      setDeleting(true);

      await deleteTreatment(
        selectedTreatment.id
      );

      await loadTreatments();

      setShowDeleteDialog(false);
      setSelectedTreatment(null);
    } catch (error) {
      console.error(error);

      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to delete treatment."
      );
    } finally {
      setDeleting(false);
    }
  }

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount);

  const filtered =
    treatments.filter((treatment) => {
      const term =
        search.toLowerCase();

      return (
        treatment.name
          .toLowerCase()
          .includes(term) ||
        treatment.category
          .toLowerCase()
          .includes(term)
      );
    });

  return (
    <div className="space-y-8">

      <div className="flex items-center justify-between">

        <div>

          <h1 className="text-3xl font-bold">
            Treatments
          </h1>

          <p className="mt-2 text-slate-500">
            Manage your clinic&apos;s
            treatment catalogue.
          </p>

        </div>

        <Button
  onClick={
    handleCreate
  }
>
  + Add Treatment
</Button>

      </div>

      <Card>

        <div className="mb-6">

          <FormInput
            label="Search"
            placeholder="Search treatments..."
            value={search}
            onChange={setSearch}
          />

        </div>

        {loading ? (

          <LoadingSpinner text="Loading treatments..." />

        ) : filtered.length === 0 ? (

          <EmptyState
            title="No treatments found"
            description={
              'Click "Add Treatment" to create your first treatment.'
            }
          />

        ) : (

          <div className="overflow-hidden rounded-2xl border border-slate-200">

            <table className="min-w-full">

              <thead className="bg-slate-50">

                <tr>

                  <th className="px-6 py-4 text-left text-sm font-semibold">
                    Treatment
                  </th>

                  <th className="px-6 py-4 text-left text-sm font-semibold">
                    Category
                  </th>

                  <th className="px-6 py-4 text-right text-sm font-semibold">
                    Default Price
                  </th>

                  <th className="w-20"></th>

                </tr>

              </thead>

              <tbody>

                {filtered.map(
                  (
                    treatment
                  ) => (
                    <tr
                      key={
                        treatment.id
                      }
                      className="border-t border-slate-200"
                    >

                      <td className="px-6 py-5 font-medium">
                        {
                          treatment.name
                        }
                      </td>

                      <td className="px-6 py-5 text-slate-600">
                        {
                          treatment.category
                        }
                      </td>

                      <td className="px-6 py-5 text-right font-semibold">
                        {formatCurrency(
                          Number(treatment.default_price)
                        )}
                      </td>

                      <td className="px-6 py-5 text-center">

                        <div className="flex justify-end gap-2">

  <Button
    variant="secondary"
    className="px-3 py-2"
    onClick={() =>
      handleEdit(
        treatment
      )
    }
  >
    Edit
  </Button>

  <Button
    variant="danger"
    className="px-3 py-2"
    disabled={deleting}
    onClick={() =>
      handleDelete(
        treatment
      )
    }
  >
    Delete
  </Button>

</div>

                      </td>

                    </tr>
                  )
                )}

              </tbody>

            </table>

          </div>

        )}

      </Card>

      <TreatmentModal
  open={modalOpen}
  treatment={
    selectedTreatment
  }
  onClose={() =>
    setModalOpen(false)
  }
  onSaved={
    loadTreatments
  }
/>

      <ConfirmDialog
        open={showDeleteDialog}
        title="Delete treatment"
        description={
          selectedTreatment
            ? `Delete "${selectedTreatment.name}"? This cannot be undone.`
            : undefined
        }
        confirmText="Delete"
        loading={deleting}
        onCancel={() =>
          setShowDeleteDialog(false)
        }
        onConfirm={confirmDelete}
      />

    </div>
  );
}

export default function TreatmentsPage() {
  return (
    <PermissionGuard permission="patients">
      <TreatmentsPageContent />
    </PermissionGuard>
  );
}