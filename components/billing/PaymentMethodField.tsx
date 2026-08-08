"use client";

import { useCallback, useEffect, useState } from "react";

import Button from "@/components/ui/Button";
import ManageInsuranceProvidersModal from "@/components/insurance/ManageInsuranceProvidersModal";

import { getClinicInsuranceProviders } from "@/services/insurance";
import { getCurrentClinicId } from "@/services/clinic";
import { logError } from "@/lib/logError";

import usePermissions from "@/hooks/usePermissions";

import { PAYMENT_METHODS_WITH_INSURANCE } from "@/lib/paymentMethods";
import { InsuranceProvider } from "@/types/insurance";

interface Props {
  paymentMethod: string | null;
  onPaymentMethodChange: (value: string | null) => void;
  insuranceProviderId: string | null;
  onInsuranceProviderChange: (value: string | null) => void;
}

/**
 * Payment Method selector shared by both invoice-creation entry points
 * (app/admin/billing/page.tsx and CreateInvoiceFromPlanModal.tsx) - Cash/
 * M-Pesa/Card/Bank Transfer (DentalFlow's existing options) plus
 * Insurance, which reveals a required Insurance Provider dropdown scoped
 * to only this clinic's accepted providers (never the full master list).
 * The "+ Add Provider" quick-add is hidden unless the caller has
 * clinic-settings permission (Owner/Admin) - same idiom as the
 * inventory page's canManage gate.
 */
export default function PaymentMethodField({
  paymentMethod,
  onPaymentMethodChange,
  insuranceProviderId,
  onInsuranceProviderChange,
}: Props) {
  const { hasPermission } = usePermissions();
  const canManageInsurance = hasPermission("settings");

  const [clinicId, setClinicId] = useState<string | null>(null);
  const [providers, setProviders] = useState<InsuranceProvider[]>([]);
  const [loadingProviders, setLoadingProviders] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  const loadProviders = useCallback(async () => {
    try {
      setLoadingProviders(true);

      const id = await getCurrentClinicId();

      setClinicId(id);

      const result = await getClinicInsuranceProviders(id);

      setProviders(result);
    } catch (error) {
      logError(
        "[PaymentMethodField] Failed to load clinic insurance providers:",
        error
      );
    } finally {
      setLoadingProviders(false);
    }
  }, []);

  useEffect(() => {
    loadProviders();
  }, [loadProviders]);

  function handleSelectMethod(method: string) {
    if (method === paymentMethod) {
      onPaymentMethodChange(null);
      onInsuranceProviderChange(null);
      return;
    }

    onPaymentMethodChange(method);

    if (method !== "Insurance") {
      onInsuranceProviderChange(null);
    }
  }

  function handleModalSuccess(updatedProviders: InsuranceProvider[]) {
    const previousIds = providers.map((provider) => provider.id);

    setProviders(updatedProviders);

    const newlyAdded = updatedProviders.filter(
      (provider) => !previousIds.includes(provider.id)
    );

    if (newlyAdded.length === 1) {
      onInsuranceProviderChange(newlyAdded[0].id);
    }
  }

  return (
    <div className="space-y-3">
      <label className="block text-sm font-semibold text-graphite">
        Payment Method
      </label>

      <div className="flex flex-wrap gap-2">
        {PAYMENT_METHODS_WITH_INSURANCE.map((method) => (
          <button
            key={method}
            type="button"
            onClick={() => handleSelectMethod(method)}
            className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
              method === paymentMethod
                ? "border-eucalyptus bg-eucalyptus text-enamel"
                : "border-sea-glass bg-porcelain text-graphite hover:border-mineral/50"
            }`}
          >
            {method}
          </button>
        ))}
      </div>

      {paymentMethod === "Insurance" && (
        <div className="space-y-2">
          <label className="block text-sm font-semibold text-graphite">
            Insurance Provider
          </label>

          <div className="flex gap-2">
            <select
              value={insuranceProviderId ?? ""}
              onChange={(e) =>
                onInsuranceProviderChange(e.target.value || null)
              }
              className="min-h-11 w-full rounded-lg border border-sea-glass bg-enamel px-3 py-2.5 text-sm text-graphite transition-colors hover:border-mineral/50 focus:border-eucalyptus focus:outline-none"
            >
              <option value="">
                {loadingProviders ? "Loading..." : "Select a provider"}
              </option>

              {providers.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.name}
                </option>
              ))}
            </select>

            {canManageInsurance && (
              <Button
                type="button"
                variant="secondary"
                className="whitespace-nowrap px-3 py-2 text-sm"
                onClick={() => setModalOpen(true)}
              >
                + Add Provider
              </Button>
            )}
          </div>

          {!loadingProviders && providers.length === 0 && (
            <p className="text-sm text-mineral">
              This clinic hasn&apos;t configured any accepted insurance
              providers yet.
              {canManageInsurance
                ? ' Use "+ Add Provider" to add one.'
                : ""}
            </p>
          )}
        </div>
      )}

      {clinicId && (
        <ManageInsuranceProvidersModal
          open={modalOpen}
          clinicId={clinicId}
          onClose={() => setModalOpen(false)}
          onSuccess={handleModalSuccess}
        />
      )}
    </div>
  );
}
