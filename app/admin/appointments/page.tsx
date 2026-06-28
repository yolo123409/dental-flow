"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type Dentist = {
  id: string;
  full_name: string;
};

type Appointment = {
  id: string;
  patient_name: string;
  patient_email: string;
  patient_phone: string;
  appointment_date: string;
  appointment_time: string;
  treatment: string;
  status: string;
  dentist_id: string | null;
  dentists: Dentist | null;
};

export default function AppointmentsPage() {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [dentists, setDentists] = useState<Dentist[]>([]);

  const [patientName, setPatientName] = useState("");
  const [patientEmail, setPatientEmail] = useState("");
  const [patientPhone, setPatientPhone] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [treatment, setTreatment] = useState("");
  const [dentistId, setDentistId] = useState("");

  useEffect(() => {
    loadDentists();
    loadAppointments();
  }, []);

  async function loadDentists() {
    const { data } = await supabase
      .from("dentists")
      .select("id, full_name")
      .eq("active", true)
      .order("full_name");

    setDentists(data || []);
  }

  async function loadAppointments() {
    const { data } = await supabase
      .from("appointments")
      .select(`
        *,
        dentists (
          id,
          full_name
        )
      `)
      .order("appointment_date")
      .order("appointment_time");

    setAppointments((data as Appointment[]) || []);
  }

  async function createAppointment() {
    if (!patientName || !date || !time) {
      alert("Patient name, date and time are required.");
      return;
    }

    const { error } = await supabase
      .from("appointments")
      .insert({
        patient_name: patientName,
        patient_email: patientEmail,
        patient_phone: patientPhone,
        appointment_date: date,
        appointment_time: time,
        treatment: treatment,
        dentist_id: dentistId || null,
      });

    if (error) {
      alert(error.message);
      return;
    }

    setPatientName("");
    setPatientEmail("");
    setPatientPhone("");
    setDate("");
    setTime("");
    setTreatment("");
    setDentistId("");

    loadAppointments();
  }

  async function updateStatus(id: string, status: string) {
    await supabase
      .from("appointments")
      .update({ status })
      .eq("id", id);

    loadAppointments();
  }

  async function deleteAppointment(id: string) {
    if (!confirm("Delete appointment?")) return;

    await supabase
      .from("appointments")
      .delete()
      .eq("id", id);

    loadAppointments();
  }

  return (
    <main className="min-h-screen bg-slate-100">
      <div className="mx-auto max-w-7xl px-8 py-12">

        <h1 className="text-5xl font-bold">
          Appointment Manager
        </h1>

        <p className="mt-2 text-slate-600">
          Manage all clinic appointments.
        </p>

        <div className="mt-10 rounded-2xl bg-white p-8 shadow">

          <h2 className="mb-6 text-2xl font-bold">
            New Appointment
          </h2>

          <div className="grid gap-4 md:grid-cols-2">

            <input
              className="rounded-lg border p-3"
              placeholder="Patient Name"
              value={patientName}
              onChange={(e) => setPatientName(e.target.value)}
            />

            <input
              className="rounded-lg border p-3"
              placeholder="Patient Email"
              value={patientEmail}
              onChange={(e) => setPatientEmail(e.target.value)}
            />

            <input
              className="rounded-lg border p-3"
              placeholder="Patient Phone"
              value={patientPhone}
              onChange={(e) => setPatientPhone(e.target.value)}
            />

            <input
              className="rounded-lg border p-3"
              placeholder="Treatment"
              value={treatment}
              onChange={(e) => setTreatment(e.target.value)}
            />

            <input
              className="rounded-lg border p-3"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />

            <input
              className="rounded-lg border p-3"
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
            />

            <select
              className="rounded-lg border p-3 md:col-span-2"
              value={dentistId}
              onChange={(e) => setDentistId(e.target.value)}
            >
              <option value="">Assign Dentist</option>

              {dentists.map((dentist) => (
                <option
                  key={dentist.id}
                  value={dentist.id}
                >
                  {dentist.full_name}
                </option>
              ))}

            </select>

          </div>

          <button
            onClick={createAppointment}
            className="mt-6 rounded-xl bg-blue-600 px-8 py-3 text-white hover:bg-blue-700"
          >
            Create Appointment
          </button>

        </div>

        <div className="mt-10 rounded-2xl bg-white shadow overflow-x-auto">

          <table className="w-full">

            <thead>

              <tr className="border-b bg-slate-50">

                <th className="p-4 text-left">Patient</th>
                <th className="text-left">Dentist</th>
                <th className="text-left">Date</th>
                <th className="text-left">Time</th>
                <th className="text-left">Treatment</th>
                <th className="text-left">Status</th>
                <th className="text-left">Actions</th>

              </tr>

            </thead>

            <tbody>

              {appointments.map((appointment) => (

                <tr
                  key={appointment.id}
                  className="border-b"
                >

                  <td className="p-4">
                    {appointment.patient_name}
                  </td>

                  <td>
                    {appointment.dentists?.full_name || "-"}
                  </td>

                  <td>
                    {appointment.appointment_date}
                  </td>

                  <td>
                    {appointment.appointment_time}
                  </td>

                  <td>
                    {appointment.treatment || "-"}
                  </td>

                  <td>

                    <select
                      value={appointment.status}
                      onChange={(e) =>
                        updateStatus(
                          appointment.id,
                          e.target.value
                        )
                      }
                      className="rounded border p-2"
                    >
                      <option>Booked</option>
                      <option>Confirmed</option>
                      <option>Completed</option>
                      <option>Cancelled</option>
                    </select>

                  </td>

                  <td>

                    <button
                      onClick={() =>
                        deleteAppointment(
                          appointment.id
                        )
                      }
                      className="rounded bg-red-600 px-4 py-2 text-white hover:bg-red-700"
                    >
                      Delete
                    </button>

                  </td>

                </tr>

              ))}

            </tbody>

          </table>

        </div>

      </div>
    </main>
  );
}