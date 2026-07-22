"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Mail, Phone, Stethoscope } from "lucide-react";

import PageContainer from "@/components/ui/PageContainer";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import LoadingSpinner from "@/components/ui/LoadingSpinner";
import {
  getDentistById,
  getDentistCompletedTreatmentCount,
} from "@/services/dentists";
import { Dentist } from "@/types/dentist";

export default function DentistDetailsPage() {
  const params = useParams();
  const router = useRouter();
  const dentistId = String(params.id ?? "");

  const [dentist, setDentist] = useState<Dentist | null>(null);
  const [completedTreatments, setCompletedTreatments] = useState(0);
  const [loading, setLoading] = useState(true);

  const loadDentist = useCallback(async () => {
    if (!dentistId) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);

      const [dentistData, treatmentCount] = await Promise.all([
        getDentistById(dentistId),
        getDentistCompletedTreatmentCount(dentistId),
      ]);

      setDentist(dentistData);
      setCompletedTreatments(treatmentCount);
    } catch (error) {
      console.error("Failed to load dentist details:", error);
      setDentist(null);
    } finally {
      setLoading(false);
    }
  }, [dentistId]);

  useEffect(() => {
    void loadDentist();
  }, [loadDentist]);

  if (loading) {
    return <LoadingSpinner text="Loading dentist..." />;
  }

  if (!dentist) {
    return (
      <PageContainer>
        <div className="flex h-[60vh] flex-col items-center justify-center gap-4">
          <p className="text-slate-600">Dentist not found.</p>
          <Button variant="secondary" onClick={() => router.push("/admin/dentists")}>
            Back to Dentists
          </Button>
        </div>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">
            {dentist.full_name}
          </h1>
          <p className="mt-2 text-slate-500">Dentist profile and activity.</p>
        </div>

        <Button variant="secondary" onClick={() => router.push("/admin/dentists")}>
          ← Back to Dentists
        </Button>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card title="Dentist Details">
          <div className="space-y-4 text-slate-700">
            <p className="flex items-center gap-3">
              <Stethoscope size={18} />
              {dentist.specialty || "General Dentist"}
            </p>
            <p className="flex items-center gap-3">
              <Mail size={18} />
              {dentist.email || "No email recorded"}
            </p>
            <p className="flex items-center gap-3">
              <Phone size={18} />
              {dentist.phone || "No phone recorded"}
            </p>
            <p>
              Status: {dentist.active ? "Active" : "Inactive"}
            </p>
          </div>
        </Card>

        <Card title="Completed Treatments">
          <p className="text-5xl font-bold text-blue-600">
            {completedTreatments}
          </p>
          <p className="mt-3 text-slate-500">
            Completed appointments assigned to this dentist.
          </p>
        </Card>
      </div>
    </PageContainer>
  );
}
