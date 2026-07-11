"use client";

import Card from "@/components/ui/Card";

interface Invoice {
  id: string;
  amount: number;
  paid: number;
  balance: number;
  status: string;
  created_at: string;
}

interface Props {
  invoice: Invoice;
  onClick: () => void;
}

function formatKES(amount: number) {
  return new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    maximumFractionDigits: 0,
  }).format(amount);
}

export default function InvoiceCard({
  invoice,
  onClick,
}: Props) {
  return (
    <Card
      className="cursor-pointer hover:border-blue-500"
    >
      <div
        onClick={onClick}
        className="space-y-4"
      >
        <div className="flex items-center justify-between">

          <h3 className="font-bold">
            Invoice
          </h3>

          <span
            className={`rounded-full px-3 py-1 text-xs font-semibold ${
              invoice.status === "Paid"
                ? "bg-green-100 text-green-700"
                : "bg-yellow-100 text-yellow-700"
            }`}
          >
            {invoice.status}
          </span>

        </div>

        <div className="space-y-2">

          <p>
            <strong>Total:</strong>{" "}
            {formatKES(invoice.amount)}
          </p>

          <p>
            <strong>Paid:</strong>{" "}
            {formatKES(invoice.paid)}
          </p>

          <p>
            <strong>Balance:</strong>{" "}
            {formatKES(invoice.balance)}
          </p>

        </div>

        <p className="text-sm text-slate-500">
          {new Date(
            invoice.created_at
          ).toLocaleDateString()}
        </p>

      </div>
    </Card>
  );
}