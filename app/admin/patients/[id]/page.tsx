"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";

import PageContainer from "@/components/ui/PageContainer";
import Card from "@/components/ui/Card";

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

import {
  Patient,
  Appointment,
  TimelineItem,
  BillingSummary as BillingSummaryType,
} from "@/types";

import DentalChart from "@/components/patients/dental/DentalChart";

export default function PatientProfilePage() {
  const params = useParams();

  const id = params.id as string;

  const [patient, setPatient] =
    useState<Patient | null>(null);

  const [appointments, setAppointments] =
    useState<Appointment[]>([]);

  const [timeline, setTimeline] =
    useState<TimelineItem[]>([]);

  const [billing, setBilling] =
    useState<BillingSummaryType>({
      total: 0,
      paid: 0,
      outstanding: 0,
    });

  const [activeTab, setActiveTab] =
    useState("Overview");

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
      ] = await Promise.all([
        getPatientProfile(id),
        getPatientAppointments(id),
        getPatientTimeline(id),
        getPatientInvoices(id),
      ]);

      setPatient(profile);
      setAppointments(history);
      setTimeline(timelineItems);
      setBilling(calculateBalance(invoices));

    } catch (error) {
      console.error(
        "Failed to load patient:",
        error
      );
    } finally {
      setLoading(false);
    }
  }, [id]);

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
      />

      <PatientTabs
        active={activeTab}
        onChange={setActiveTab}
      />

      {/* Overview */}

      {activeTab === "Overview" && (
        <BillingSummary
          total={billing.total}
          paid={billing.paid}
          outstanding={billing.outstanding}
        />
      )}

      {/* Dental Chart */}

      {activeTab === "Dental Chart" && (
        <DentalChart
          patientId={patient.id}
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

      {activeTab === "Billing" && (
        <BillingSummary
          total={billing.total}
          paid={billing.paid}
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