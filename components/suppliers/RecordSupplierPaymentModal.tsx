"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import Modal from "@/components/ui/Modal";
import Button from "@/components/ui/Button";
import FormInput from "@/components/ui/FormInput";
import FormTextarea from "@/components/ui/FormTextarea";

import { getSupplierOutstandingGrns, recordSupplierPayment } from "@/services/supplierPayments";
import { OutstandingGrn } from "@/types/supplierPayments";
import { getSafeErrorMessage } from "@/lib/logError";

interface Props {
  open: boolean;
  supplierId: string;
  supplierName: string;
  currency: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}

const PAYMENT_METHODS = ["Cash", "Bank Transfer", "M-Pesa"];

/**
 * Every allocation must add up to exactly the payment amount - this is
 * enforced server-side by record_supplier_payment (no "unapplied
 * supplier credit" concept exists), and mirrored here so the user sees
 * the mismatch before submitting rather than only after a rejection.
 */
export default function RecordSupplierPaymentModal({
  open,
  supplierId,
  supplierName,
  currency,
  onClose,
  onSaved,
}: Props) {
  const [paymentDate, setPaymentDate] = useState("");
  const [paymentMethod, setPaymentMethod] = useState(PAYMENT_METHODS[0]);
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const [loadingGrns, setLoadingGrns] = useState(false);
  const [outstandingGrns, setOutstandingGrns] = useState<OutstandingGrn[]>([]);
  const [allocations, setAllocations] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;

    setPaymentDate(new Date().toISOString().slice(0, 10));
    setPaymentMethod(PAYMENT_METHODS[0]);
    setAmount("");
    setReference("");
    setNotes("");
    setAllocations({});

    setLoadingGrns(true);
    getSupplierOutstandingGrns(supplierId)
      .then(setOutstandingGrns)
      .catch((error) => {
        console.error(error);
        toast.error("Failed to load outstanding GRNs.");
      })
      .finally(() => setLoadingGrns(false));
  }, [open, supplierId]);

  const formatMoney = useMemo(
    () => (value: number) =>
      new Intl.NumberFormat(undefined, {
        style: "currency",
        currency,
        maximumFractionDigits: 2,
      }).format(value),
    [currency]
  );

  if (!open) return null;

  const parsedAmount = Number(amount || 0);
  const totalAllocated = Object.values(allocations).reduce(
    (sum, value) => sum + Number(value || 0),
    0
  );
  const allocationMismatch = Math.abs(totalAllocated - parsedAmount) > 0.001;

  function handleAllocationChange(grnId: string, value: string) {
    setAllocations((prev) => ({ ...prev, [grnId]: value }));
  }

  function autoFill() {
    if (parsedAmount <= 0) {
      toast.error("Enter a payment amount first.");
      return;
    }

    let remaining = parsedAmount;
    const next: Record<string, string> = {};

    for (const grn of outstandingGrns) {
      if (remaining <= 0) break;

      const apply = Math.min(remaining, grn.outstandingAmount);
      next[grn.grnId] = apply.toFixed(2);
      remaining -= apply;
    }

    setAllocations(next);

    if (remaining > 0.01) {
      toast.error(
        `Only ${formatMoney(parsedAmount - remaining)} could be applied - outstanding GRNs total less than the payment amount.`
      );
    }
  }

  async function handleSave() {
    if (!paymentDate) {
      toast.error("Select a payment date.");
      return;
    }

    if (!amount.trim() || parsedAmount <= 0) {
      toast.error("Enter an amount greater than 0.");
      return;
    }

    if (allocationMismatch) {
      toast.error(
        `Allocated ${formatMoney(totalAllocated)} but the payment is ${formatMoney(parsedAmount)} - these must match exactly.`
      );
      return;
    }

    const allocationInputs = Object.entries(allocations)
      .filter(([, value]) => Number(value || 0) > 0)
      .map(([grnId, value]) => ({ grnId, amount: Number(value) }));

    if (allocationInputs.length === 0) {
      toast.error("Allocate this payment against at least one outstanding GRN.");
      return;
    }

    try {
      setSaving(true);

      await recordSupplierPayment({
        supplierId,
        paymentDate,
        paymentMethod,
        amount: parsedAmount,
        allocations: allocationInputs,
        reference: reference.trim() || undefined,
        notes: notes.trim() || undefined,
      });

      toast.success("Supplier payment recorded.");

      await onSaved();

      onClose();
    } catch (error) {
      toast.error(getSafeErrorMessage(error, "Unable to record payment."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      title={`Record Payment - ${supplierName}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Recording..." : "Record Payment"}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="grid gap-5 sm:grid-cols-2">
          <FormInput
            label="Payment Date"
            type="date"
            required
            value={paymentDate}
            onChange={setPaymentDate}
          />

          <div>
            <label className="mb-2 block text-sm font-semibold text-graphite">
              Payment Method
            </label>
            <select
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value)}
              className="min-h-11 w-full rounded-lg border border-sea-glass bg-enamel px-3 py-2.5 text-sm text-graphite focus:border-eucalyptus focus:outline-none"
            >
              {PAYMENT_METHODS.map((method) => (
                <option key={method} value={method}>
                  {method}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <FormInput label="Amount" type="number" required value={amount} onChange={setAmount} />
          <FormInput
            label="Reference / Transaction Code (optional)"
            value={reference}
            onChange={setReference}
          />
        </div>

        <FormTextarea label="Notes (optional)" value={notes} onChange={setNotes} />

        <div>
          <div className="mb-2 flex items-center justify-between">
            <label className="text-sm font-semibold text-graphite">
              Apply Against Outstanding GRNs
            </label>
            <button
              type="button"
              onClick={autoFill}
              className="text-xs font-medium text-eucalyptus hover:underline"
            >
              Auto-fill from oldest
            </button>
          </div>

          {loadingGrns ? (
            <p className="text-sm text-mineral">Loading outstanding GRNs...</p>
          ) : outstandingGrns.length === 0 ? (
            <p className="rounded-lg border border-dashed border-sea-glass px-4 py-6 text-center text-sm text-mineral">
              No outstanding GRNs for this supplier.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-sea-glass">
              <table className="min-w-full text-sm">
                <thead className="bg-porcelain">
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold">GRN</th>
                    <th className="px-4 py-3 text-right font-semibold">Outstanding</th>
                    <th className="px-4 py-3 text-right font-semibold">Apply</th>
                  </tr>
                </thead>
                <tbody>
                  {outstandingGrns.map((grn) => (
                    <tr key={grn.grnId} className="border-t border-sea-glass">
                      <td className="px-4 py-3 font-medium">{grn.grnNumber}</td>
                      <td className="px-4 py-3 text-right">
                        {formatMoney(grn.outstandingAmount)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <input
                          type="number"
                          value={allocations[grn.grnId] ?? ""}
                          onChange={(e) => handleAllocationChange(grn.grnId, e.target.value)}
                          className="w-32 rounded-md border border-sea-glass bg-enamel px-2 py-1.5 text-right text-sm focus:border-eucalyptus focus:outline-none"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div
          className={`rounded-lg border px-4 py-3 text-sm ${
            allocationMismatch && (parsedAmount > 0 || totalAllocated > 0)
              ? "border-clay bg-red-50 text-clay"
              : "border-sea-glass bg-porcelain text-graphite"
          }`}
        >
          Payment: {formatMoney(parsedAmount)} · Allocated: {formatMoney(totalAllocated)}
          {allocationMismatch && (parsedAmount > 0 || totalAllocated > 0) && (
            <span className="ml-2 font-semibold">— must match exactly</span>
          )}
        </div>
      </div>
    </Modal>
  );
}
