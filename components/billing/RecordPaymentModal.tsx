"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import Modal from "@/components/ui/Modal";
import Button from "@/components/ui/Button";

import { recordPayment } from "@/services/billing";
import { getClinicInsuranceProviders } from "@/services/insurance";
import { logError } from "@/lib/logError";
import {
  BASE_PAYMENT_METHODS,
  PAYMENT_METHODS_WITH_INSURANCE,
} from "@/lib/paymentMethods";

import { InsuranceProvider } from "@/types/insurance";
import { getSafeErrorMessage } from "@/lib/logError";

interface Props {
  invoiceId: string;

  /** Phase J section 4/20: shown before submission so the person recording
   * a payment can see exactly what they're paying against, in the same
   * modal whether it was opened from Invoice Detail or from Billing. */
  invoiceNumber: string;
  patientName: string;
  currency: string;
  total: number;
  amountPaid: number;
  balance: number;

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

/**
 * Phase J section 2: the ONE Record Payment implementation, reused as-is
 * by both /admin/billing/[id] (Invoice Detail) and the Billing Control
 * Center's ChargeDetailModal - not two separate forms. Still calls the
 * single authoritative recordPayment() (services/billing.ts); this
 * component only adds presentation (the before/after balance context,
 * a Pay Full Balance shortcut, live client-side validation) around it.
 */
export default function RecordPaymentModal({
  invoiceId,
  invoiceNumber,
  patientName,
  currency,
  total,
  amountPaid,
  balance,
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

  const formatMoney = (value: number) =>
    new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(value);

  const parsedAmount = Number(amount);
  const hasValidAmount =
    amount.trim() !== "" &&
    Number.isFinite(parsedAmount) &&
    parsedAmount > 0;

  // Phase J section 5: UX-only client-side validation - recordPayment()
  // itself is the authoritative guard (services/billing.ts), never this.
  const exceedsBalance = hasValidAmount && parsedAmount > balance;

  const remainingAfter = hasValidAmount
    ? Math.max(0, roundToCents(balance - parsedAmount))
    : balance;

  function roundToCents(value: number): number {
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }

  async function handleSave() {
    if (!hasValidAmount) {
      toast.error("Enter a payment amount greater than zero.");
      return;
    }

    if (exceedsBalance) {
      toast.error("Payment amount cannot exceed the outstanding balance.");
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
        parsedAmount,
        paymentMethod,
        reference,
        notes,
        resolvedInsuranceProviderId
      );

      onSuccess();
      onClose();

      toast.success("Payment recorded successfully.");
    } catch (error) {
      toast.error(
        getSafeErrorMessage(error, "Failed to record payment.")
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      title="Record Payment"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>

          <Button
            onClick={handleSave}
            disabled={saving || !hasValidAmount || exceedsBalance}
          >
            {saving ? "Recording..." : "Record Payment"}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {/* Before-submission context - Phase J section 4 */}
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg border border-sea-glass p-4 text-sm">
          <dt className="text-mineral">Invoice</dt>
          <dd className="text-right font-medium text-graphite">
            {invoiceNumber}
          </dd>

          <dt className="text-mineral">Patient</dt>
          <dd className="text-right font-medium text-graphite">
            {patientName}
          </dd>

          <dt className="text-mineral">Invoice Total</dt>
          <dd className="text-right font-medium text-graphite">
            {formatMoney(total)}
          </dd>

          <dt className="text-mineral">Already Paid</dt>
          <dd className="text-right font-medium text-graphite">
            {formatMoney(amountPaid)}
          </dd>

          <dt className="font-semibold text-graphite">Remaining Balance</dt>
          <dd className="text-right text-base font-bold text-graphite">
            {formatMoney(balance)}
          </dd>
        </dl>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label
              htmlFor="payment-amount"
              className="text-sm font-semibold text-graphite"
            >
              Payment Amount
            </label>

            <button
              type="button"
              onClick={() => setAmount(String(balance))}
              className="text-xs font-semibold text-eucalyptus hover:underline"
            >
              Pay Full Balance
            </button>
          </div>

          <input
            id="payment-amount"
            type="number"
            min="0"
            step="0.01"
            placeholder="0.00"
            className={`w-full rounded-lg border p-3 text-graphite outline-none transition focus:border-eucalyptus ${
              exceedsBalance ? "border-clay" : "border-sea-glass"
            }`}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />

          {exceedsBalance && (
            <p className="mt-1.5 text-xs font-medium text-clay-ink">
              Amount exceeds the outstanding balance of{" "}
              {formatMoney(balance)}.
            </p>
          )}
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-semibold text-graphite">
            Payment Method
          </label>

          <select
            className="w-full rounded-lg border border-sea-glass p-3 text-graphite outline-none transition focus:border-eucalyptus"
            value={paymentMethod}
            onChange={(e) =>
              setPaymentMethod(e.target.value)
            }
          >
            {availableMethods.map((method) => (
              <option key={method}>{method}</option>
            ))}
          </select>
        </div>

        {paymentMethod === "Insurance" && (
          <div>
            <label className="mb-1.5 block text-sm font-semibold text-graphite">
              Insurance Provider
            </label>

            {invoiceInsuranceProviderId ? (
              <p className="rounded-lg border border-sea-glass bg-porcelain p-3 text-graphite">
                {invoiceInsuranceProviderName ?? "Unknown provider"}
              </p>
            ) : (
              <select
                className="w-full rounded-lg border border-sea-glass p-3 text-graphite outline-none transition focus:border-eucalyptus"
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

        <div>
          <label className="mb-1.5 block text-sm font-semibold text-graphite">
            Payment Reference
          </label>

          <input
            className="w-full rounded-lg border border-sea-glass p-3 text-graphite outline-none transition focus:border-eucalyptus"
            placeholder="e.g. M-Pesa code, receipt #"
            value={reference}
            onChange={(e) =>
              setReference(e.target.value)
            }
          />
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-semibold text-graphite">
            Notes
          </label>

          <textarea
            className="w-full rounded-lg border border-sea-glass p-3 text-graphite outline-none transition focus:border-eucalyptus"
            rows={3}
            placeholder="Optional"
            value={notes}
            onChange={(e) =>
              setNotes(e.target.value)
            }
          />
        </div>

        {/* Live confirmation summary - Phase J section 20/22 */}
        {hasValidAmount && !exceedsBalance && (
          <div className="rounded-lg bg-pale-sage p-4 text-sm">
            <div className="flex justify-between">
              <span className="text-sage-ink">Remaining after this payment</span>
              <span className="font-bold text-sage-ink">
                {formatMoney(remainingAfter)}
              </span>
            </div>
            <p className="mt-1 text-xs text-sage-ink">
              {remainingAfter <= 0
                ? "This will fully pay off the invoice."
                : "This will leave the invoice Partially Paid."}
            </p>
          </div>
        )}
      </div>
    </Modal>
  );
}
