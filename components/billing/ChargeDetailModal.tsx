"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import Modal from "@/components/ui/Modal";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import RecordPaymentModal from "@/components/billing/RecordPaymentModal";

import { ClinicChargeWithDetails, getChargeById } from "@/services/billing";
import { logError } from "@/lib/logError";

interface Props {
  charge: ClinicChargeWithDetails | null;
  currency: string;
  onClose: () => void;
  /** Phase J section 18: bubbles up so the Billing page can refresh the
   * summary cards and the row/list this charge came from after a payment -
   * this modal never mutates its own `charge` prop in place. */
  onPaymentRecorded: () => void;
}

/**
 * Phase I section 22 / Phase J section 3: a charge's full detail -
 * patient, Treatment (if canonical), teeth, invoice, and now payment
 * state + a Record Payment action, reusing the exact same
 * RecordPaymentModal/recordPayment() the Invoice Detail page uses (Phase
 * J section 2) - never a second payment implementation.
 */
export default function ChargeDetailModal({
  charge: chargeProp,
  currency,
  onClose,
  onPaymentRecorded,
}: Props) {
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);

  // Phase J section 21/22: after a payment, the panel updates in place
  // (fresh Paid/Balance/Status) rather than closing - this holds that one
  // refetched charge; reset whenever a DIFFERENT charge is opened.
  const [refreshedCharge, setRefreshedCharge] =
    useState<ClinicChargeWithDetails | null>(null);

  useEffect(() => {
    setRefreshedCharge(null);
  }, [chargeProp?.id]);

  const charge = refreshedCharge ?? chargeProp;

  if (!charge) return null;

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount);

  const item = charge.treatment_plan_items;
  const isCanonical = charge.treatment_plan_item_id != null;

  const teeth = isCanonical
    ? item?.treatment_teeth && item.treatment_teeth.length > 0
      ? [...item.treatment_teeth].map((row) => row.tooth_number).sort((a, b) => a - b)
      : item?.tooth_number != null
        ? [item.tooth_number]
        : []
    : charge.tooth_number != null
      ? [charge.tooth_number]
      : [];

  const patientName = charge.patients
    ? `${charge.patients.first_name} ${charge.patients.last_name}`
    : "Unknown patient";

  const invoice = charge.clinic_invoices;
  const hasOutstandingBalance = invoice != null && Number(invoice.balance) > 0;

  const chargeId = charge.id;

  async function handlePaymentRecorded() {
    setPaymentModalOpen(false);

    try {
      const fresh = await getChargeById(chargeId);

      if (fresh) {
        setRefreshedCharge(fresh);
      }
    } catch (error) {
      logError("[ChargeDetailModal] Failed to refresh charge after payment:", error);
    }

    onPaymentRecorded();
  }

  return (
    <>
      <Modal
        open={charge != null}
        title="Charge Detail"
        onClose={onClose}
        footer={
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        }
      >
        <div className="space-y-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-lg font-semibold text-graphite">
                {charge.treatment_name}
              </p>

              {charge.patients ? (
                <Link
                  href={`/admin/patients/${charge.patients.id}`}
                  className="text-sm text-eucalyptus hover:underline"
                >
                  {patientName}
                </Link>
              ) : (
                <p className="text-sm text-mineral">{patientName}</p>
              )}
            </div>

            <Badge color={isCanonical ? "blue" : "gray"}>
              {isCanonical ? "Treatment Plan" : "Legacy Tooth Charge"}
            </Badge>
          </div>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-lg border border-sea-glass p-4 text-sm">
            <dt className="text-mineral">Teeth</dt>
            <dd className="text-right font-medium text-graphite">
              {teeth.length === 0
                ? "No tooth association"
                : `${teeth.length === 1 ? "Tooth" : "Teeth"} ${teeth.join(" · ")}`}
            </dd>

            {isCanonical && item && (
              <>
                <dt className="text-mineral">Quantity</dt>
                <dd className="text-right font-medium text-graphite">
                  {item.quantity}
                </dd>

                <dt className="text-mineral">Unit Price</dt>
                <dd className="text-right font-medium text-graphite">
                  {formatCurrency(Number(charge.amount) / item.quantity)}
                </dd>
              </>
            )}

            <dt className="text-mineral">Amount</dt>
            <dd className="text-right font-bold text-graphite">
              {formatCurrency(Number(charge.amount))}
            </dd>

            <dt className="text-mineral">Status</dt>
            <dd className="text-right">
              <Badge color={charge.status === "Invoiced" ? "green" : "yellow"}>
                {charge.status}
              </Badge>
            </dd>

            <dt className="text-mineral">Created</dt>
            <dd className="text-right font-medium text-graphite">
              {new Date(charge.created_at).toLocaleDateString()}
            </dd>
          </dl>

          <div className="rounded-lg border border-sea-glass p-4">
            <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.08em] text-mineral">
              Treatment Plan
            </p>

            {isCanonical && item ? (
              <div className="flex items-center justify-between">
                <span className="text-sm text-graphite">
                  {item.treatment_plans?.title ?? "Treatment Plan"}
                </span>

                <Link
                  href={`/admin/patients/${charge.patient_id}?tab=Treatment+Plans&plan=${item.treatment_plan_id}`}
                  className="text-sm font-semibold text-eucalyptus hover:underline"
                >
                  View Treatment
                </Link>
              </div>
            ) : (
              <p className="text-sm text-mineral">
                This is a Legacy Tooth Charge - it has no Treatment Plan
                relationship.
              </p>
            )}
          </div>

          <div className="rounded-lg border border-sea-glass p-4">
            <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.08em] text-mineral">
              Invoice &amp; Payment
            </p>

            {invoice ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-graphite">
                    {invoice.invoice_number}
                  </span>

                  <Link
                    href={`/admin/billing/${invoice.id}`}
                    className="text-sm font-semibold text-eucalyptus hover:underline"
                  >
                    View Invoice
                  </Link>
                </div>

                <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                  <dt className="text-mineral">Invoice Status</dt>
                  <dd className="text-right">
                    <Badge
                      color={
                        invoice.status === "Paid"
                          ? "green"
                          : invoice.status === "Partially Paid"
                            ? "yellow"
                            : "red"
                      }
                    >
                      {invoice.status}
                    </Badge>
                  </dd>

                  <dt className="text-mineral">Amount Paid</dt>
                  <dd className="text-right font-medium text-graphite">
                    {formatCurrency(Number(invoice.amount_paid))}
                  </dd>

                  <dt className="text-mineral">Balance</dt>
                  <dd className="text-right font-bold text-graphite">
                    {formatCurrency(Number(invoice.balance))}
                  </dd>
                </dl>

                {hasOutstandingBalance ? (
                  <Button
                    className="w-full"
                    onClick={() => setPaymentModalOpen(true)}
                  >
                    Record Payment
                  </Button>
                ) : (
                  <div className="flex items-center justify-center gap-2 rounded-lg bg-pale-sage py-2.5 text-sm font-semibold text-sage-ink">
                    Paid
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-mineral">
                Not yet invoiced - ready to bill.
              </p>
            )}
          </div>
        </div>
      </Modal>

      {invoice && (
        <RecordPaymentModal
          invoiceId={invoice.id}
          invoiceNumber={invoice.invoice_number}
          patientName={patientName}
          currency={currency}
          total={Number(invoice.total)}
          amountPaid={Number(invoice.amount_paid)}
          balance={Number(invoice.balance)}
          invoicePaymentMethod={invoice.payment_method}
          invoiceInsuranceProviderId={invoice.insurance_provider_id}
          invoiceInsuranceProviderName={
            invoice.insurance_provider?.name ?? null
          }
          open={paymentModalOpen}
          onClose={() => setPaymentModalOpen(false)}
          onSuccess={handlePaymentRecorded}
        />
      )}
    </>
  );
}
