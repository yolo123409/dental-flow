"use client";

import { useEffect, useState } from "react";

import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";

import {
  ClinicSettings,
  getClinicSettings,
  saveClinicSettings,
  uploadClinicLogo,
} from "@/services/settings";

export default function SettingsPage() {
  const [loading, setLoading] =
    useState(true);

  const [saving, setSaving] =
    useState(false);

  const [settings, setSettings] =
    useState<ClinicSettings | null>(
      null
    );

  useEffect(() => {
    loadSettings();
  }, []);

  async function loadSettings() {
    try {
      setLoading(true);

      const result =
        await getClinicSettings();

      setSettings(result);
    } catch (error) {
      console.error(error);

      if (error instanceof Error) {
        alert(error.message);
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    if (!settings) return;

    try {
      setSaving(true);

      const updated =
        await saveClinicSettings(
          settings
        );

      setSettings(updated);

      alert("Settings saved.");
    } catch (error) {
      console.error(error);

      if (error instanceof Error) {
        alert(error.message);
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleLogoUpload(
    file: File
  ) {
    try {
      const logoUrl =
        await uploadClinicLogo(file);

      setSettings((current) =>
        current
          ? {
              ...current,
              logo_url: logoUrl,
            }
          : current
      );
    } catch (error) {
      console.error(error);

      if (error instanceof Error) {
        alert(error.message);
      }
    }
  }

  if (loading || !settings) {
    return (
      <div className="py-24 text-center">
        Loading settings...
      </div>
    );
  }

  return (
    <div className="space-y-8">

      <div>

        <h1 className="text-3xl font-bold">
          Clinic Settings
        </h1>

        <p className="mt-2 text-slate-500">
          Configure your clinic's
          branding and contact
          information.
        </p>

      </div>

      <Card title="Clinic Profile">

        <div className="grid gap-6 lg:grid-cols-2">

          <div className="space-y-4">

            <label className="block">

              <span className="mb-1 block text-sm font-medium">
                Clinic Name
              </span>

              <input
                className="w-full rounded-lg border p-3"
                value={
                  settings.clinic_name
                }
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    clinic_name:
                      e.target.value,
                  })
                }
              />

            </label>

            <label className="block">

              <span className="mb-1 block text-sm font-medium">
                Phone
              </span>

              <input
                className="w-full rounded-lg border p-3"
                value={
                  settings.phone ?? ""
                }
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    phone:
                      e.target.value,
                  })
                }
              />

            </label>

            <label className="block">

              <span className="mb-1 block text-sm font-medium">
                Email
              </span>

              <input
                className="w-full rounded-lg border p-3"
                value={
                  settings.email ?? ""
                }
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    email:
                      e.target.value,
                  })
                }
              />

            </label>

            <label className="block">

              <span className="mb-1 block text-sm font-medium">
                Website
              </span>

              <input
                className="w-full rounded-lg border p-3"
                value={
                  settings.website ??
                  ""
                }
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    website:
                      e.target.value,
                  })
                }
              />

            </label>

          </div>

          <div className="space-y-4">

            <label className="block">

              <span className="mb-1 block text-sm font-medium">
                Address Line 1
              </span>

              <input
                className="w-full rounded-lg border p-3"
                value={
                  settings.address_line_1 ??
                  ""
                }
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    address_line_1:
                      e.target.value,
                  })
                }
              />

            </label>

            <label className="block">

              <span className="mb-1 block text-sm font-medium">
                Address Line 2
              </span>

              <input
                className="w-full rounded-lg border p-3"
                value={
                  settings.address_line_2 ??
                  ""
                }
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    address_line_2:
                      e.target.value,
                  })
                }
              />

            </label>

            <label className="block">

              <span className="mb-1 block text-sm font-medium">
                City
              </span>

              <input
                className="w-full rounded-lg border p-3"
                value={
                  settings.city ?? ""
                }
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    city:
                      e.target.value,
                  })
                }
              />

            </label>

            <label className="block">

              <span className="mb-1 block text-sm font-medium">
                Country
              </span>

              <input
                className="w-full rounded-lg border p-3"
                value={
                  settings.country ??
                  ""
                }
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    country:
                      e.target.value,
                  })
                }
              />

            </label>

          </div>

        </div>

        <div className="mt-8 border-t pt-6">

          <label className="block">

            <span className="mb-2 block text-sm font-medium">
              Clinic Logo
            </span>

            {settings.logo_url && (
              <img
                src={settings.logo_url}
                alt="Clinic Logo"
                className="mb-4 h-24 w-24 rounded-lg border object-contain"
              />
            )}

            <input
              type="file"
              accept="image/*"
              onChange={(e) => {
                const file =
                  e.target.files?.[0];

                if (file) {
                  handleLogoUpload(
                    file
                  );
                }
              }}
            />

          </label>

        </div>

        <div className="mt-8 flex justify-end">

          <Button
            onClick={handleSave}
            disabled={saving}
          >
            {saving
              ? "Saving..."
              : "Save Settings"}
          </Button>

        </div>

      </Card>

    </div>
  );
}