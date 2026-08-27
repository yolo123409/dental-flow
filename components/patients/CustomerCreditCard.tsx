"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";

import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";

import ApplyCustomerCreditModal from "@/components/billing/ApplyCustomerCreditModal";
import RefundCustomerCreditModal from "@/components/billing/RefundCustomerCreditModal";

import { getPatientCredits } from "@/services/customerCredits";
import { getPatientInvoices, ClinicInvoice } from "@/services/billing";
import { getSafeErrorMessage } from "@/lib/logError";

import { CustomerCreditWithInvoice } from "@/types/customerCredits";

interface Props {
  patientId: string;
  patientName: string;
  currency: string;
}

/**
 * FIN-4.7: the patient-facing Customer Credit section - the UI FIN-4.4's
 * backend (grant/apply/refund_customer_credit, migration 0100) never had.
 * Shown only inside the patient page's Billing tab, which is already
 * gated on the "billing" permission (see app/admin/patients/[id]/page.tsx) -
 * the exact same role set (Owner/Admin/Receptionist) migration 0100's own
 * RPCs check server-side, so no separate guard is added here.
 *
 * Loads its own data (credits + this patient's outstanding invoices, the
 * only valid Apply targets) rather than taking them as props - the same
 * self-contained pattern ArAgingCenter already uses on the Billing
 * Control Center page.
 */
export default function CustomerCreditCard({ patientId, patientName, currency }: Props) {
  const [credits, setCredits] = useState<CustomerCreditWithInvoice[]>([]);
  const [outstandingInvoices, setOutstandingInvoices] = useState<ClinicInvoice[]>([]);
  const [loading, setLoading] = useState(true);

  const [applyTarget, setApplyTarget] = useState<CustomerCreditWithInvoice | null>(null);
  const [refundTarget, setRefundTarget] = useState<CustomerCreditWithInvoice | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const [creditRows, invoices] = await Promise.all([
        getPatientCredits(patientId),
        getPatientInvoices(patientId),
      ]);
      setCredits(creditRows);
      setOutstandingInvoices(invoices.filter((inv) => Number(inv.balance) > 0));
    } catch (error) {
      toast.error(getSafeErrorMessage(error, "Failed to load customer credit."));
    } finally {
      setLoading(false);
    }
  }, [patientId]);

  useEffect(() => {
    load();
  }, [load]);

  const formatMoney = (value: number) =>
    new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(value);

  const totalAvailable = credits.reduce((sum, c) => sum + Number(c.remaining_amount), 0);

  async function handleActionSuccess() {
    setApplyTarget(null);
    setRefundTarget(null);
    await load();
  }

  if (loading) {
    return (
      <Card title="Customer Credit">
        <div className="py-8 text-center text-mineral">Loading...</div>
      </Card>
    );
  }

  return (
    <>
      <Card title="Customer Credit">
        <div className="space-y-5">
          <div className="flex items-center justify-between rounded-xl bg-pale-sage p-4">
            <div>
              <p className="text-sm text-sage-ink">Available Credit</p>
              <h2 className="text-2xl font-bold text-sage-ink">
                {formatMoney(totalAvailable)}
              </h2>
            </div>
          </div>

          {credits.length === 0 ? (
            <EmptyState
              title="No customer credit on file."
              description="A credit appears here automatically when an overpaid invoice is granted as credit from the invoice's detail page."
            />
          ) : (
            <div className="space-y-3">
              {credits.map((credit) => {
                const remaining = Number(credit.remaining_amount);
                const isAvailable = remaining > 0;

                return (
                  <div
                    key={credit.id}
                    className="rounded-xl border border-sea-glass p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-graphite">
                            {credit.source_invoice ? (
                              <Link
                                href={`/admin/billing/${credit.source_invoice_id}`}
                                className="text-eucalyptus hover:underline"
                              >
                                Credit from {credit.source_invoice.invoice_number}
                              </Link>
                            ) : (
                              "Customer credit"
                            )}
                          </p>
                          <Badge color={isAvailable ? "green" : "gray"}>
                            {isAvailable ? "Available" : "Fully Used"}
                          </Badge>
                        </div>
                        <p className="mt-1 text-xs text-mineral">
                          Granted {new Date(credit.created_at).toLocaleDateString()}
                        </p>
                        {credit.notes && (
                          <p className="mt-1 text-xs text-mineral">{credit.notes}</p>
                        )}
                      </div>

                      <div className="text-right">
                        <p className="font-bold text-graphite">
                          {formatMoney(remaining)}
                        </p>
                        <p className="text-xs text-mineral">
                          of {formatMoney(Number(credit.amount))}
                        </p>
                      </div>
                    </div>

                    {isAvailable && (
                      <div className="mt-3 flex gap-2 border-t border-sea-glass pt-3">
                        <Button
                          variant="secondary"
                          className="px-3 py-1.5 text-xs"
                          onClick={() => setApplyTarget(credit)}
                        >
                          Apply to Invoice
                        </Button>
                        <Button
                          variant="secondary"
                          className="px-3 py-1.5 text-xs"
                          onClick={() => setRefundTarget(credit)}
                        >
                          Refund
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Card>

      {applyTarget && (
        <ApplyCustomerCreditModal
          creditId={applyTarget.id}
          creditRemaining={Number(applyTarget.remaining_amount)}
          patientName={patientName}
          currency={currency}
          outstandingInvoices={outstandingInvoices}
          open={applyTarget != null}
          onClose={() => setApplyTarget(null)}
          onSuccess={handleActionSuccess}
        />
      )}

      {refundTarget && (
        <RefundCustomerCreditModal
          creditId={refundTarget.id}
          creditRemaining={Number(refundTarget.remaining_amount)}
          patientName={patientName}
          currency={currency}
          open={refundTarget != null}
          onClose={() => setRefundTarget(null)}
          onSuccess={handleActionSuccess}
        />
      )}
    </>
  );
}
