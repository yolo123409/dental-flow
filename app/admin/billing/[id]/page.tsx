"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { toast } from "sonner";

import jsPDF from "jspdf";
import { toPng } from "html-to-image";

import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";

import {
  getInvoice,
  voidInvoice,
  voidPayment,
  ClinicInvoice,
  InvoiceItem,
  ClinicPayment,
} from "@/services/billing";
import {
  getClinicSettings,
  ClinicSettings,
} from "@/services/settings";
import {
  getFinancialAuditLog,
  FinancialAuditLogEntry,
} from "@/services/financialAuditLog";

import RecordPaymentModal from "@/components/billing/RecordPaymentModal";
import GrantCustomerCreditModal from "@/components/billing/GrantCustomerCreditModal";
import ClinicBrandingHeader from "@/components/branding/ClinicBrandingHeader";
import PermissionGuard from "@/components/auth/PermissionGuard";
import Modal from "@/components/ui/Modal";
import usePermissions from "@/hooks/usePermissions";
import { getSafeErrorMessage } from "@/lib/logError";

type VoidTarget =
  | { kind: "invoice" }
  | { kind: "payment"; paymentId: string; amount: number };

interface InvoiceDetail extends ClinicInvoice {
  patients: {
    id: string;
    first_name: string;
    last_name: string;
    phone: string;
    email: string | null;
  } | null;

  clinic_invoice_items: InvoiceItem[];

  clinic_payments: ClinicPayment[];
}

