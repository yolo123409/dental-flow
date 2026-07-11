"use client";

import { useState } from "react";

import Modal from "@/components/ui/Modal";
import Button from "@/components/ui/Button";

import { createPayment } from "@/services/payments";
import { recordInvoicePayment } from "@/services/billing";

interface Props {
  open: boolean;
  invoiceId: string;
  patientId: string;

  balance: number;

  onClose: () => void;

  onSuccess: () => Promise<void>;
}

export default function PaymentModal({
  open,
  invoiceId,
  patientId,
  balance,
  onClose,
  onSuccess,
}: Props) {
  const [loading, setLoading] = useState(false);

  const [amount, setAmount] = useState(balance);

  const [paymentMethod, setPaymentMethod] =
    useState("Cash");

  const [reference, setReference] = useState("");

  const [receivedBy, setReceivedBy] =
    useState("");

  const [notes, setNotes] =
    useState("");

  async function savePayment() {
    try {
      setLoading(true);

      await createPayment({
        invoice_id: invoiceId,
        patient_id: patientId,

        amount,

        payment_method: paymentMethod,

        transaction_reference: reference,

        received_by: receivedBy,

        notes,
      });

      await recordInvoicePayment(
        invoiceId,
        amount
      );

      await onSuccess();

      onClose();

    } catch (error) {
      console.error(error);

      alert("Failed to record payment.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal
      open={open}
      title="Record Payment"
      onClose={onClose}
      footer={
        <>
          <Button
            variant="secondary"
            onClick={onClose}
          >
            Cancel
          </Button>

          <Button
            onClick={savePayment}
          >
            {loading
              ? "Saving..."
              : "Record Payment"}
          </Button>
        </>
      }
    >

      <div className="space-y-5">

        <div>

          <label className="mb-2 block">

            Amount

          </label>

          <input
            type="number"
            value={amount}
            onChange={(e)=>
              setAmount(
                Number(e.target.value)
              )
            }
            className="w-full rounded-xl border p-3"
          />

        </div>

        <div>

          <label className="mb-2 block">

            Payment Method

          </label>

          <select
            value={paymentMethod}
            onChange={(e)=>
              setPaymentMethod(
                e.target.value
              )
            }
            className="w-full rounded-xl border p-3"
          >
            <option>Cash</option>

            <option>M-Pesa</option>

            <option>Card</option>

            <option>Bank</option>

          </select>

        </div>

        <div>

          <label className="mb-2 block">

            Transaction Reference

          </label>

          <input
            value={reference}
            onChange={(e)=>
              setReference(
                e.target.value
              )
            }
            className="w-full rounded-xl border p-3"
          />

        </div>

        <div>

          <label className="mb-2 block">

            Received By

          </label>

          <input
            value={receivedBy}
            onChange={(e)=>
              setReceivedBy(
                e.target.value
              )
            }
            className="w-full rounded-xl border p-3"
          />

        </div>

        <div>

          <label className="mb-2 block">

            Notes

          </label>

          <textarea
            rows={4}
            value={notes}
            onChange={(e)=>
              setNotes(
                e.target.value
              )
            }
            className="w-full rounded-xl border p-3"
          />

        </div>

      </div>

    </Modal>
  );
}