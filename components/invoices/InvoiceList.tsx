"use client";

import { Invoice } from "@/types";

import InvoiceCard from "./InvoiceCard";

interface Props {
  invoices: Invoice[];
  onSelect: (invoice: Invoice) => void;
}

export default function InvoiceList({
  invoices,
  onSelect,
}: Props) {
  if (invoices.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed p-10 text-center text-slate-500">
        No invoices yet.
      </div>
    );
  }

  return (
    <div className="grid gap-5 lg:grid-cols-2">

      {invoices.map((invoice) => (

        <InvoiceCard
          key={invoice.id}
          invoice={invoice}
          onClick={() => onSelect(invoice)}
        />

      ))}

    </div>
  );
}