"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import Modal from "@/components/ui/Modal";
import Button from "@/components/ui/Button";

import { reverseCustomerCreditApplication } from "@/services/customerCredits";
import { getSafeErrorMessage } from "@/lib/logError";

import { ClinicInvoice } from "@/services/billing";

interface Props {
  creditId: string;
  creditAmount: number;
  creditRemaining: number;
  patientName: string;
  currency: string;
  /** Every one of the patient's invoices, not just currently-outstanding
   * ones - a credit may have been applied to an invoice that's since
   * shown as Paid because of that very application, and reversing it is
   * exactly what should reopen its balance. */
  patientInvoices: ClinicInvoice[];
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

/**
 * Full-app audit fix H8: undoes a mistakenly-applied credit through
 * reverse_customer_credit_application() (migration 0115) - the dedicated
 * replacement for the Ledger's generic "Reverse Transaction," which
 * cannot restore the credit's remaining_amount or reopen the invoice's
 * balance and was never safe to use for this. A reason is required,
 * matching Void Invoice/Void Payment's own required-reason pattern for
 * an action of this weight.
 */
export default function ReverseCustomerCreditModal({
  creditId,
  creditAmount,
  creditRemaining,
  patientName,
  currency,
  patientInvoices,
  open,
  onClose,
  onSuccess,
}: Props) {
  const [invoiceId, setInvoiceId] = useState("");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const totalEverApplied = creditAmount - creditRemaining;

  useEffect(() => {
    if (!open) return;
    setInvoiceId(patientInvoices[0]?.id ?? "");
    setAmount("");
    setReason("");
  }, [open, patientInvoices]);

  const selectedInvoice = useMemo(
    () => patientInvoices.find((inv) => inv.id === invoiceId) ?? null,
    [patientInvoices, invoiceId]
  );

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
  const exceedsAvailable = hasValidAmount && parsedAmount > totalEverApplied;
  const hasReason = reason.trim() !== "";

  async function handleReverse() {
    if (!selectedInvoice) {
      toast.error("Select the invoice this credit was applied to.");
      return;
    }
    if (!hasValidAmount) {
      toast.error("Enter an amount greater than zero.");
      return;
    }
    if (exceedsAvailable) {
      toast.error(`Amount cannot exceed the ${formatMoney(totalEverApplied)} ever applied from this credit.`);
      return;
    }
    if (!hasReason) {
      toast.error("Enter a reason for reversing this credit application.");
      return;
    }

    try {
      setSaving(true);
      await reverseCustomerCreditApplication(creditId, selectedInvoice.id, parsedAmount, reason.trim());
      onSuccess();
      onClose();
      toast.success("Customer credit application reversed.");
    } catch (error) {
      toast.error(getSafeErrorMessage(error, "Failed to reverse customer credit application."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      title="Reverse Customer Credit Application"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            onClick={handleReverse}
            disabled={saving || !selectedInvoice || !hasValidAmount || exceedsAvailable || !hasReason}
          >
            {saving ? "Reversing..." : "Reverse Application"}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg border border-sea-glass p-4 text-sm">
          <dt className="text-mineral">Patient</dt>
          <dd className="text-right font-medium text-graphite">{patientName}</dd>

          <dt className="font-semibold text-graphite">Ever Applied From This Credit</dt>
          <dd className="text-right text-base font-bold text-graphite">
            {formatMoney(totalEverApplied)}
          </dd>
        </dl>

        <p className="text-xs text-mineral">
          Reversing adds this amount back to the credit&apos;s remaining balance and reopens the
          selected invoice&apos;s balance by the same amount.
        </p>

        {patientInvoices.length === 0 ? (
          <p className="text-sm text-mineral">This patient has no invoices.</p>
        ) : (
          <>
            <div>
              <label className="mb-1.5 block text-sm font-semibold text-graphite">
                Which Invoice Was It Applied To?
              </label>
              <select
                className="w-full rounded-lg border border-sea-glass p-3 text-graphite outline-none transition focus:border-eucalyptus"
                value={invoiceId}
                onChange={(e) => setInvoiceId(e.target.value)}
              >
                {patientInvoices.map((inv) => (
                  <option key={inv.id} value={inv.id}>
                    {inv.invoice_number} - Paid {formatMoney(Number(inv.amount_paid))}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label htmlFor="reverse-credit-amount" className="text-sm font-semibold text-graphite">
                  Amount
                </label>
                <button
                  type="button"
                  onClick={() => setAmount(String(totalEverApplied))}
                  className="text-xs font-semibold text-eucalyptus hover:underline"
                >
                  Full Amount ({formatMoney(totalEverApplied)})
                </button>
              </div>
              <input
                id="reverse-credit-amount"
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                className={`w-full rounded-lg border p-3 text-graphite outline-none transition focus:border-eucalyptus ${
                  exceedsAvailable ? "border-clay" : "border-sea-glass"
                }`}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
              {exceedsAvailable && (
                <p className="mt-1.5 text-xs font-medium text-clay-ink">
                  Amount cannot exceed {formatMoney(totalEverApplied)}.
                </p>
              )}
            </div>

            <div>
              <label htmlFor="reverse-credit-reason" className="mb-1.5 block text-sm font-semibold text-graphite">
                Reason (required)
              </label>
              <input
                id="reverse-credit-reason"
                type="text"
                placeholder="e.g. applied to the wrong invoice"
                className="w-full rounded-lg border border-sea-glass p-3 text-graphite outline-none transition focus:border-eucalyptus"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
