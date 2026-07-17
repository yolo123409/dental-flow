"use client";

import { useState } from "react";

import Button from "@/components/ui/Button";

import { recordPayment } from "@/services/billing";

interface Props {
  invoiceId: string;
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export default function RecordPaymentModal({
  invoiceId,
  open,
  onClose,
  onSuccess,
}: Props) {
  const [amount, setAmount] =
    useState("");

  const [paymentMethod, setPaymentMethod] =
    useState("Cash");

  const [reference, setReference] =
    useState("");

  const [notes, setNotes] =
    useState("");

  const [saving, setSaving] =
    useState(false);

  if (!open) return null;

  async function handleSave() {
    if (!amount) {
      alert("Enter an amount.");
      return;
    }

    try {
      setSaving(true);

      await recordPayment(
        invoiceId,
        Number(amount),
        paymentMethod,
        reference,
        notes
      );

      onSuccess();
      onClose();

      setAmount("");
      setReference("");
      setNotes("");
      setPaymentMethod("Cash");
    } catch (error) {
      console.error(error);

      if (error instanceof Error) {
        alert(error.message);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">

      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">

        <h2 className="mb-6 text-xl font-bold">
          Record Payment
        </h2>

        <div className="space-y-4">

          <input
            type="number"
            placeholder="Amount"
            className="w-full rounded-lg border p-3"
            value={amount}
            onChange={(e) =>
              setAmount(e.target.value)
            }
          />

          <select
            className="w-full rounded-lg border p-3"
            value={paymentMethod}
            onChange={(e) =>
              setPaymentMethod(e.target.value)
            }
          >
            <option>Cash</option>
            <option>M-Pesa</option>
            <option>Card</option>
            <option>Bank Transfer</option>
          </select>

          <input
            className="w-full rounded-lg border p-3"
            placeholder="Reference"
            value={reference}
            onChange={(e) =>
              setReference(e.target.value)
            }
          />

          <textarea
            className="w-full rounded-lg border p-3"
            rows={4}
            placeholder="Notes"
            value={notes}
            onChange={(e) =>
              setNotes(e.target.value)
            }
          />

          <div className="flex justify-end gap-3">

            <Button
              variant="secondary"
              onClick={onClose}
            >
              Cancel
            </Button>

            <Button
              onClick={handleSave}
              disabled={saving}
            >
              {saving
                ? "Saving..."
                : "Save Payment"}
            </Button>

          </div>

        </div>

      </div>

    </div>
  );
}