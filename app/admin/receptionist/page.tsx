"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { getCurrentClinicId } from "@/services/clinic";

type AIReceptionist = {
  id?: string;
  clinic_name: string;
  ai_name: string;
  greeting: string;
  personality: string;
  voice: string;
  language: string;
  knowledge: string;
  emergency_enabled: boolean;
  booking_enabled: boolean;
  whatsapp_enabled: boolean;
  voice_enabled: boolean;
};

export default function ReceptionistPage() {
  const [saving, setSaving] = useState(false);

  const [config, setConfig] = useState<AIReceptionist>({
    clinic_name: "",
    ai_name: "Ava",
    greeting:
      "Hello! Thank you for calling our dental clinic. How may I help you today?",
    personality: "Professional, friendly and empathetic",
    voice: "Female",
    language: "English",
    knowledge: "",
    emergency_enabled: true,
    booking_enabled: true,
    whatsapp_enabled: false,
    voice_enabled: false,
  });

  useEffect(() => {
    loadSettings();
  }, []);

  async function loadSettings() {
    const clinicId = await getCurrentClinicId();

    const { data } = await supabase
      .from("ai_receptionists")
      .select("*")
      .eq("clinic_id", clinicId)
      .maybeSingle();

    if (data) {
      setConfig(data);
    }
  }

  async function saveSettings() {
    setSaving(true);

    const clinicId = await getCurrentClinicId();

    const { data } = await supabase
      .from("ai_receptionists")
      .select("id")
      .eq("clinic_id", clinicId)
      .maybeSingle();

    let error;

    if (data) {
      ({ error } = await supabase
        .from("ai_receptionists")
        .update(config)
        .eq("id", data.id));
    } else {
      ({ error } = await supabase
        .from("ai_receptionists")
        .insert({ ...config, clinic_id: clinicId }));
    }

    setSaving(false);

    if (error) {
      alert(error.message);
      return;
    }

    alert("AI Receptionist updated successfully.");
  }

  function update<K extends keyof AIReceptionist>(
    key: K,
    value: AIReceptionist[K]
  ) {
    setConfig((prev) => ({
      ...prev,
      [key]: value,
    }));
  }

  return (
    <main className="min-h-screen bg-slate-100">
      <div className="mx-auto max-w-6xl px-8 py-12">

        <h1 className="text-5xl font-bold">
          AI Receptionist
        </h1>

        <p className="mt-3 text-slate-600">
          Configure your clinic's AI receptionist.
        </p>

        <div className="mt-10 rounded-2xl bg-white p-8 shadow">

          <h2 className="mb-6 text-2xl font-bold">
            Clinic Information
          </h2>

          <div className="grid gap-4 md:grid-cols-2">

            <input
              className="rounded-lg border p-3"
              placeholder="Clinic Name"
              value={config.clinic_name}
              onChange={(e) =>
                update("clinic_name", e.target.value)
              }
            />

            <input
              className="rounded-lg border p-3"
              placeholder="AI Name"
              value={config.ai_name}
              onChange={(e) =>
                update("ai_name", e.target.value)
              }
            />

            <input
              className="rounded-lg border p-3"
              placeholder="Greeting"
              value={config.greeting}
              onChange={(e) =>
                update("greeting", e.target.value)
              }
            />

            <input
              className="rounded-lg border p-3"
              placeholder="Personality"
              value={config.personality}
              onChange={(e) =>
                update("personality", e.target.value)
              }
            />

            <select
              className="rounded-lg border p-3"
              value={config.voice}
              onChange={(e) =>
                update("voice", e.target.value)
              }
            >
              <option>Female</option>
              <option>Male</option>
            </select>

            <select
              className="rounded-lg border p-3"
              value={config.language}
              onChange={(e) =>
                update("language", e.target.value)
              }
            >
              <option>English</option>
              <option>Swahili</option>
            </select>

          </div>

          <h2 className="mt-10 mb-6 text-2xl font-bold">
            Knowledge Base
          </h2>

          <textarea
            rows={10}
            className="w-full rounded-lg border p-4"
            placeholder="Paste clinic services, pricing, FAQs, insurance, dentist bios and policies..."
            value={config.knowledge}
            onChange={(e) =>
              update("knowledge", e.target.value)
            }
          />

          <div className="mt-10 grid gap-4 md:grid-cols-2">

            <label className="flex items-center gap-3">

              <input
                type="checkbox"
                checked={config.booking_enabled}
                onChange={(e) =>
                  update(
                    "booking_enabled",
                    e.target.checked
                  )
                }
              />

              Appointment Booking

            </label>

            <label className="flex items-center gap-3">

              <input
                type="checkbox"
                checked={config.emergency_enabled}
                onChange={(e) =>
                  update(
                    "emergency_enabled",
                    e.target.checked
                  )
                }
              />

              Emergency Booking

            </label>

            <label className="flex items-center gap-3">

              <input
                type="checkbox"
                checked={config.whatsapp_enabled}
                onChange={(e) =>
                  update(
                    "whatsapp_enabled",
                    e.target.checked
                  )
                }
              />

              WhatsApp Assistant

            </label>

            <label className="flex items-center gap-3">

              <input
                type="checkbox"
                checked={config.voice_enabled}
                onChange={(e) =>
                  update(
                    "voice_enabled",
                    e.target.checked
                  )
                }
              />

              Voice Receptionist

            </label>

          </div>

          <button
            onClick={saveSettings}
            disabled={saving}
            className="mt-10 rounded-xl bg-blue-600 px-8 py-4 text-white font-semibold hover:bg-blue-700"
          >
            {saving ? "Saving..." : "Save Settings"}
          </button>

        </div>

      </div>
    </main>
  );
}