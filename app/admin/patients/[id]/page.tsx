"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";

import PageContainer from "@/components/ui/PageContainer";
import Card from "@/components/ui/Card";
import PermissionGuard from "@/components/auth/PermissionGuard";

import PatientProfileHeader from "@/components/patients/PatientProfileHeader";
import PatientTabs from "@/components/patients/PatientTabs";
import PatientTimeline from "@/components/patients/PatientTimeline";
import BillingSummary from "@/components/patients/BillingSummary";
import PatientNotes from "@/components/patient-notes/PatientNotes";

import {
  getPatientProfile,
  getPatientAppointments,
} from "@/services/patientProfile";

import { getPatientTimeline } from "@/services/timeline";

import {
  getPatientInvoices,
  calculateBalance,
} from "@/services/billing";

import { getClinicSettings } from "@/services/settings";
import usePermissions from "@/hooks/usePermissions";

import {
  Patient,
  Appointment,
  TimelineItem,
} from "@/types";

import DentalChart from "@/components/patients/dental/DentalChart";
import TreatmentPlansTab from "@/components/patients/treatment-plans/TreatmentPlansTab";

type BillingSummaryState = ReturnType<
  typeof calculateBalance
>;

function PatientProfilePageContent() {
  const params = useParams();
  const searchParams = useSearchParams();

  const id = params.id as string;

  // Phase I: lets Billing's "View Treatment"/"View Plan" links deep-link
  // straight into a patient's Treatment Plans tab (and a specific plan)
  // instead of always landing on Overview - read once on mount, not
  // re-synced afterward, so switching tabs in-page doesn't fight the URL.
  const initialTab = searchParams.get("tab");
  const initialPlanId = searchParams.get("plan");

  const { hasPermission } = usePermissions();
  const canViewBilling = hasPermission("billing");

  const [patient, setPatient] =
    useState<Patient | null>(null);

  const [appointments, setAppointments] =
    useState<Appointment[]>([]);

  const [timeline, setTimeline] =
    useState<TimelineItem[]>([]);

  const [billing, setBilling] =
    useState<BillingSummaryState>({
      total: 0,
      paid: 0,
      outstanding: 0,
    });

  const [currency, setCurrency] =
    useState("KES");

  const [activeTab, setActiveTab] =
    useState(initialTab || "Overview");

  const [focusTeeth, setFocusTeeth] = useState<
    number[] | null
  >(null);

  const [pendingTooth, setPendingTooth] = useState<
    number | null
  >(null);

  const [loading, setLoading] =
    useState(true);

  const loadPatient = useCallback(async () => {
    try {
      setLoading(true);

      const [
        profile,
        history,
        timelineItems,
        invoices,
        clinicSettings,
      ] = await Promise.all([
        getPatientProfile(id),
        getPatientAppointments(id),
        getPatientTimeline(id),
        // Billing is financial data - a role without the `billing`
        // permission (Dentist) never fetches or sees it here either,
        // matching that they don't see the Billing section elsewhere.
        canViewBilling ? getPatientInvoices(id) : Promise.resolve([]),
        getClinicSettings(),
      ]);

      setPatient(profile);
      setAppointments(history);
      setTimeline(timelineItems);
      setBilling(calculateBalance(invoices));
      setCurrency(clinicSettings.currency || "KES");

    } catch (error) {
      console.error(
        "Failed to load patient:",
        error
      );
    } finally {
      setLoading(false);
    }
  }, [id, canViewBilling]);

  useEffect(() => {
    loadPatient();
  }, [loadPatient]);

  if (loading) {
    return (
      <PageContainer>
        <div className="flex h-[60vh] items-center justify-center">
          <p className="text-lg text-slate-500">
            Loading patient...
          </p>
        </div>
      </PageContainer>
    );
  }

  if (!patient) {
    return (
      <PageContainer>
        <div className="flex h-[60vh] items-center justify-center">
          <p className="text-lg text-red-500">
            Patient not found.
          </p>
        </div>
      </PageContainer>
    );
  }

  return (
    <PageContainer>

      <PatientProfileHeader
        patient={patient}
        appointments={appointments}
      />

      <PatientTabs
        active={activeTab}
        onChange={setActiveTab}
        hiddenTabs={canViewBilling ? [] : ["Billing"]}
      />

      {/* Overview */}

      {activeTab === "Overview" && canViewBilling && (
        <BillingSummary
          total={billing.total}
          paid={billing.paid}
          currency={currency}
          outstanding={billing.outstanding}
        />
      )}

      {/* Dental Chart */}

      {activeTab === "Dental Chart" && (
        <DentalChart
          patientId={patient.id}
          currency={currency}
          focusTeeth={focusTeeth}
          onAddToTreatmentPlan={(tooth) => {
            setPendingTooth(tooth);
            setActiveTab("Treatment Plans");
          }}
        />
      )}

      {/* Treatment Plans */}

      {activeTab === "Treatment Plans" && (
        <TreatmentPlansTab
          patientId={patient.id}
          currency={currency}
          pendingTooth={pendingTooth}
          onPendingToothConsumed={() =>
            setPendingTooth(null)
          }
          initialPlanId={initialPlanId}
          onViewOnChart={(teeth) => {
            setFocusTeeth(teeth);
            setActiveTab("Dental Chart");
          }}
        />
      )}

      {/* Appointments */}

      {activeTab === "Appointments" && (
        <Card title="Appointment History">

          {appointments.length === 0 ? (

            <p className="text-slate-500">
              No appointments found.
            </p>

          ) : (

            <div className="space-y-4">

              {appointments.map(
                (appointment) => (

                  <div
                    key={appointment.id}
                    className="rounded-xl bg-slate-50 p-4"
                  >

                    <h3 className="font-semibold">
                      {appointment.treatment}
                    </h3>

                    <p className="mt-1 text-slate-500">
                      {appointment.appointment_date}
                    </p>

                    <p className="text-sm text-slate-600">
                      {
                        appointment
                          .dentists
                          ?.full_name
                      }
                    </p>

                  </div>

                )
              )}

            </div>

          )}

        </Card>
      )}

      {/* Billing */}

      {activeTab === "Billing" && canViewBilling && (
        <BillingSummary
          total={billing.total}
          paid={billing.paid}
          currency={currency}
          outstanding={billing.outstanding}
        />
      )}

      {/* Timeline */}

      {activeTab === "Timeline" && (
        <PatientTimeline
          items={timeline}
        />
      )}

      {/* Clinical Notes */}

      {activeTab ===
        "Clinical Notes" && (
        <PatientNotes
          patientId={patient.id}
        />
      )}

    </PageContainer>
  );
}

export default function PatientProfilePage() {
  return (
    <PermissionGuard permission="patients">
      <Suspense fallback={null}>
        <PatientProfilePageContent />
      </Suspense>
    </PermissionGuard>
  );
}