"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import FormInput from "@/components/ui/FormInput";
import FormTextarea from "@/components/ui/FormTextarea";
import PermissionGuard from "@/components/auth/PermissionGuard";

import {
  ClinicSettings,
  getClinicSettings,
  saveClinicSettings,
  uploadClinicLogo,
} from "@/services/settings";

function SettingsPageContent() {
  const [loading, setLoading] =
    useState(true);

  const [saving, setSaving] =
    useState(false);

  const [settings, setSettings] =
    useState<ClinicSettings | null>(
      null
    );

  async function loadSettings() {
    try {
      setLoading(true);

      const result =
        await getClinicSettings();

      setSettings(result);
    } catch (error) {
      console.error(error);

      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to load settings."
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadSettings();
  }, []);

  function validateTaxSettings(
    current: ClinicSettings
  ): string | null {
    if (!current.tax_enabled) return null;

    if (!current.tax_name.trim()) {
      return "Tax name is required when tax is enabled.";
    }

    const rate = Number(current.tax_rate);

    if (
      Number.isNaN(rate) ||
      rate < 0 ||
      rate > 100
    ) {
      return "Tax rate must be a number between 0 and 100.";
    }

    return null;
  }

  async function handleSave() {
    if (!settings) return;

    const validationError =
      validateTaxSettings(settings);

    if (validationError) {
      toast.error(validationError);
      return;
    }

    try {
      setSaving(true);

      const updated =
        await saveClinicSettings(
          settings
        );

      setSettings(updated);

      toast.success("Settings saved.");
    } catch (error) {
      console.error(error);

      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to save settings."
      );
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

      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to upload logo."
      );
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
          Configure your clinic&apos;s
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

      <Card title="Tax Settings">

        <label className="flex items-center gap-3">

          <input
            type="checkbox"
            checked={settings.tax_enabled}
            onChange={(e) =>
              setSettings({
                ...settings,
                tax_enabled:
                  e.target.checked,
              })
            }
          />

          <span className="font-medium">
            Enable Tax
          </span>

        </label>

        <div className="mt-6 grid gap-6 lg:grid-cols-2">

          <FormInput
            label="Tax Name"
            value={settings.tax_name}
            onChange={(value) =>
              setSettings({
                ...settings,
                tax_name: value,
              })
            }
          />

          <FormInput
            label="Tax Rate (%)"
            type="number"
            value={settings.tax_rate}
            onChange={(value) =>
              setSettings({
                ...settings,
                tax_rate:
                  Number(value),
              })
            }
          />

          <FormInput
            label="Tax Registration Number (optional)"
            value={
              settings.tax_registration_number ??
              ""
            }
            onChange={(value) =>
              setSettings({
                ...settings,
                tax_registration_number:
                  value || null,
              })
            }
          />

          <label className="flex items-center gap-3">

            <input
              type="checkbox"
              checked={
                settings.prices_include_tax
              }
              onChange={(e) =>
                setSettings({
                  ...settings,
                  prices_include_tax:
                    e.target.checked,
                })
              }
            />

            <span>
              Treatment prices already
              include tax
            </span>

          </label>

        </div>

        <div className="mt-6">

          <FormTextarea
            label="Invoice Footer Tax Note (optional)"
            value={
              settings.invoice_footer_tax_note ??
              ""
            }
            onChange={(value) =>
              setSettings({
                ...settings,
                invoice_footer_tax_note:
                  value || null,
              })
            }
          />

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

export default function SettingsPage() {
  return (
    <PermissionGuard permission="settings">
      <SettingsPageContent />
    </PermissionGuard>
  );
}