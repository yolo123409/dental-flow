"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type Dentist = {
  id: string;
  full_name: string;
  specialty: string;
  email: string;
  phone: string;
  active: boolean;
};

export default function DentistsPage() {
  const [dentists, setDentists] = useState<Dentist[]>([]);

  const [fullName, setFullName] = useState("");
  const [specialty, setSpecialty] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");

  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadDentists();
  }, []);

  async function loadDentists() {
    const { data } = await supabase
      .from("dentists")
      .select("*")
      .order("full_name");

    setDentists(data || []);
  }

  async function addDentist() {
    if (!fullName.trim()) {
      alert("Dentist name is required.");
      return;
    }

    setLoading(true);

    const { error } = await supabase
      .from("dentists")
      .insert({
        full_name: fullName,
        specialty: specialty,
        email: email,
        phone: phone,
        active: true,
      });

    setLoading(false);

    if (error) {
      alert(error.message);
      return;
    }

    setFullName("");
    setSpecialty("");
    setEmail("");
    setPhone("");

    loadDentists();
  }

  async function toggleActive(dentist: Dentist) {
    const { error } = await supabase
      .from("dentists")
      .update({
        active: !dentist.active,
      })
      .eq("id", dentist.id);

    if (error) {
      alert(error.message);
      return;
    }

    loadDentists();
  }

  async function deleteDentist(id: string) {
    if (!confirm("Delete this dentist?")) return;

    const { error } = await supabase
      .from("dentists")
      .delete()
      .eq("id", id);

    if (error) {
      alert(error.message);
      return;
    }

    loadDentists();
  }

  return (
    <main className="min-h-screen bg-slate-100">

      <div className="mx-auto max-w-7xl px-8 py-12">

        <h1 className="text-5xl font-bold">
          Dentist Management
        </h1>

        <p className="mt-2 text-slate-600">
          Manage dentists available for appointments.
        </p>

        <div className="mt-10 rounded-2xl bg-white p-8 shadow">

          <h2 className="mb-6 text-2xl font-bold">
            Add Dentist
          </h2>

          <div className="grid gap-4 md:grid-cols-2">

            <input
              className="rounded-lg border p-3"
              placeholder="Full Name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
            />

            <input
              className="rounded-lg border p-3"
              placeholder="Specialty"
              value={specialty}
              onChange={(e) => setSpecialty(e.target.value)}
            />

            <input
              className="rounded-lg border p-3"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />

            <input
              className="rounded-lg border p-3"
              placeholder="Phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />

          </div>

          <button
            onClick={addDentist}
            disabled={loading}
            className="mt-6 rounded-xl bg-blue-600 px-8 py-3 font-semibold text-white hover:bg-blue-700"
          >
            {loading ? "Saving..." : "Add Dentist"}
          </button>

        </div>

        <div className="mt-10 rounded-2xl bg-white shadow">

          <table className="w-full">

            <thead>

              <tr className="border-b bg-slate-50">

                <th className="p-5 text-left">
                  Name
                </th>

                <th className="text-left">
                  Specialty
                </th>

                <th className="text-left">
                  Email
                </th>

                <th className="text-left">
                  Phone
                </th>

                <th className="text-left">
                  Status
                </th>

                <th className="text-left">
                  Actions
                </th>

              </tr>

            </thead>

            <tbody>

              {dentists.map((dentist) => (

                <tr
                  key={dentist.id}
                  className="border-b"
                >

                  <td className="p-5 font-semibold">
                    {dentist.full_name}
                  </td>

                  <td>
                    {dentist.specialty || "-"}
                  </td>

                  <td>
                    {dentist.email || "-"}
                  </td>

                  <td>
                    {dentist.phone || "-"}
                  </td>

                  <td>

                    <span
                      className={
                        dentist.active
                          ? "font-semibold text-green-600"
                          : "font-semibold text-red-600"
                      }
                    >
                      {dentist.active ? "Active" : "Inactive"}
                    </span>

                  </td>

                  <td className="space-x-2">

                    <button
                      onClick={() => toggleActive(dentist)}
                      className="rounded-lg bg-yellow-500 px-4 py-2 text-white hover:bg-yellow-600"
                    >
                      Toggle
                    </button>

                    <button
                      onClick={() => deleteDentist(dentist.id)}
                      className="rounded-lg bg-red-600 px-4 py-2 text-white hover:bg-red-700"
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