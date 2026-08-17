"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";

import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import FormInput from "@/components/ui/FormInput";
import FormTextarea from "@/components/ui/FormTextarea";
import PermissionGuard from "@/components/auth/PermissionGuard";
import ClinicLogoUploader from "@/components/settings/ClinicLogoUploader";
import ExpenseCategoriesManager from "@/components/settings/ExpenseCategoriesManager";
import InsuranceProviderChecklist from "@/components/insurance/InsuranceProviderChecklist";

import {
  ClinicSettings,
  getClinicSettings,
  saveClinicSettings,
  uploadClinicLogo,
  removeClinicLogo,
} from "@/services/settings";
import {
  getInsuranceProviders,
  getClinicInsuranceProviders,
  updateClinicInsuranceProviders,
} from "@/services/insurance";
import { getCurrentClinicId } from "@/services/clinic";

import { InsuranceProvider } from "@/types/insurance";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type FieldErrors = Partial<
  Record<
    "clinic_name" | "phone" | "email" | "website",
    string
  >
>;

function normalizeWebsite(value: string): string {
  const trimmed = value.trim();

  if (!trimmed) return trimmed;

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  return `https://${trimmed}`;
}

function isValidUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function validateClinicProfile(
  current: ClinicSettings
): FieldErrors {
  const errors: FieldErrors = {};

  if (!current.clinic_name.trim()) {
    errors.clinic_name = "Clinic name is required.";
  }

  if (!current.phone?.trim()) {
    errors.phone = "Phone number is required.";
  }

  if (!current.email?.trim()) {
    errors.email = "Email is required.";
  } else if (!EMAIL_PATTERN.test(current.email.trim())) {
    errors.email = "Enter a valid email address.";
  }

  if (
    current.website?.trim() &&
    !isValidUrl(normalizeWebsite(current.website))
  ) {
    errors.website = "Enter a valid website URL.";
  }

  return errors;
}

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

