"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import Modal from "@/components/ui/Modal";
import Button from "@/components/ui/Button";

import { applyCustomerCredit } from "@/services/customerCredits";
import { getSafeErrorMessage } from "@/lib/logError";

import { ClinicInvoice } from "@/services/billing";

interface Props {
  creditId: string;
  creditRemaining: number;
  patientName: string;
  currency: string;
  /** The patient's own invoices with an outstanding balance - the only
   * valid apply targets (apply_customer_credit itself re-checks same
   * clinic/same patient server-side; this list is already scoped to
   * both, so nothing here can construct an invalid request). */
  outstandingInvoices: ClinicInvoice[];
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

/**
 * FIN-4.7: applies an existing Customer Credit toward one of the same
 * patient's other outstanding invoices, through apply_customer_credit()
 * (migration 0100) - reduces that invoice's balance exactly as a payment
 * would and posts the matching Debit Customer Credits / Credit AR entry.
 * Never lets the amount exceed either the credit's remaining balance or
 * the target invoice's own balance (mirroring RecordPaymentModal's
 * exceedsBalance guard) - the RPC re-checks both server-side regardless.
 */
export default function ApplyCustomerCreditModal({
  creditId,
  creditRemaining,
  patientName,
  currency,
  outstandingInvoices,
  open,
  onClose,
  onSuccess,
}: Props) {
  const [invoiceId, setInvoiceId] = useState("");
  const [amount, setAmount] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setInvoiceId(outstandingInvoices[0]?.id ?? "");
    setAmount("");
  }, [open, outstandingInvoices]);

  const selectedInvoice = useMemo(
    () => outstandingInvoices.find((inv) => inv.id === invoiceId) ?? null,
    [outstandingInvoices, invoiceId]
  );

  if (!open) return null;

  const formatMoney = (value: number) =>
    new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(value);

  const maxApplicable = selectedInvoice
    ? Math.min(creditRemaining, Number(selectedInvoice.balance))
    : 0;

  const parsedAmount = Number(amount);
  const hasValidAmount =
    amount.trim() !== "" && Number.isFinite(parsedAmount) && parsedAmount > 0;
  const exceedsAvailable = hasValidAmount && parsedAmount > maxApplicable;

  async function handleApply() {
    if (!selectedInvoice) {
      toast.error("Select an invoice to apply this credit to.");
      return;
    }
    if (!hasValidAmount) {
      toast.error("Enter an amount greater than zero.");
      return;
    }
    if (exceedsAvailable) {
      toast.error("Amount cannot exceed the credit's remaining balance or the invoice's balance.");
      return;
    }

    try {
      setSaving(true);
      await applyCustomerCredit(creditId, selectedInvoice.id, parsedAmount);
      onSuccess();
      onClose();
      toast.success("Customer credit applied.");
    } catch (error) {
      toast.error(getSafeErrorMessage(error, "Failed to apply customer credit."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      title="Apply Customer Credit"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            onClick={handleApply}
            disabled={saving || !selectedInvoice || !hasValidAmount || exceedsAvailable}
          >
            {saving ? "Applying..." : "Apply Credit"}
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

        {outstandingInvoices.length === 0 ? (
          <p className="text-sm text-mineral">
            This patient has no outstanding invoices to apply credit to.
          </p>
        ) : (
          <>
            <div>
              <label className="mb-1.5 block text-sm font-semibold text-graphite">
                Apply To Invoice
              </label>
              <select
                className="w-full rounded-lg border border-sea-glass p-3 text-graphite outline-none transition focus:border-eucalyptus"
                value={invoiceId}
                onChange={(e) => setInvoiceId(e.target.value)}
              >
                {outstandingInvoices.map((inv) => (
                  <option key={inv.id} value={inv.id}>
                    {inv.invoice_number} - Balance {formatMoney(Number(inv.balance))}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label htmlFor="apply-credit-amount" className="text-sm font-semibold text-graphite">
                  Amount
                </label>
                <button
                  type="button"
                  onClick={() => setAmount(String(maxApplicable))}
                  className="text-xs font-semibold text-eucalyptus hover:underline"
                >
                  Apply Maximum ({formatMoney(maxApplicable)})
                </button>
              </div>
              <input
                id="apply-credit-amount"
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
                  Amount cannot exceed {formatMoney(maxApplicable)}.
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
