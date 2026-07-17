"use client";

import { useEffect, useState } from "react";

import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import FormInput from "@/components/ui/FormInput";

import {
  ClinicTreatment,
  getTreatments,
  deleteTreatment,
} from "@/services/treatments";

import TreatmentModal from "@/components/treatments/TreatmentModal";

export default function TreatmentsPage() {
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

  useEffect(() => {
    loadTreatments();
  }, []);

  async function loadTreatments() {
    try {
      setLoading(true);

      const data =
        await getTreatments();

      setTreatments(data);
    } catch (error) {
  console.error(error);

  if (error instanceof Error) {
    alert(error.message);
  }
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

async function handleDelete(
  treatment: ClinicTreatment
) {
  const confirmed =
    confirm(
      `Delete "${treatment.name}"?`
    );

  if (!confirmed) {
    return;
  }

  try {
    setDeleting(true);

    await deleteTreatment(
      treatment.id
    );

    await loadTreatments();
  } catch (error) {
    console.error(error);

    if (
      error instanceof Error
    ) {
      alert(error.message);
    }
  } finally {
    setDeleting(false);
  }
}

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
            Manage your clinic's
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

          <div className="py-20 text-center text-slate-500">
            Loading treatments...
          </div>

        ) : filtered.length === 0 ? (

          <div className="rounded-2xl border border-dashed border-slate-300 py-20 text-center">

            <p className="text-lg font-semibold">
              No treatments found
            </p>

            <p className="mt-2 text-slate-500">
              Click "Add Treatment"
              to create your first
              treatment.
            </p>

          </div>

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
                        KES{" "}
                        {Number(
                          treatment.default_price
                        ).toLocaleString()}
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

    </div>
  );
}