"use client";

interface LedgerReportTotalRowProps {
  label: string;
  amount: number;
  formatMoney: (amount: number) => string;
  emphasis?: boolean;
}

export default function LedgerReportTotalRow({
  label,
  amount,
  formatMoney,
  emphasis = false,
}: LedgerReportTotalRowProps) {
  return (
    <div
      className={`flex items-center justify-between border-t border-slate-200 px-6 py-4 ${
        emphasis ? "bg-porcelain text-lg font-bold" : "font-semibold"
      }`}
    >
      <span>{label}</span>
      <span>{formatMoney(amount)}</span>
    </div>
  );
}
