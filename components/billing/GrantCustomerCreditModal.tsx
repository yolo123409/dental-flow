"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import Modal from "@/components/ui/Modal";
import Button from "@/components/ui/Button";

import { grantCustomerCredit } from "@/services/customerCredits";
import { getSafeErrorMessage } from "@/lib/logError";

interface Props {
  invoiceId: string;
  invoiceNumber: string;
  patientName: string;
  currency: string;
  /** -balance on an overpaid invoice - always > 0 when this modal is shown. */
  overpaymentAmount: number;
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

/**
 * FIN-4.7: the only way to grant a Customer Credit through the UI - a
 * confirmation step in front of grant_customer_credit() (migration 0100),
 * which reclassifies the invoice's excess into the Customer Credits
 * liability without touching the invoice's own historical amount_paid/
 * balance/status. Always credits the FULL overpayment (the amount
 * argument is omitted, matching services/customerCredits.ts's default) -
 * a partial-amount grant isn't exposed here because there's no scenario
 * in this app today where crediting less than the full overpayment would
 * be correct: the remainder would just sit as an unexplained negative
 * balance with no accounting home.
 */
export default function GrantCustomerCreditModal({
  invoiceId,
  invoiceNumber,
  patientName,
  currency,
  overpaymentAmount,
  open,
  onClose,
  onSuccess,
}: Props) {
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setNotes("");
  }, [open]);

  if (!open) return null;

  const formatMoney = (value: number) =>
    new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(value);

  async function handleGrant() {
    try {
      setSaving(true);
      await grantCustomerCredit(invoiceId, undefined, notes || undefined);
      onSuccess();
      onClose();
      toast.success("Customer credit granted.");
    } catch (error) {
      toast.error(getSafeErrorMessage(error, "Failed to grant customer credit."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      title="Grant Customer Credit"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleGrant} disabled={saving}>
            {saving ? "Granting..." : "Grant Credit"}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg border border-sea-glass p-4 text-sm">
          <dt className="text-mineral">Invoice</dt>
          <dd className="text-right font-medium text-graphite">{invoiceNumber}</dd>

          <dt className="text-mineral">Patient</dt>
          <dd className="text-right font-medium text-graphite">{patientName}</dd>

          <dt className="font-semibold text-graphite">Overpayment</dt>
          <dd className="text-right text-base font-bold text-graphite">
            {formatMoney(overpaymentAmount)}
          </dd>
        </dl>

        <p className="text-sm text-mineral">
          This moves the full overpayment out of Accounts Receivable and
          into a Customer Credit the patient can apply to a future invoice
          or have refunded. The invoice&apos;s own paid/balance history is
          never changed.
        </p>

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
