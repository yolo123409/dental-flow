"use client";

import Card from "@/components/ui/Card";
import ClinicBrandingHeader from "@/components/branding/ClinicBrandingHeader";

import { ClinicSettings } from "@/services/settings";
import { GRNWithItems, ProcurementSettings } from "@/types/procurement";

interface Props {
  grn: GRNWithItems;
  clinic: ClinicSettings;
  settings: ProcurementSettings;
}

export default function GRNDocument({ grn, clinic, settings }: Props) {
  const columns = settings.grn_visible_columns;

  return (
    <Card>
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-8 print:border-none print:bg-white">
        <div className="flex justify-between">
          <ClinicBrandingHeader clinic={clinic} />

          <div className="text-right">
            <p className="text-lg font-bold uppercase tracking-wide text-slate-700">
              {settings.grn_document_title}
            </p>
            <p className="mt-2 text-sm text-slate-500">GRN Number</p>
            <p className="font-semibold">{grn.grn_number}</p>
            {grn.clinic_purchase_orders && (
              <>
                <p className="mt-4 text-sm text-slate-500">Related PO</p>
                <p>{grn.clinic_purchase_orders.po_number}</p>
              </>
            )}
            <p className="mt-4 text-sm text-slate-500">Date Received</p>
            <p>{new Date(grn.date_received).toLocaleDateString()}</p>
          </div>
        </div>

        {settings.grn_header_text && (
          <p className="mt-6 text-sm text-slate-600">{settings.grn_header_text}</p>
        )}

        <hr className="my-8" />

        <div className="grid gap-8 md:grid-cols-2">
          <div>
            <h3 className="mb-2 font-semibold uppercase tracking-wide text-slate-500">
              Supplier
            </h3>
            <p className="text-lg font-semibold">
              {grn.clinic_suppliers?.name ?? "-"}
            </p>
            {grn.clinic_supplier_contacts && (
              <p className="text-slate-600">{grn.clinic_supplier_contacts.name}</p>
            )}
          </div>

          <div>
            <h3 className="mb-2 font-semibold uppercase tracking-wide text-slate-500">
              Delivery Details
            </h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span>Supplier Delivery Note</span>
                <span className="font-medium">
                  {grn.supplier_delivery_note || "-"}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Status</span>
                <span className="font-medium">{grn.status}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-8 overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b bg-slate-100">
                <th className="px-4 py-3 text-left">Item</th>
                {columns.ordered && (
                  <th className="px-4 py-3 text-right">Ordered</th>
                )}
                {columns.received && (
                  <th className="px-4 py-3 text-right">Received</th>
                )}
                {columns.unit_cost && (
                  <th className="px-4 py-3 text-right">Unit Cost</th>
                )}
                {columns.batch && (
                  <th className="px-4 py-3 text-left">Batch</th>
                )}
                {columns.expiry && (
                  <th className="px-4 py-3 text-left">Expiry</th>
                )}
              </tr>
            </thead>
            <tbody>
              {grn.clinic_grn_items.map((item) => (
                <tr key={item.id} className="border-b">
                  <td className="px-4 py-4 font-medium">
                    {item.clinic_inventory_items?.name ?? "Item"}
                  </td>
                  {columns.ordered && (
                    <td className="px-4 py-4 text-right">
                      {item.quantity_ordered ?? "-"}
                    </td>
                  )}
                  {columns.received && (
                    <td className="px-4 py-4 text-right font-semibold">
                      {item.quantity_received} {item.unit}
                    </td>
                  )}
                  {columns.unit_cost && (
                    <td className="px-4 py-4 text-right">{item.unit_cost}</td>
                  )}
                  {columns.batch && (
                    <td className="px-4 py-4">{item.batch_number || "-"}</td>
                  )}
                  {columns.expiry && (
                    <td className="px-4 py-4">
                      {item.expiry_date
                        ? new Date(item.expiry_date).toLocaleDateString()
                        : "-"}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {grn.notes && (
          <div className="mt-6">
            <h3 className="mb-1 font-semibold uppercase tracking-wide text-slate-500">
              Notes
            </h3>
            <p className="text-sm text-slate-600">{grn.notes}</p>
          </div>
        )}

        <div className="mt-12 grid grid-cols-2 gap-8">
          <div className="text-center">
            <div className="h-16 border-b border-slate-400" />
            <p className="mt-2 text-sm text-slate-500">
              {settings.grn_signature_label}
            </p>
          </div>
          <div className="text-center">
            <div className="h-16 border-b border-slate-400" />
            <p className="mt-2 text-sm text-slate-500">Checked By</p>
          </div>
        </div>

        {settings.grn_footer_text && (
          <p className="mt-8 text-center text-sm text-slate-500">
            {settings.grn_footer_text}
          </p>
        )}
      </div>
    </Card>
  );
}