function SettingsPageContent() {
  const [loading, setLoading] =
    useState(true);

  const [saving, setSaving] =
    useState(false);

  const [justSaved, setJustSaved] =
    useState(false);

  const [uploadingLogo, setUploadingLogo] =
    useState(false);

  const [removingLogo, setRemovingLogo] =
    useState(false);

  const [settings, setSettings] =
    useState<ClinicSettings | null>(
      null
    );

  // Last successfully-persisted state, used only to compute whether there
  // are unsaved changes - not rendered directly.
  const savedSnapshotRef =
    useRef<ClinicSettings | null>(null);

  const [fieldErrors, setFieldErrors] =
    useState<FieldErrors>({});

  const [clinicId, setClinicId] =
    useState<string | null>(null);

  const [insuranceProviders, setInsuranceProviders] =
    useState<InsuranceProvider[]>([]);

  const [selectedInsuranceIds, setSelectedInsuranceIds] =
    useState<string[]>([]);

  const [savingInsurance, setSavingInsurance] =
    useState(false);

  const isDirty =
    settings !== null &&
    savedSnapshotRef.current !== null &&
    JSON.stringify(settings) !==
      JSON.stringify(savedSnapshotRef.current);

  async function loadSettings() {
    try {
      setLoading(true);

      const result =
        await getClinicSettings();

      setSettings(result);
      savedSnapshotRef.current = result;
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
    loadInsurance();
  }, []);

  async function loadInsurance() {
    try {
      const id = await getCurrentClinicId();

      setClinicId(id);

      const [master, accepted] = await Promise.all([
        getInsuranceProviders(),
        getClinicInsuranceProviders(id),
      ]);

      setInsuranceProviders(master);
      setSelectedInsuranceIds(
        accepted.map((provider) => provider.id)
      );
    } catch (error) {
      console.error(error);

      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to load insurance providers."
      );
    }
  }

  function toggleInsuranceProvider(providerId: string) {
    setSelectedInsuranceIds((prev) =>
      prev.includes(providerId)
        ? prev.filter((id) => id !== providerId)
        : [...prev, providerId]
    );
  }

  async function handleSaveInsurance() {
    if (!clinicId || savingInsurance) return;

    try {
      setSavingInsurance(true);

      await updateClinicInsuranceProviders(
        clinicId,
        selectedInsuranceIds
      );

      toast.success("Insurance providers updated.");
    } catch (error) {
      console.error(error);

      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to update insurance providers."
      );
    } finally {
      setSavingInsurance(false);
    }
  }

  // Warn on tab close/refresh only - intentionally not intercepting
  // in-app navigation (Link clicks), which would need a more involved
  // router-event listener than this page's scope warrants.
  useEffect(() => {
    function handleBeforeUnload(
      e: BeforeUnloadEvent
    ) {
      if (!isDirty) return;

      e.preventDefault();
    }

    window.addEventListener(
      "beforeunload",
      handleBeforeUnload
    );

    return () =>
      window.removeEventListener(
        "beforeunload",
        handleBeforeUnload
      );
  }, [isDirty]);

  function updateSettings(
    patch: Partial<ClinicSettings>
  ) {
    setJustSaved(false);

    setSettings((current) =>
      current
        ? { ...current, ...patch }
        : current
    );
  }

  async function handleSave() {
    if (!settings || saving) return;

    const profileErrors =
      validateClinicProfile(settings);

    setFieldErrors(profileErrors);

    if (Object.keys(profileErrors).length > 0) {
      toast.error(
        "Please fix the highlighted fields."
      );
      return;
    }

    const taxError =
      validateTaxSettings(settings);

    if (taxError) {
      toast.error(taxError);
      return;
    }

    try {
      setSaving(true);

      const updated = await saveClinicSettings({
        ...settings,
        website: settings.website?.trim()
          ? normalizeWebsite(settings.website)
          : null,
      });

      setSettings(updated);
      savedSnapshotRef.current = updated;

      setJustSaved(true);

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

  async function handleLogoUpload(file: File) {
    try {
      setUploadingLogo(true);

      const logoUrl = await uploadClinicLogo(file);

      setSettings((current) =>
        current
          ? { ...current, logo_url: logoUrl }
          : current
      );

      if (savedSnapshotRef.current) {
        savedSnapshotRef.current = {
          ...savedSnapshotRef.current,
          logo_url: logoUrl,
        };
      }

      toast.success("Logo updated.");
    } catch (error) {
      console.error(error);

      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to upload logo."
      );
    } finally {
      setUploadingLogo(false);
    }
  }

  async function handleLogoRemove() {
    try {
      setRemovingLogo(true);

      await removeClinicLogo();

      setSettings((current) =>
        current
          ? { ...current, logo_url: null }
          : current
      );

      if (savedSnapshotRef.current) {
        savedSnapshotRef.current = {
          ...savedSnapshotRef.current,
          logo_url: null,
        };
      }

      toast.success("Logo removed.");
    } catch (error) {
      console.error(error);

      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to remove logo."
      );
    } finally {
      setRemovingLogo(false);
    }
  }

  if (loading || !settings) {
    return (
      <div className="py-24 text-center">
        Loading settings...
      </div>
    );
  }

  const saveLabel = saving
    ? "Saving..."
    : justSaved && !isDirty
    ? "Saved"
    : "Save Settings";

  return (
    <div className="space-y-8">

      <div>

        <h1 className="text-3xl font-bold">
          Clinic Settings
        </h1>

        <p className="mt-2 text-slate-500">
          This is your clinic&apos;s identity -
          it&apos;s used on invoices, receipts,
          and anywhere else DentalFlow shows
          your branding.
        </p>

      </div>

      <Card title="Clinic Profile">

        <div className="grid gap-6 lg:grid-cols-2">

          <div className="space-y-4">

            <FormInput
              label="Clinic Name"
              required
              value={settings.clinic_name}
              error={fieldErrors.clinic_name}
              onChange={(value) =>
                updateSettings({
                  clinic_name: value,
                })
              }
            />

            <FormInput
              label="Phone"
              required
              value={settings.phone ?? ""}
              error={fieldErrors.phone}
              onChange={(value) =>
                updateSettings({ phone: value })
              }
            />

            <FormInput
              label="Email"
              required
              type="email"
              value={settings.email ?? ""}
              error={fieldErrors.email}
              onChange={(value) =>
                updateSettings({ email: value })
              }
            />

            <FormInput
              label="Website (optional)"
              value={settings.website ?? ""}
              error={fieldErrors.website}
              placeholder="www.yourclinic.com"
              onChange={(value) =>
                updateSettings({ website: value })
              }
            />

          </div>

          <div className="space-y-4">

            <FormInput
              label="Address Line 1"
              value={
                settings.address_line_1 ?? ""
              }
              onChange={(value) =>
                updateSettings({
                  address_line_1: value,
                })
              }
            />

            <FormInput
              label="Address Line 2 (optional)"
              value={
                settings.address_line_2 ?? ""
              }
              onChange={(value) =>
                updateSettings({
                  address_line_2: value,
                })
              }
            />

            <FormInput
              label="City"
              value={settings.city ?? ""}
              onChange={(value) =>
                updateSettings({ city: value })
              }
            />

            <FormInput
              label="Country"
              value={settings.country ?? ""}
              onChange={(value) =>
                updateSettings({ country: value })
              }
            />

          </div>

        </div>

        <div className="mt-8 border-t border-sea-glass pt-6">

          <ClinicLogoUploader
            logoUrl={settings.logo_url}
            clinicName={settings.clinic_name}
            uploading={uploadingLogo}
            removing={removingLogo}
            onUpload={handleLogoUpload}
            onRemove={handleLogoRemove}
          />

        </div>

        <div className="mt-8 flex items-center justify-end gap-3">

          {isDirty && (
            <p className="text-sm text-mineral">
              You have unsaved changes.
            </p>
          )}

          <Button
            onClick={handleSave}
            disabled={saving}
          >
            {saveLabel}
          </Button>

        </div>

      </Card>

      <Card title="Tax Settings">

        <label className="flex items-center gap-3">

          <input
            type="checkbox"
            checked={settings.tax_enabled}
            onChange={(e) =>
              updateSettings({
                tax_enabled: e.target.checked,
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
              updateSettings({
                tax_name: value,
              })
            }
          />

          <FormInput
            label="Tax Rate (%)"
            type="number"
            value={settings.tax_rate}
            onChange={(value) =>
              updateSettings({
                tax_rate: Number(value),
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
              updateSettings({
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
                updateSettings({
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
              updateSettings({
                invoice_footer_tax_note:
                  value || null,
              })
            }
          />

        </div>

        <div className="mt-8 flex items-center justify-end gap-3">

          {isDirty && (
            <p className="text-sm text-mineral">
              You have unsaved changes.
            </p>
          )}

          <Button
            onClick={handleSave}
            disabled={saving}
          >
            {saveLabel}
          </Button>

        </div>

      </Card>

      <div id="financial-targets" className="scroll-mt-8">
        <Card title="Financial Targets">

          <h3 className="mb-1 font-semibold text-graphite">
            Break-Even
          </h3>

          <p className="text-sm text-mineral">
            Break-even is calculated automatically for each period as Total
            Revenue (paid invoices) compared against Total Costs Incurred
            (paid expenses) - there is nothing to configure here. View the
            current break-even status on the{" "}
            <Link href="/admin" className="font-semibold text-eucalyptus hover:underline">
              Dashboard
            </Link>
            .
          </p>

        </Card>
      </div>

      <Card title="Expense Categories">
        <ExpenseCategoriesManager />
      </Card>

      <Card title="Insurance Providers">

        <p className="mb-4 text-sm text-mineral">
          Choose the insurance providers your clinic currently
          accepts.
        </p>

        <InsuranceProviderChecklist
          providers={insuranceProviders}
          selectedIds={selectedInsuranceIds}
          onToggle={toggleInsuranceProvider}
        />

        <div className="mt-6 flex items-center justify-end gap-3">

          <Button
            onClick={handleSaveInsurance}
            disabled={savingInsurance}
          >
            {savingInsurance ? "Saving..." : "Save Changes"}
          </Button>

        </div>

      </Card>

      <Card title="Procurement Templates">

        <p className="mb-4 text-sm text-mineral">
          Customize your Purchase Order and Goods Received Note document
          prefixes, headers, footers, and custom fields.
        </p>

        <Link
          href="/admin/inventory/settings"
          className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-sea-glass bg-enamel px-4 py-2.5 text-sm font-semibold text-graphite transition-colors hover:bg-porcelain"
        >
          Open Procurement Settings
        </Link>

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
