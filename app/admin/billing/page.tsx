"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import PaymentMethodField from "@/components/billing/PaymentMethodField";
import PermissionGuard from "@/components/auth/PermissionGuard";

import {
  ClinicCharge,
  calculateInvoiceTotals,
  createInvoice,
  getPendingCharges,
} from "@/services/billing";

import {
  ClinicSettings,
  getClinicSettings,
} from "@/services/settings";

function BillingPageContent() {
  const [loading, setLoading] =
    useState(true);

  const [charges, setCharges] =
    useState<ClinicCharge[]>([]);

  const [selected, setSelected] =
    useState<string[]>([]);

  const [paymentMethod, setPaymentMethod] =
    useState<string | null>(null);

  const [insuranceProviderId, setInsuranceProviderId] =
    useState<string | null>(null);

  const [currency, setCurrency] =
    useState("KES");

  const [clinicSettings, setClinicSettings] =
    useState<ClinicSettings | null>(
      null
    );

  useEffect(() => {
    loadCharges();
  }, []);

  async function loadCharges() {
    try {
      setLoading(true);

      const [result, settingsResult] =
        await Promise.all([
          getPendingCharges(),
          getClinicSettings(),
        ]);

      setCharges(result);
      setCurrency(
        settingsResult.currency || "KES"
      );
      setClinicSettings(settingsResult);
    } catch (error) {
      console.error(error);

      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to load pending charges."
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleGenerateInvoice() {
    if (selectedCharges.length === 0) {
      return;
    }

    const patientIds = [
      ...new Set(
        selectedCharges.map(
          (charge) => charge.patient_id
        )
      ),
    ];

    if (patientIds.length !== 1) {
      toast.error(
        "Please select charges for one patient only."
      );

      return;
    }

    try {
      await createInvoice(
        patientIds[0],
        selectedCharges,
        0,
        undefined,
        paymentMethod,
        insuranceProviderId
      );

      setSelected([]);
      setPaymentMethod(null);
      setInsuranceProviderId(null);

      await loadCharges();

      toast.success(
        "Invoice created successfully."
      );
    } catch (error) {
      console.error(error);

      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to create invoice."
      );
    }
  }

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount);

  function toggleCharge(
    chargeId: string
  ) {
    setSelected((current) =>
      current.includes(chargeId)
        ? current.filter(
            (id) => id !== chargeId
          )
        : [...current, chargeId]
    );
  }

  const selectedCharges =
    useMemo(() => {
      return charges.filter(
        (charge) =>
          selected.includes(charge.id)
      );
    }, [charges, selected]);

  const grossAmount =
    selectedCharges.reduce(
      (sum, charge) =>
        sum + Number(charge.amount),
      0
    );

  const totals = calculateInvoiceTotals(
    grossAmount,
    0,
    {
      enabled:
        clinicSettings?.tax_enabled ??
        false,
      rate: Number(
        clinicSettings?.tax_rate ?? 0
      ),
      inclusive:
        clinicSettings?.prices_include_tax ??
        false,
    }
  );

      return (
    <div className="space-y-8">

      {/* Header */}

      <div className="flex items-center justify-between">

        <div>

          <h1 className="text-3xl font-bold">
            Billing
          </h1>

          <p className="mt-2 text-slate-500">
            Generate invoices from completed treatments.
          </p>

        </div>

        <Link
          href="/admin/billing/invoices"
          className="rounded-xl bg-blue-600 px-5 py-3 font-semibold text-white transition hover:bg-blue-700"
        >
          View Invoices
        </Link>

      </div>

      {/* Content */}

      <div className="grid gap-8 lg:grid-cols-3">

        <Card
          title="Pending Charges"
          className="lg:col-span-2"
        >

          {loading ? (

            <div className="py-12 text-center text-slate-500">
              Loading...
            </div>

          ) : charges.length === 0 ? (

            <div className="py-12 text-center text-slate-500">
              No pending charges.
            </div>

          ) : (

            <div className="space-y-3">

              {charges.map((charge) => (

                <label
                  key={charge.id}
                  className="flex cursor-pointer items-center justify-between rounded-xl border border-slate-200 p-4 transition hover:bg-slate-50"
                >

                  <div className="flex items-center gap-4">

                    <input
                      type="checkbox"
                      checked={selected.includes(
                        charge.id
                      )}
                      onChange={() =>
                        toggleCharge(charge.id)
                      }
                    />

                    <div>

                      <p className="font-medium">
                        {charge.treatment_name}
                      </p>

                      <p className="text-sm text-slate-500">
                        Tooth{" "}
                        {charge.tooth_number ?? "-"}
                      </p>

                    </div>

                  </div>

                  <p className="font-bold">
                    {formatCurrency(
                      Number(charge.amount)
                    )}
                  </p>

                </label>

              ))}

            </div>

          )}

        </Card>

        <Card title="Invoice Summary">

          <div className="space-y-5">

            <div className="flex justify-between">

              <span>
                Selected
              </span>

              <span className="font-semibold">
                {selectedCharges.length}
              </span>

            </div>

            <div className="flex justify-between">

              <span>
                Subtotal
              </span>

              <span className="font-semibold">
                {formatCurrency(
                  totals.subtotal
                )}
              </span>

            </div>

            {clinicSettings?.tax_enabled && (

              <div className="flex justify-between">

                <span>
                  {clinicSettings.tax_name} (
                  {Number(
                    clinicSettings.tax_rate
                  )}
                  %)
                </span>

                <span className="font-semibold">
                  {formatCurrency(
                    totals.tax
                  )}
                </span>

              </div>

            )}

            <hr />

            <div className="flex justify-between text-lg font-bold">

              <span>Total</span>

              <span>
                {formatCurrency(
                  totals.total
                )}
              </span>

            </div>

            <PaymentMethodField
              paymentMethod={paymentMethod}
              onPaymentMethodChange={setPaymentMethod}
              insuranceProviderId={insuranceProviderId}
              onInsuranceProviderChange={setInsuranceProviderId}
            />

            <Button
              className="w-full"
              disabled={
                selectedCharges.length === 0
              }
              onClick={
                handleGenerateInvoice
              }
            >
              Generate Invoice
            </Button>

          </div>

        </Card>

      </div>

    </div>
  );
}

export default function BillingPage() {
  return (
    <PermissionGuard permission="billing">
      <BillingPageContent />
    </PermissionGuard>
  );
}