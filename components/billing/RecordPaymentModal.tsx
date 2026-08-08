"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import Button from "@/components/ui/Button";

import { recordPayment } from "@/services/billing";
import { getClinicInsuranceProviders } from "@/services/insurance";
import { logError } from "@/lib/logError";
import {
  BASE_PAYMENT_METHODS,
  PAYMENT_METHODS_WITH_INSURANCE,
} from "@/lib/paymentMethods";

import { InsuranceProvider } from "@/types/insurance";

interface Props {
  invoiceId: string;

  // The invoice's own billing arrangement (WHO is responsible) - drives
  // this modal's defaults, but never determines HOW an individual
  // payment was actually received: the receptionist can still record a
  // Cash/M-Pesa/Card/Bank Transfer payment against an insurance invoice
  // (e.g. a patient copay), and doing so never changes the invoice's own
  // insurance_provider_id.
  invoicePaymentMethod: string | null;
  invoiceInsuranceProviderId: string | null;
  invoiceInsuranceProviderName: string | null;

  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export default function RecordPaymentModal({
  invoiceId,
  invoicePaymentMethod,
  invoiceInsuranceProviderId,
  invoiceInsuranceProviderName,
  open,
  onClose,
  onSuccess,
}: Props) {
  const isInsuranceInvoice = invoicePaymentMethod === "Insurance";

  const [amount, setAmount] =
    useState("");

  const [paymentMethod, setPaymentMethod] =
    useState("Cash");

  // Only used for the legacy fallback case: an insurance invoice that
  // somehow has no insurance_provider_id set. The normal case never
  // needs this - the invoice's own provider is used directly.
  const [fallbackProviders, setFallbackProviders] = useState<
    InsuranceProvider[]
  >([]);
  const [fallbackProviderId, setFallbackProviderId] = useState<
    string | null
  >(null);

  const [reference, setReference] =
    useState("");

  const [notes, setNotes] =
    useState("");

  const [saving, setSaving] =
    useState(false);

  useEffect(() => {
    if (!open) return;

    setAmount("");
    setReference("");
    setNotes("");
    setFallbackProviderId(null);

    // Default to Insurance for an insurance invoice - the receptionist
    // can still switch to a normal method for a patient copay.
    setPaymentMethod(isInsuranceInvoice ? "Insurance" : "Cash");

    if (isInsuranceInvoice && !invoiceInsuranceProviderId) {
      getClinicInsuranceProviders()
        .then(setFallbackProviders)
        .catch((error) => {
          logError(
            "[RecordPaymentModal] Failed to load clinic insurance providers:",
            error
          );
        });
    }
  }, [open, isInsuranceInvoice, invoiceInsuranceProviderId]);

  if (!open) return null;

  const availableMethods = isInsuranceInvoice
    ? PAYMENT_METHODS_WITH_INSURANCE
    : BASE_PAYMENT_METHODS;

  const resolvedInsuranceProviderId =
    paymentMethod === "Insurance"
      ? invoiceInsuranceProviderId ?? fallbackProviderId
      : null;

  async function handleSave() {
    if (!amount) {
      toast.error("Enter an amount.");
      return;
    }

    if (paymentMethod === "Insurance" && !resolvedInsuranceProviderId) {
      toast.error("Select an insurance provider.");
      return;
    }

    try {
      setSaving(true);

      await recordPayment(
        invoiceId,
        Number(amount),
        paymentMethod,
        reference,
        notes,
        resolvedInsuranceProviderId
      );

      onSuccess();
      onClose();

      toast.success("Payment recorded.");
    } catch (error) {
      console.error(error);

      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to record payment."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">

      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">

        <h2 className="mb-6 text-xl font-bold">
          Record Payment
        </h2>

        <div className="space-y-4">

          <input
            type="number"
            placeholder="Amount"
            className="w-full rounded-lg border p-3"
            value={amount}
            onChange={(e) =>
              setAmount(e.target.value)
            }
          />

          <select
            className="w-full rounded-lg border p-3"
            value={paymentMethod}
            onChange={(e) =>
              setPaymentMethod(e.target.value)
            }
          >
            {availableMethods.map((method) => (
              <option key={method}>{method}</option>
            ))}
          </select>

          {paymentMethod === "Insurance" && (
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-600">
                Insurance Provider
              </label>

              {invoiceInsuranceProviderId ? (
                <p className="rounded-lg border bg-slate-50 p-3 text-slate-700">
                  {invoiceInsuranceProviderName ?? "Unknown provider"}
                </p>
              ) : (
                <select
                  className="w-full rounded-lg border p-3"
                  value={fallbackProviderId ?? ""}
                  onChange={(e) =>
                    setFallbackProviderId(e.target.value || null)
                  }
                >
                  <option value="">Select a provider</option>

                  {fallbackProviders.map((provider) => (
                    <option key={provider.id} value={provider.id}>
                      {provider.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          <input
            className="w-full rounded-lg border p-3"
            placeholder="Reference"
            value={reference}
            onChange={(e) =>
              setReference(e.target.value)
            }
          />

          <textarea
            className="w-full rounded-lg border p-3"
            rows={4}
            placeholder="Notes"
            value={notes}
            onChange={(e) =>
              setNotes(e.target.value)
            }
          />

          <div className="flex justify-end gap-3">

            <Button
              variant="secondary"
              onClick={onClose}
            >
              Cancel
            </Button>

            <Button
              onClick={handleSave}
              disabled={saving}
            >
              {saving
                ? "Saving..."
                : "Save Payment"}
            </Button>

          </div>

        </div>

      </div>

    </div>
  );
}
