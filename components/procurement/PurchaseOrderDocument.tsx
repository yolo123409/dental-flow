"use client";

import Card from "@/components/ui/Card";
import ClinicBrandingHeader from "@/components/branding/ClinicBrandingHeader";

import { ClinicSettings } from "@/services/settings";
import { PurchaseOrderWithItems, ProcurementSettings } from "@/types/procurement";

interface Props {
  po: PurchaseOrderWithItems;
  clinic: ClinicSettings;
  settings: ProcurementSettings;
}

function formatCurrency(amount: number, currency: string) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
  }).format(amount);
}

export default function PurchaseOrderDocument({ po, clinic, settings }: Props) {
  const currency = clinic.currency ?? "KES";

  return (
    <Card>
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-8 print:border-none print:bg-white">
        <div className="flex justify-between">
          <ClinicBrandingHeader clinic={clinic} />

          <div className="text-right">
            <p className="text-lg font-bold uppercase tracking-wide text-slate-700">
              {settings.po_document_title}
            </p>
            <p className="mt-2 text-sm text-slate-500">PO Number</p>
            <p className="font-semibold">{po.po_number}</p>
            <p className="mt-4 text-sm text-slate-500">Date</p>
            <p>{new Date(po.order_date).toLocaleDateString()}</p>
          </div>
        </div>

        {settings.po_header_text && (
          <p className="mt-6 text-sm text-slate-600">{settings.po_header_text}</p>
        )}

        <hr className="my-8" />

        <div className="grid gap-8 md:grid-cols-2">
          <div>
            <h3 className="mb-2 font-semibold uppercase tracking-wide text-slate-500">
              Supplier
            </h3>
            <p className="text-lg font-semibold">
              {po.clinic_suppliers?.name ?? "-"}
            </p>
            {po.clinic_supplier_contacts && (
              <p className="text-slate-600">{po.clinic_supplier_contacts.name}</p>
            )}
          </div>

          <div>
            <h3 className="mb-2 font-semibold uppercase tracking-wide text-slate-500">
              Order Details
            </h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span>Expected Delivery</span>
                <span className="font-medium">
                  {po.expected_delivery_date
                    ? new Date(po.expected_delivery_date).toLocaleDateString()
                    : "-"}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Delivery Location</span>
                <span className="font-medium">{po.delivery_location || "-"}</span>
              </div>
              <div className="flex justify-between">
                <span>Status</span>
                <span className="font-medium">{po.status}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-8 overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b bg-slate-100">
                <th className="px-4 py-3 text-left">Item</th>
                <th className="px-4 py-3 text-right">Qty</th>
                <th className="px-4 py-3 text-right">Unit Price</th>
                <th className="px-4 py-3 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {po.clinic_purchase_order_items.map((item) => (
                <tr key={item.id} className="border-b">
                  <td className="px-4 py-4">
                    <p className="font-medium">
                      {item.clinic_inventory_items?.name ?? "Item"}
                    </p>
                    {item.description && (
                      <p className="text-sm text-slate-500">{item.description}</p>
                    )}
                  </td>
                  <td className="px-4 py-4 text-right">
                    {item.quantity} {item.unit}
                  </td>
                  <td className="px-4 py-4 text-right">
                    {formatCurrency(item.unit_price, currency)}
                  </td>
                  <td className="px-4 py-4 text-right font-semibold">
                    {formatCurrency(item.line_total, currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-6 flex justify-end">
          <div className="w-full max-w-xs space-y-2 text-sm">
            <div className="flex justify-between">
              <span>Subtotal</span>
              <span className="font-medium">
                {formatCurrency(po.subtotal, currency)}
              </span>
            </div>
            <hr />
            <div className="flex justify-between text-lg font-bold">
              <span>Total</span>
              <span>{formatCurrency(po.total, currency)}</span>
            </div>
          </div>
        </div>

        {po.notes && (
          <div className="mt-6">
            <h3 className="mb-1 font-semibold uppercase tracking-wide text-slate-500">
              Notes
            </h3>
            <p className="text-sm text-slate-600">{po.notes}</p>
          </div>
        )}

        {settings.po_terms && (
          <div className="mt-6">
            <h3 className="mb-1 font-semibold uppercase tracking-wide text-slate-500">
              Terms
            </h3>
            <p className="text-sm text-slate-600">{settings.po_terms}</p>
          </div>
        )}

        <div className="mt-12 flex justify-end">
          <div className="w-64 text-center">
            <div className="h-16 border-b border-slate-400" />
            <p className="mt-2 text-sm text-slate-500">
              {settings.po_signature_label}
            </p>
          </div>
        </div>

        {settings.po_footer_text && (
          <p className="mt-8 text-center text-sm text-slate-500">
            {settings.po_footer_text}
          </p>
        )}
      </div>
    </Card>
  );
}
