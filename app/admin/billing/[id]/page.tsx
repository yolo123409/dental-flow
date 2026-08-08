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
  ClinicInvoice,
  InvoiceItem,
  ClinicPayment,
} from "@/services/billing";
import {
  getClinicSettings,
  ClinicSettings,
} from "@/services/settings";

import RecordPaymentModal from "@/components/billing/RecordPaymentModal";
import ClinicBrandingHeader from "@/components/branding/ClinicBrandingHeader";

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

export default function InvoicePage() {
  const params = useParams();
  const id = params.id as string;

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

  useEffect(() => {
    loadInvoice();
  }, [id]);

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
      console.error(error);

      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to load invoice."
      );
    } finally {
      setLoading(false);
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

          <span
            className={`rounded-full px-4 py-2 text-sm font-semibold ${
              invoice.status ===
              "Paid"
                ? "bg-green-100 text-green-700"
                : invoice.status ===
                  "Partially Paid"
                ? "bg-amber-100 text-amber-700"
                : "bg-red-100 text-red-700"
            }`}
          >
            {invoice.status}
          </span>

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
                      className="flex items-center justify-between rounded-lg border p-4"
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

                      </div>

                      <p className="font-semibold text-green-600">
                        {formatMoney(
                          Number(payment.amount)
                        )}
                      </p>

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

              <div className="flex justify-between text-lg font-bold text-red-600">

                <span>
                  Outstanding
                </span>

                <span>
                  {formatMoney(
                    Number(invoice.balance)
                  )}
                </span>

              </div>

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

                {/* Action Buttons */}

        </div>

        <div className="flex justify-end gap-4 print:hidden">

          {invoice.status !== "Paid" && (

            <Button
              onClick={() =>
                setShowPaymentModal(true)
              }
            >
              Record Payment
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

    </>

  );
}