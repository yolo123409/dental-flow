"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import FormModal from "@/components/ui/FormModal";
import InsuranceProviderChecklist from "./InsuranceProviderChecklist";

import {
  getInsuranceProviders,
  getClinicInsuranceProviders,
  updateClinicInsuranceProviders,
} from "@/services/insurance";
import { logError } from "@/lib/logError";

import { InsuranceProvider } from "@/types/insurance";

interface Props {
  open: boolean;
  clinicId: string;
  onClose: () => void;
  onSuccess: (updatedProviders: InsuranceProvider[]) => void;
}

/**
 * Wraps the shared InsuranceProviderChecklist in a modal, pre-checked
 * with the clinic's current providers. Used from Settings' "manage" flow
 * is not needed (Settings uses the checklist inline) - this is
 * specifically the invoice screen's "+ Add Insurance Provider" quick-add
 * (spec sections 10-11).
 */
export default function ManageInsuranceProvidersModal({
  open,
  clinicId,
  onClose,
  onSuccess,
}: Props) {
  const [providers, setProviders] = useState<InsuranceProvider[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;

    setLoading(true);

    Promise.all([
      getInsuranceProviders(),
      getClinicInsuranceProviders(clinicId),
    ])
      .then(([master, accepted]) => {
        setProviders(master);
        setSelectedIds(accepted.map((provider) => provider.id));
      })
      .catch((error) => {
        logError(
          "[ManageInsuranceProvidersModal] Failed to load providers:",
          error
        );

        toast.error("Failed to load insurance providers.");
      })
      .finally(() => setLoading(false));
  }, [open, clinicId]);

  function toggle(providerId: string) {
    setSelectedIds((prev) =>
      prev.includes(providerId)
        ? prev.filter((id) => id !== providerId)
        : [...prev, providerId]
    );
  }

  async function handleSubmit() {
    try {
      setSaving(true);

      await updateClinicInsuranceProviders(clinicId, selectedIds);

      const updated = await getClinicInsuranceProviders(clinicId);

      toast.success("Insurance providers updated.");

      onClose();

      onSuccess(updated);
    } catch (error) {
      logError(
        "[ManageInsuranceProvidersModal] updateClinicInsuranceProviders failed:",
        error
      );

      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to update insurance providers."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <FormModal
      open={open}
      title="Add Insurance Provider"
      loading={saving}
      onClose={onClose}
      onSubmit={handleSubmit}
      submitText="Update Insurance Providers"
    >
      {loading ? (
        <p className="py-6 text-center text-sm text-mineral">
          Loading...
        </p>
      ) : (
        <InsuranceProviderChecklist
          providers={providers}
          selectedIds={selectedIds}
          onToggle={toggle}
        />
      )}
    </FormModal>
  );
}
