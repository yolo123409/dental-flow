"use client";

import { useEffect, useState } from "react";

import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import FormInput from "@/components/ui/FormInput";

import {
  ClinicTreatment,
  getClinicTreatments,
} from "@/services/clinicTreatments";

export default function TreatmentCataloguePage() {
  const [treatments, setTreatments] =
    useState<ClinicTreatment[]>([]);

  const [loading, setLoading] =
    useState(true);

  // Temporary until clinic context is added
  const clinicId = "YOUR_CLINIC_ID";

  useEffect(() => {
    loadTreatments();
  }, []);

  async function loadTreatments() {
    try {
      const data =
        await getClinicTreatments(
          clinicId
        );

      setTreatments(data);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">

      <Card title="Treatment Catalogue">

        <div className="mb-6 flex items-center justify-between">

          <div>

            <h2 className="text-xl font-semibold">
              Treatments
            </h2>

            <p className="text-sm text-slate-500">
              Manage your clinic's
              treatments and default
              prices.
            </p>

          </div>

          <Button>
            + Add Treatment
          </Button>

        </div>

        {loading ? (

          <div className="py-10 text-center text-slate-500">
            Loading...
          </div>

        ) : treatments.length === 0 ? (

          <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-10 text-center">

            <div className="text-5xl">
              🦷
            </div>

            <h3 className="mt-4 text-lg font-semibold">
              No Treatments Yet
            </h3>

            <p className="mt-2 text-slate-500">
              Add your first treatment to
              begin using automatic
              pricing.
            </p>

          </div>

        ) : (

          <div className="space-y-3">

            {treatments.map(
              (treatment) => (

                <div
                  key={treatment.id}
                  className="flex items-center justify-between rounded-xl border border-slate-200 p-4"
                >

                  <div>

                    <h3 className="font-semibold">
                      {
                        treatment.treatment_name
                      }
                    </h3>

                  </div>

                  <div className="font-semibold text-emerald-600">
                    KES{" "}
                    {Number(
                      treatment.default_price
                    ).toLocaleString()}
                  </div>

                </div>

              )
            )}

          </div>

        )}

      </Card>

    </div>
  );
}