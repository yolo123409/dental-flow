"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

import PageContainer from "@/components/ui/PageContainer";
import Card from "@/components/ui/Card";

import PatientTimeline from "@/components/patients/PatientTimeline";

import {
  getPatientProfile,
  getPatientAppointments,
} from "@/services/patientProfile";

import {
  getPatientTimeline,
} from "@/services/timeline";

export default function PatientProfilePage() {
  const params = useParams();

  const id = params.id as string;

  const [patient, setPatient] = useState<any>(null);

  const [appointments, setAppointments] = useState<any[]>([]);

  const [timeline, setTimeline] = useState<any[]>([]);

  const [loading, setLoading] = useState(true);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    try {
      setLoading(true);

      const profile = await getPatientProfile(id);

      const history = await getPatientAppointments(id);

      const timelineItems =
        await getPatientTimeline(id);

      setPatient(profile);

      setAppointments(history);

      setTimeline(timelineItems);

    } catch (error) {
      console.error("Failed to load patient:", error);
    } finally {
      setLoading(false);
    }
  }

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

      {/* Patient Profile */}

      <Card>

        <div className="flex items-center justify-between">

          <div>

            <h1 className="text-4xl font-bold">

              {patient.first_name} {patient.last_name}

            </h1>

            <p className="mt-4">

              📞 {patient.phone || "No phone"}

            </p>

            <p>

              📧 {patient.email || "No email"}

            </p>

          </div>

        </div>

      </Card>

      {/* Appointment History */}

      <Card title="Appointment History">

        {appointments.length === 0 ? (

          <p className="text-slate-500">
            No appointments found.
          </p>

        ) : (

          <div className="space-y-4">

            {appointments.map((appointment) => (

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

                  {appointment.dentists?.full_name}

                </p>

              </div>

            ))}

          </div>

        )}

      </Card>

      {/* Patient Timeline */}

      <PatientTimeline
        items={timeline}
      />

    </PageContainer>
  );
}