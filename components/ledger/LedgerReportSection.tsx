"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

interface LedgerReportLine {
  accountId: string;
  accountCode: string;
  accountName: string;
  amount: number;
}

interface LedgerReportSectionProps {
  title: string;
  lines: LedgerReportLine[];
  total: number;
  formatMoney: (amount: number) => string;
  defaultOpen?: boolean;
  emptyLabel?: string;
}

/**
 * An expandable account-breakdown row shared by every ledger-based
 * financial report (Profit & Loss, Cash Flow, ...) - a title/total
 * header that expands to the individual account lines behind it.
 */
export default function LedgerReportSection({
  title,
  lines,
  total,
  formatMoney,
  defaultOpen = false,
  emptyLabel = "No activity in this period.",
}: LedgerReportSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="border-t border-slate-200 first:border-t-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-6 py-4 text-left"
      >
        <span className="flex items-center gap-2 font-semibold">
          {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          {title}
        </span>
        <span className="font-semibold">{formatMoney(total)}</span>
      </button>

      {open && (
        <div className="bg-porcelain/50 px-6 pb-4">
          {lines.length === 0 ? (
            <p className="py-2 text-sm text-mineral">{emptyLabel}</p>
          ) : (
            <table className="w-full">
              <tbody>
                {lines.map((line) => (
                  <tr key={line.accountId}>
                    <td className="py-1.5 pl-6 text-sm text-slate-600">
                      {line.accountCode} {line.accountName}
                    </td>
                    <td className="py-1.5 text-right text-sm text-slate-600">
                      {formatMoney(line.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