function InvoicePageContent() {
  const params = useParams();
  const id = params.id as string;

  const { hasPermission } = usePermissions();

  const invoiceRef =
    useRef<HTMLDivElement>(null);

  const [loading, setLoading] =
    useState(true);

  const [invoice, setInvoice] =
    useState<InvoiceDetail | null>(null);

  const [clinic, setClinic] =
    useState<ClinicSettings | null>(null);

  const [
    showPaymentModal,
    setShowPaymentModal,
  ] = useState(false);

  const [showGrantCreditModal, setShowGrantCreditModal] = useState(false);

  // Void is Owner/Admin only, enforced for real in void_invoice()/
  // void_payment() (0110) - "ledger" is the existing permission that
  // already means exactly that in this app's role table, reused here
  // rather than inventing a new one.
  const canVoid = hasPermission("ledger");
  const [voidTarget, setVoidTarget] = useState<VoidTarget | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [voiding, setVoiding] = useState(false);

  // Billing audit fix #5 - who changed what on this invoice, and when.
  // Same "ledger" permission as voiding, since getFinancialAuditLog()
  // enforces it server-side regardless.
  const [auditLog, setAuditLog] = useState<FinancialAuditLogEntry[]>([]);

  useEffect(() => {
    loadInvoice();
  }, [id]);

  useEffect(() => {
    if (!canVoid) return;

    getFinancialAuditLog("clinic_invoices", id)
      .then(setAuditLog)
      .catch((error) => console.error(error));
  }, [id, canVoid, invoice?.status]);

  async function loadInvoice() {
    try {
      setLoading(true);

      const [
        invoiceResult,
        clinicResult,
      ] = await Promise.all([
        getInvoice(id),
        getClinicSettings(),
      ]);

      setInvoice(invoiceResult);
      setClinic(clinicResult);
    } catch (error) {
      toast.error(
        getSafeErrorMessage(error, "Failed to load invoice.")
      );
    } finally {
      setLoading(false);
    }
  }

  async function confirmVoid() {
    if (!voidTarget || !voidReason.trim()) return;

    try {
      setVoiding(true);

      if (voidTarget.kind === "invoice") {
        await voidInvoice(id, voidReason.trim());
        toast.success("Invoice voided.");
      } else {
        await voidPayment(voidTarget.paymentId, voidReason.trim());
        toast.success("Payment voided.");
      }

      setVoidTarget(null);
      setVoidReason("");

      await loadInvoice();
    } catch (error) {
      toast.error(getSafeErrorMessage(error, "Failed to void."));
    } finally {
      setVoiding(false);
    }
  }

async function downloadPDF() {
  if (!invoiceRef.current || !invoice) return;

  try {
    const dataUrl = await toPng(invoiceRef.current, {
      cacheBust: true,
      pixelRatio: 2,
      backgroundColor: "#ffffff",
    });

    const pdf = new jsPDF({
      orientation: "portrait",
      unit: "mm",
      format: "a4",
    });

    const img = new Image();

    img.src = dataUrl;

    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () =>
        reject(new Error("Failed to load generated image."));
    });

    const pageWidth = pdf.internal.pageSize.getWidth();

    const pageHeight =
      (img.height * pageWidth) /
      img.width;

    pdf.addImage(
      dataUrl,
      "PNG",
      0,
      0,
      pageWidth,
      pageHeight
    );

    pdf.save(
      `${invoice.invoice_number}.pdf`
    );
  } catch (error) {
    console.error(error);
    toast.error("Failed to generate PDF.");
  }
}

  function formatMoney(
    amount: number
  ) {
    return new Intl.NumberFormat(
      undefined,
      {
        style: "currency",
        currency:
          clinic?.currency ??
          "KES",
      }
    ).format(amount);
  }

  // Turns a logged before/after row into a one-line summary of exactly
  // what changed, rather than dumping raw JSON at anyone reading this.
  function summarizeAuditEntry(entry: FinancialAuditLogEntry): string {
    if (entry.action === "insert") return "Invoice created.";

    const before = entry.before_value ?? {};
    const after = entry.after_value ?? {};

    const changes: string[] = [];

    for (const key of ["status", "amount_paid", "balance"]) {
      if (before[key] !== after[key]) {
        changes.push(`${key.replace("_", " ")}: ${before[key]} → ${after[key]}`);
      }
    }

    return changes.length > 0 ? changes.join(", ") : "Updated.";
  }

  if (loading || !clinic) {
    return (
      <div className="py-24 text-center">
        Loading invoice...
      </div>
    );
  }

  if (!invoice) {
    return (
      <div className="py-24 text-center">
        Invoice not found.
      </div>
    );
  }

  const patient =
    invoice.patients;

  return (
    <>

      <div className="space-y-8">

        {/* Header */}

        <div className="flex items-start justify-between print:hidden">

          <div>

            <h1 className="text-3xl font-bold">
              Invoice
            </h1>

            <p className="mt-2 text-slate-500">
              {invoice.invoice_number}
            </p>

          </div>

          <div className="flex items-center gap-3">

            <span
              className={`rounded-full px-4 py-2 text-sm font-semibold ${
                invoice.status ===
                "Paid"
                  ? "bg-green-100 text-green-700"
                  : invoice.status ===
                    "Partially Paid"
                  ? "bg-amber-100 text-amber-700"
                  : invoice.status === "Voided"
                  ? "bg-slate-200 text-slate-600"
                  : "bg-red-100 text-red-700"
              }`}
            >
              {invoice.status}
            </span>

            {canVoid && invoice.status !== "Voided" && (
              <Button
                variant="secondary"
                onClick={() => setVoidTarget({ kind: "invoice" })}
              >
                Void Invoice
              </Button>
            )}

          </div>

        </div>

        <div ref={invoiceRef}>

          <Card>

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-8 print:border-none print:bg-white">

              <div className="flex justify-between">

                <ClinicBrandingHeader
                  clinic={clinic}
                />

                <div className="text-right">

                  <p className="text-sm text-slate-500">
                    Invoice Number
                  </p>

                  <p className="font-semibold">
                    {
                      invoice.invoice_number
                    }
                  </p>

                  <p className="mt-4 text-sm text-slate-500">
                    Date
                  </p>

                  <p>
                    {new Date(
                      invoice.created_at
                    ).toLocaleDateString()}
                  </p>

                </div>

              </div>

              <hr className="my-8" />

              <div className="grid gap-8 md:grid-cols-2">

                <div>

                  <h3 className="mb-2 font-semibold uppercase tracking-wide text-slate-500">
                    Bill To
                  </h3>

                  <p className="text-lg font-semibold">
                    {patient
                      ? `${patient.first_name} ${patient.last_name}`
                      : "-"}
                  </p>

                  <p>
                    {patient?.phone ||
                      "-"}
                  </p>

                  <p>
                    {patient?.email ||
                      "-"}
                  </p>

                </div>

                <div>

                  <h3 className="mb-2 font-semibold uppercase tracking-wide text-slate-500">
                    Invoice Details
                  </h3>

                  <div className="space-y-2">

                    <div className="flex justify-between">

                      <span>
                        Status
                      </span>

                      <span className="font-medium">
                        {
                          invoice.status
                        }
                      </span>

                    </div>

                    <div className="flex justify-between">

                      <span>
                        Issued
                      </span>

                      <span>
                        {new Date(
                          invoice.created_at
                        ).toLocaleDateString()}
                      </span>

                    </div>

                    {invoice.payment_method && (

                      <div className="flex justify-between">

                        <span>
                          Payment Method
                        </span>

                        <span className="font-medium">
                          {invoice.payment_method}
                        </span>

                      </div>

                    )}

                    {invoice.payment_method === "Insurance" &&
                      invoice.insurance_provider?.name && (

                        <div className="flex justify-between">

                          <span>
                            Insurance Provider
                          </span>

                          <span className="font-medium">
                            {invoice.insurance_provider.name}
                          </span>

                        </div>

                      )}

                    {invoice.tax_enabled &&
                      invoice.tax_registration_number && (

                        <div className="flex justify-between">

                          <span>
                            {invoice.tax_name} Reg. No.
                          </span>

                          <span>
                            {
                              invoice.tax_registration_number
                            }
                          </span>

                        </div>

                      )}

                  </div>

                </div>

              </div>

            </div>

          </Card>

                  {/* Treatment Items */}

        <Card title="Treatment Items">

          <div className="overflow-x-auto">

            <table className="w-full">

              <thead>

                <tr className="border-b bg-slate-50">

                  <th className="px-4 py-3 text-left">
                    Treatment
                  </th>

                  <th className="px-4 py-3 text-center">
                    Qty
                  </th>

                  <th className="px-4 py-3 text-right">
                    Unit Price
                  </th>

                  <th className="px-4 py-3 text-right">
                    Total
                  </th>

                </tr>

              </thead>

              <tbody>

                {invoice.clinic_invoice_items?.map(
                  (item) => (

                    <tr
                      key={item.id}
                      className="border-b"
                    >

                      <td className="px-4 py-4">
                        {item.treatment_name}
                      </td>

                      <td className="px-4 py-4 text-center">
                        {item.quantity}
                      </td>

                      <td className="px-4 py-4 text-right">
                        {formatMoney(
                          Number(item.unit_price)
                        )}
                      </td>

                      <td className="px-4 py-4 text-right font-semibold">
                        {formatMoney(
                          Number(item.total_price)
                        )}
                      </td>

                    </tr>

                  )
                )}

              </tbody>

            </table>

          </div>

        </Card>

        {/* Payment + Summary */}

        <div className="grid gap-6 lg:grid-cols-2">

          <Card title="Payment History">

            {invoice.clinic_payments?.length ? (

              <div className="space-y-4">

                {invoice.clinic_payments.map(
                  (payment) => (

                    <div
                      key={payment.id}
                      className={`flex items-center justify-between rounded-lg border p-4 ${
                        payment.status === "Voided" ? "opacity-60" : ""
                      }`}
                    >

                      <div>

                        {payment.payment_method === "Insurance" &&
                        payment.insurance_provider?.name ? (
                          <>
                            <p className="font-medium">
                              {payment.insurance_provider.name}
                            </p>
                            <p className="text-xs text-slate-500">
                              Insurance
                            </p>
                          </>
                        ) : (
                          <p className="font-medium">
                            {payment.payment_method}
                          </p>
                        )}

                        <p className="text-sm text-slate-500">
                          {new Date(
                            payment.created_at
                          ).toLocaleDateString()}
                        </p>

                        {payment.reference && (

                          <p className="text-xs text-slate-500">
                            Ref: {payment.reference}
                          </p>

                        )}

                        {payment.status === "Voided" && (
                          <p className="text-xs font-medium text-slate-500">
                            Voided{payment.void_reason ? ` - ${payment.void_reason}` : ""}
                          </p>
                        )}

                      </div>

                      <div className="flex items-center gap-3">

                        <p
                          className={`font-semibold ${
                            payment.status === "Voided"
                              ? "text-slate-400 line-through"
                              : "text-green-600"
                          }`}
                        >
                          {formatMoney(
                            Number(payment.amount)
                          )}
                        </p>

                        {canVoid && payment.status !== "Voided" && (
                          <Button
                            variant="secondary"
                            onClick={() =>
                              setVoidTarget({
                                kind: "payment",
                                paymentId: payment.id,
                                amount: Number(payment.amount),
                              })
                            }
                          >
                            Void
                          </Button>
                        )}

                      </div>

                    </div>

                  )
                )}

              </div>

            ) : (

              <div className="rounded-lg border border-dashed p-8 text-center text-slate-500">
                No payments have been recorded yet.
              </div>

            )}

          </Card>

          <Card title="Invoice Summary">

            <div className="space-y-5">

              {Number(invoice.discount) > 0 && (

                <div className="flex justify-between">

                  <span>Discount</span>

                  <span className="font-medium">
                    {formatMoney(
                      Number(invoice.discount)
                    )}
                  </span>

                </div>

              )}

              <div className="flex justify-between">

                <span>Subtotal</span>

                <span className="font-medium">
                  {formatMoney(
                    Number(invoice.subtotal)
                  )}
                </span>

              </div>

              {invoice.tax_enabled && (

                <div className="flex justify-between">

                  <span>
                    {invoice.tax_name} (
                    {Number(invoice.tax_rate)}%)
                  </span>

                  <span className="font-medium">
                    {formatMoney(
                      Number(invoice.tax)
                    )}
                  </span>

                </div>

              )}

              <hr />

              <div className="flex justify-between text-xl font-bold">

                <span>Total</span>

                <span>
                  {formatMoney(
                    Number(invoice.total)
                  )}
                </span>

              </div>

              <div className="flex justify-between">

                <span>
                  Amount Paid
                </span>

                <span className="font-semibold text-green-600">
                  {formatMoney(
                    Number(invoice.amount_paid)
                  )}
                </span>

              </div>

              <div
                className={`flex justify-between text-lg font-bold ${
                  Number(invoice.balance) < 0 ? "text-amber-600" : "text-red-600"
                }`}
              >

                <span>
                  {Number(invoice.balance) < 0 ? "Overpaid" : "Outstanding"}
                </span>

                <span>
                  {formatMoney(
                    Number(invoice.balance) < 0
                      ? Math.abs(Number(invoice.balance))
                      : Number(invoice.balance)
                  )}
                </span>

              </div>

              {Number(invoice.balance) < 0 && (
                <div className="rounded-lg bg-amber-50 p-4 text-sm text-amber-800">
                  This invoice has been paid {formatMoney(Math.abs(Number(invoice.balance)))}{" "}
                  more than its total. Grant the excess as a Customer Credit so it can be
                  applied to a future invoice or refunded.
                </div>
              )}

              <div className="rounded-lg bg-slate-50 p-4">

                <div className="flex justify-between">

                  <span className="font-medium">
                    Status
                  </span>

                  <span
                    className={`font-semibold ${
                      invoice.status ===
                      "Paid"
                        ? "text-green-600"
                        : invoice.status ===
                          "Partially Paid"
                        ? "text-amber-600"
                        : "text-red-600"
                    }`}
                  >
                    {invoice.status}
                  </span>

                </div>

              </div>

            </div>

          </Card>

        </div>

        {invoice.tax_enabled &&
          clinic.invoice_footer_tax_note && (

            <p className="text-center text-sm text-slate-500">
              {clinic.invoice_footer_tax_note}
            </p>

          )}

        {canVoid && auditLog.length > 0 && (
          <Card title="History" className="p-2 print:hidden">
            <div className="space-y-3">
              {auditLog.map((entry) => (
                <div
                  key={entry.id}
                  className="border-b border-slate-100 pb-3 text-sm last:border-0 last:pb-0"
                >
                  <p className="text-slate-700">{summarizeAuditEntry(entry)}</p>
                  <p className="text-xs text-slate-400">
                    {entry.actor_role ?? "Unknown role"} ·{" "}
                    {new Date(entry.created_at).toLocaleString()}
                  </p>
                </div>
              ))}
            </div>
          </Card>
        )}

                {/* Action Buttons */}

        </div>

        <div className="flex justify-end gap-4 print:hidden">

          {invoice.status !== "Paid" && Number(invoice.balance) > 0 && (

            <Button
              onClick={() =>
                setShowPaymentModal(true)
              }
            >
              Record Payment
            </Button>

          )}

          {Number(invoice.balance) < 0 && (

            <Button
              onClick={() =>
                setShowGrantCreditModal(true)
              }
            >
              Grant Customer Credit
            </Button>

          )}

          <Button
            onClick={downloadPDF}
          >
            Download PDF
          </Button>

          <Button
            onClick={() =>
              window.print()
            }
          >
            Print Invoice
          </Button>

        </div>

      </div>

      <RecordPaymentModal
        invoiceId={invoice.id}
        invoiceNumber={invoice.invoice_number}
        patientName={
          patient ? `${patient.first_name} ${patient.last_name}` : "-"
        }
        currency={clinic?.currency ?? "KES"}
        total={Number(invoice.total)}
        amountPaid={Number(invoice.amount_paid)}
        balance={Number(invoice.balance)}
        invoicePaymentMethod={invoice.payment_method}
        invoiceInsuranceProviderId={invoice.insurance_provider_id}
        invoiceInsuranceProviderName={
          invoice.insurance_provider?.name ?? null
        }
        open={showPaymentModal}
        onClose={() =>
          setShowPaymentModal(false)
        }
        onSuccess={loadInvoice}
      />

      <GrantCustomerCreditModal
        invoiceId={invoice.id}
        invoiceNumber={invoice.invoice_number}
        patientName={
          patient ? `${patient.first_name} ${patient.last_name}` : "-"
        }
        currency={clinic?.currency ?? "KES"}
        overpaymentAmount={Math.abs(Number(invoice.balance))}
        open={showGrantCreditModal}
        onClose={() => setShowGrantCreditModal(false)}
        onSuccess={loadInvoice}
      />

      <Modal
        open={voidTarget !== null}
        title={voidTarget?.kind === "invoice" ? "Void Invoice?" : "Void Payment?"}
        onClose={() => {
          if (voiding) return;
          setVoidTarget(null);
          setVoidReason("");
        }}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setVoidTarget(null);
                setVoidReason("");
              }}
              disabled={voiding}
            >
              Cancel
            </Button>

            <Button
              onClick={confirmVoid}
              disabled={voiding || !voidReason.trim()}
            >
              {voiding
                ? "Voiding..."
                : voidTarget?.kind === "invoice"
                ? "Void Invoice"
                : "Void Payment"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">

          <p className="text-sm text-slate-600">
            {voidTarget?.kind === "invoice"
              ? "This reverses the invoice's ledger entry and frees its treatments back to Pending so they can be corrected and re-invoiced. Only possible while nothing has been paid against it."
              : `This reverses ${
                  voidTarget
                    ? formatMoney(voidTarget.kind === "payment" ? voidTarget.amount : 0)
                    : "this payment"
                }'s ledger entry and reduces the invoice's amount paid accordingly. The payment record is kept, marked Voided.`}
          </p>

          <div>
            <label className="mb-2 block text-sm font-medium">
              Reason (required)
            </label>
            <textarea
              rows={3}
              value={voidReason}
              onChange={(e) => setVoidReason(e.target.value)}
              placeholder="e.g. Billed the wrong treatment, patient disputed the charge..."
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>

        </div>
      </Modal>

    </>

  );
}

export default function InvoicePage() {
  return (
    <PermissionGuard permission="billing">
      <InvoicePageContent />
    </PermissionGuard>
  );
}