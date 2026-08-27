"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import Modal from "@/components/ui/Modal";
import Button from "@/components/ui/Button";

import { refundCustomerCredit } from "@/services/customerCredits";
import { getSafeErrorMessage } from "@/lib/logError";
import { BASE_PAYMENT_METHODS } from "@/lib/paymentMethods";

interface Props {
  creditId: string;
  creditRemaining: number;
  patientName: string;
  currency: string;
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

/**
 * FIN-4.7: records a refund of an existing Customer Credit that already
 * happened outside the system (cash handed back, a real M-Pesa transfer
 * already sent) - through refund_customer_credit() (migration 0100),
 * which posts Debit Customer Credits / Credit the resolved cash account.
 * Same "this records money that already moved, it doesn't move money
 * itself" pattern as RecordPaymentModal - see services/customerCredits.ts.
 * No Insurance option: a Customer Credit refund is always paid out in a
 * real, immediate instrument, never an insurance claim.
 */
export default function RefundCustomerCreditModal({
  creditId,
  creditRemaining,
  patientName,
  currency,
  open,
  onClose,
  onSuccess,
}: Props) {
  const [amount, setAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<string>(BASE_PAYMENT_METHODS[0]);
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setAmount("");
    setPaymentMethod(BASE_PAYMENT_METHODS[0]);
    setReference("");
    setNotes("");
  }, [open]);

  if (!open) return null;

  const formatMoney = (value: number) =>
    new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(value);

  const parsedAmount = Number(amount);
  const hasValidAmount =
    amount.trim() !== "" && Number.isFinite(parsedAmount) && parsedAmount > 0;
  const exceedsRemaining = hasValidAmount && parsedAmount > creditRemaining;

  async function handleRefund() {
    if (!hasValidAmount) {
      toast.error("Enter a refund amount greater than zero.");
      return;
    }
    if (exceedsRemaining) {
      toast.error("Refund amount cannot exceed the credit's remaining balance.");
      return;
    }

    try {
      setSaving(true);
      await refundCustomerCredit(
        creditId,
        parsedAmount,
        paymentMethod,
        reference || undefined,
        notes || undefined
      );
      onSuccess();
      onClose();
      toast.success("Refund recorded.");
    } catch (error) {
      toast.error(getSafeErrorMessage(error, "Failed to record refund."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      title="Refund Customer Credit"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleRefund} disabled={saving || !hasValidAmount || exceedsRemaining}>
            {saving ? "Recording..." : "Record Refund"}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg border border-sea-glass p-4 text-sm">
          <dt className="text-mineral">Patient</dt>
          <dd className="text-right font-medium text-graphite">{patientName}</dd>

          <dt className="font-semibold text-graphite">Available Credit</dt>
          <dd className="text-right text-base font-bold text-graphite">
            {formatMoney(creditRemaining)}
          </dd>
        </dl>

        <p className="text-sm text-mineral">
          Use this only after the money has actually been handed or sent
          back to the patient - this records that refund, it does not send
          one.
        </p>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label htmlFor="refund-credit-amount" className="text-sm font-semibold text-graphite">
              Refund Amount
            </label>
            <button
              type="button"
              onClick={() => setAmount(String(creditRemaining))}
              className="text-xs font-semibold text-eucalyptus hover:underline"
            >
              Refund All
            </button>
          </div>
          <input
            id="refund-credit-amount"
            type="number"
            min="0"
            step="0.01"
            placeholder="0.00"
            className={`w-full rounded-lg border p-3 text-graphite outline-none transition focus:border-eucalyptus ${
              exceedsRemaining ? "border-clay" : "border-sea-glass"
            }`}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          {exceedsRemaining && (
            <p className="mt-1.5 text-xs font-medium text-clay-ink">
              Amount exceeds the available credit of {formatMoney(creditRemaining)}.
            </p>
          )}
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-semibold text-graphite">
            Refunded Via
          </label>
          <select
            className="w-full rounded-lg border border-sea-glass p-3 text-graphite outline-none transition focus:border-eucalyptus"
            value={paymentMethod}
            onChange={(e) => setPaymentMethod(e.target.value)}
          >
            {BASE_PAYMENT_METHODS.map((method) => (
              <option key={method}>{method}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-semibold text-graphite">
            Reference
          </label>
          <input
            className="w-full rounded-lg border border-sea-glass p-3 text-graphite outline-none transition focus:border-eucalyptus"
            placeholder="e.g. M-Pesa code, receipt #"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
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
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
      </div>
    </Modal>
  );
}
