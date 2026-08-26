"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import Modal from "@/components/ui/Modal";
import Button from "@/components/ui/Button";
import PaymentMethodField from "@/components/billing/PaymentMethodField";

import {
  ClinicChargeWithDetails,
  calculateInvoiceTotals,
  createInvoice,
} from "@/services/billing";
import { ClinicSettings } from "@/services/settings";
import { getSafeErrorMessage } from "@/lib/logError";

interface Props {
  open: boolean;
  charges: ClinicChargeWithDetails[];
  patientName: string;
  currency: string;
  clinicSettings: ClinicSettings | null;
  onClose: () => void;
  onCreated: () => Promise<void>;
}

function chargeTeeth(charge: ClinicChargeWithDetails): number[] {
  const item = charge.treatment_plan_items;

  if (item) {
    if (item.treatment_teeth && item.treatment_teeth.length > 0) {
      return [...item.treatment_teeth]
        .map((row) => row.tooth_number)
        .sort((a, b) => a - b);
    }

    return item.tooth_number != null ? [item.tooth_number] : [];
  }

  return charge.tooth_number != null ? [charge.tooth_number] : [];
}

/**
 * Phase I section 13: an explicit confirmation step before a Pending
 * charge selection actually becomes an invoice - the existing Billing
 * page already required a distinct "Generate Invoice" click (never
 * invoiced on a row click), but this adds the full Patient/Treatment(s)
 * /Teeth/Subtotal/Tax/Total breakdown the spec asks for, reusing the same
 * calculateInvoiceTotals() single source of truth createInvoice() itself
 * uses server-side, so the preview can never drift from the real total.
 */
export default function InvoicePreviewModal({
  open,
  charges,
  patientName,
  currency,
  clinicSettings,
  onClose,
  onCreated,
}: Props) {
  const router = useRouter();

  const [paymentMethod, setPaymentMethod] = useState<string | null>(null);
  const [insuranceProviderId, setInsuranceProviderId] = useState<
    string | null
  >(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!open) return;

    setPaymentMethod(null);
    setInsuranceProviderId(null);
  }, [open]);

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount);

  const grossAmount = charges.reduce(
    (sum, charge) => sum + Number(charge.amount),
    0
  );

  const totals = calculateInvoiceTotals(grossAmount, 0, {
    enabled: clinicSettings?.tax_enabled ?? false,
    rate: Number(clinicSettings?.tax_rate ?? 0),
    inclusive: clinicSettings?.prices_include_tax ?? false,
  });

  async function handleCreate() {
    if (charges.length === 0) return;

    const patientIds = [...new Set(charges.map((c) => c.patient_id))];

    if (patientIds.length !== 1) {
      toast.error("Please select charges for one patient only.");
      return;
    }

    try {
      setCreating(true);

      const invoice = await createInvoice(
        patientIds[0],
        charges,
        0,
        undefined,
        paymentMethod,
        insuranceProviderId
      );

      await onCreated();

      toast.success(`Invoice ${invoice.invoice_number} created.`);

      onClose();

      router.push(`/admin/billing/${invoice.id}`);
    } catch (error) {
      toast.error(getSafeErrorMessage(error, "Failed to create invoice."));
    } finally {
      setCreating(false);
    }
  }

  if (!open) return null;

  return (
    <Modal
      open={open}
      title="Review & Create Invoice"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={creating}>
            Cancel
          </Button>

          <Button
            onClick={handleCreate}
            disabled={creating || charges.length === 0}
          >
            {creating ? "Creating..." : "Create Invoice"}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-mineral">
            Patient
          </p>
          <p className="mt-1 font-semibold text-graphite">{patientName}</p>
        </div>

        <div className="space-y-2 rounded-lg border border-sea-glass p-4">
          {charges.map((charge) => {
            const teeth = chargeTeeth(charge);
            const item = charge.treatment_plan_items;
            const unitPrice = item
              ? Number(charge.amount) / item.quantity
              : Number(charge.amount);

            return (
              <div
                key={charge.id}
                className="flex items-start justify-between gap-3 border-b border-sea-glass py-2 last:border-b-0"
              >
                <div>
                  <p className="font-medium text-graphite">
                    {charge.treatment_name}
                  </p>
                  <p className="text-xs text-mineral">
                    {teeth.length === 0
                      ? "No tooth association"
                      : `${teeth.length === 1 ? "Tooth" : "Teeth"} ${teeth.join(" · ")}`}
                  </p>
                </div>

                <p className="shrink-0 text-right text-sm font-medium text-graphite">
                  {item && item.quantity > 1
                    ? `${formatCurrency(unitPrice)} × ${item.quantity} = ${formatCurrency(Number(charge.amount))}`
                    : formatCurrency(Number(charge.amount))}
                </p>
              </div>
            );
          })}
        </div>

        <div className="space-y-2 rounded-xl border border-sea-glass p-4">
          <div className="flex justify-between text-sm">
            <span className="text-mineral">Subtotal</span>
            <span className="font-medium text-graphite">
              {formatCurrency(totals.subtotal)}
            </span>
          </div>

          {clinicSettings?.tax_enabled && (
            <div className="flex justify-between text-sm">
              <span className="text-mineral">
                {clinicSettings.tax_name} ({Number(clinicSettings.tax_rate)}%)
              </span>
              <span className="font-medium text-graphite">
                {formatCurrency(totals.tax)}
              </span>
            </div>
          )}

          <div className="flex justify-between border-t border-sea-glass pt-2 font-bold text-graphite">
            <span>Total</span>
            <span>{formatCurrency(totals.total)}</span>
          </div>
        </div>

        <PaymentMethodField
          paymentMethod={paymentMethod}
          onPaymentMethodChange={setPaymentMethod}
          insuranceProviderId={insuranceProviderId}
          onInsuranceProviderChange={setInsuranceProviderId}
        />
      </div>
    </Modal>
  );
}
