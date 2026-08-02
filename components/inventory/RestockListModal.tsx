"use client";

import Modal from "@/components/ui/Modal";
import Button from "@/components/ui/Button";

import { ClinicInventoryItem } from "@/services/inventory";

interface Props {
  open: boolean;

  items: ClinicInventoryItem[];

  onClose: () => void;
}

export default function RestockListModal({
  open,
  items,
  onClose,
}: Props) {
  if (!open) {
    return null;
  }

  function suggestedRestock(
    item: ClinicInventoryItem
  ) {
    const shortfall =
      Number(item.minimum_stock_level) -
      Number(item.quantity);

    return Math.max(shortfall, 1);
  }

  function handlePrint() {
    window.print();
  }

  function handleExportCsv() {
    const header = [
      "Material",
      "Category",
      "Current Stock",
      "Unit",
      "Minimum Stock",
      "Suggested Restock",
    ];

    const rows = items.map((item) => [
      item.name,
      item.category ?? "",
      String(item.quantity),
      item.unit,
      String(item.minimum_stock_level),
      `${suggestedRestock(item)}+`,
    ]);

    const csv = [header, ...rows]
      .map((row) =>
        row
          .map(
            (cell) => `"${cell.replace(/"/g, '""')}"`
          )
          .join(",")
      )
      .join("\n");

    const blob = new Blob([csv], {
      type: "text/csv;charset=utf-8;",
    });

    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = "restock-list.csv";

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    URL.revokeObjectURL(url);
  }

  return (
    <Modal
      open={open}
      title="Restock List"
      onClose={onClose}
      footer={
        <>
          <Button
            variant="secondary"
            onClick={onClose}
          >
            Close
          </Button>

          <Button
            variant="secondary"
            onClick={handleExportCsv}
          >
            Export CSV
          </Button>

          <Button onClick={handlePrint}>
            Print
          </Button>
        </>
      }
    >
      <div
        id="restock-print-content"
        className="space-y-4"
      >

        <p className="text-sm text-mineral">
          Materials at or below their minimum stock
          level.
        </p>

        <div className="overflow-x-auto rounded-lg border border-sea-glass">

          <table className="min-w-full text-sm">

            <thead className="bg-porcelain">
              <tr>
                <th className="px-4 py-3 text-left font-semibold">
                  Material
                </th>
                <th className="px-4 py-3 text-right font-semibold">
                  Current
                </th>
                <th className="px-4 py-3 text-right font-semibold">
                  Minimum
                </th>
                <th className="px-4 py-3 text-right font-semibold">
                  Suggested Restock
                </th>
              </tr>
            </thead>

            <tbody>
              {items.map((item) => (
                <tr
                  key={item.id}
                  className="border-t border-sea-glass"
                >
                  <td className="px-4 py-3 font-medium">
                    {item.name}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {item.quantity} {item.unit}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {item.minimum_stock_level}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold">
                    {suggestedRestock(item)}+
                  </td>
                </tr>
              ))}
            </tbody>

          </table>

        </div>

      </div>

      <style jsx global>{`
        @media print {
          body * {
            visibility: hidden;
          }

          #restock-print-content,
          #restock-print-content * {
            visibility: visible;
          }

          #restock-print-content {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
          }
        }
      `}</style>
    </Modal>
  );
}
