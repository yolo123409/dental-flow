"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import FormModal from "@/components/ui/FormModal";
import FormInput from "@/components/ui/FormInput";
import FormTextarea from "@/components/ui/FormTextarea";
import Button from "@/components/ui/Button";

import {
  createExpense,
  updateExpense,
  uploadExpenseReceipt,
} from "@/services/expenses";
import { EXPENSE_PAYMENT_METHODS } from "@/lib/paymentMethods";

import { Expense, ExpenseCategory } from "@/types/expenses";
import { Supplier } from "@/types/procurement";
import { getSafeErrorMessage } from "@/lib/logError";

interface Props {
  open: boolean;
  expense?: Expense | null;
  categories: ExpenseCategory[];
  suppliers: Supplier[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export default function RecordExpenseModal({
  open,
  expense,
  categories,
  suppliers,
  onClose,
  onSaved,
}: Props) {
  const editing = expense != null;

  const [amount, setAmount] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [expenseDate, setExpenseDate] = useState(todayIso());
  const [description, setDescription] = useState("");

  const [showMore, setShowMore] = useState(false);
  const [payee, setPayee] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<string>(
    EXPENSE_PAYMENT_METHODS[0]
  );
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [receiptFile, setReceiptFile] = useState<File | null>(null);

  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;

    setAmount(expense ? String(expense.amount) : "");
    setCategoryId(expense?.category_id ?? categories[0]?.id ?? "");
    setExpenseDate(expense?.expense_date ?? todayIso());
    setDescription(expense?.description ?? "");

    setPayee(expense?.payee ?? "");
    setSupplierId(expense?.supplier_id ?? "");
    setPaymentMethod(expense?.payment_method ?? EXPENSE_PAYMENT_METHODS[0]);
    setReference(expense?.reference ?? "");
    setNotes(expense?.notes ?? "");
    setReceiptFile(null);

    setShowMore(
      Boolean(
        expense?.payee ||
          expense?.supplier_id ||
          expense?.reference ||
          expense?.notes
      )
    );
    // categories is derived from a stable list load, not something that
    // should retrigger this reset once the form is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, expense]);

  async function handleSave() {
    if (saving) return;

    const parsedAmount = Number(amount);

    if (!amount.trim() || Number.isNaN(parsedAmount) || parsedAmount <= 0) {
      toast.error("Enter a valid amount greater than zero.");
      return;
    }

    if (!categoryId) {
      toast.error("Select a category.");
      return;
    }

    if (!expenseDate) {
      toast.error("Select a date.");
      return;
    }

    if (!description.trim()) {
      toast.error("Description is required.");
      return;
    }

    if (!paymentMethod) {
      toast.error("Select a payment method.");
      return;
    }

    try {
      setSaving(true);

      const input = {
        category_id: categoryId,
        amount: parsedAmount,
        expense_date: expenseDate,
        description: description.trim(),
        payee: payee.trim() || null,
        supplier_id: supplierId || null,
        payment_method: paymentMethod,
        reference: reference.trim() || null,
        notes: notes.trim() || null,
      };

      if (editing) {
        await updateExpense(expense!.id, input);

        if (receiptFile) {
          await uploadExpenseReceipt(expense!.id, receiptFile);
        }

        toast.success("Expense updated.");
      } else {
        const created = await createExpense(input);

        if (receiptFile) {
          await uploadExpenseReceipt(created.id, receiptFile);
        }

        toast.success("Money out recorded.");
      }

      await onSaved();

      onClose();
    } catch (error) {
      toast.error(
        getSafeErrorMessage(error, "Unable to save expense.")
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <FormModal
      open={open}
      title={editing ? "Edit Money Out" : "Record Money Out"}
      loading={saving}
      onClose={onClose}
      onSubmit={handleSave}
      submitText={editing ? "Save Changes" : "Record"}
    >
      <FormInput
        label="Amount"
        required
        type="number"
        value={amount}
        onChange={setAmount}
      />

      <div>
        <label className="mb-2 block text-sm font-semibold text-graphite">
          Category
          <span className="ml-1 text-clay">*</span>
        </label>

        <select
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          className="min-h-11 w-full rounded-lg border border-sea-glass bg-enamel px-3 py-2.5 text-sm text-graphite transition-colors hover:border-mineral/50 focus:border-eucalyptus focus:outline-none"
        >
          {categories.length === 0 && <option value="">No categories yet</option>}

          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
      </div>

      <FormInput
        label="Date"
        required
        type="date"
        value={expenseDate}
        onChange={setExpenseDate}
      />

      <FormInput
        label="Description / Purpose"
        required
        value={description}
        placeholder="e.g. July crown and bridge laboratory bill"
        onChange={setDescription}
      />

      {!showMore ? (
        <button
          type="button"
          onClick={() => setShowMore(true)}
          className="text-sm font-semibold text-eucalyptus hover:underline"
        >
          + More details (payee, supplier, payment method, receipt)
        </button>
      ) : (
        <div className="space-y-5 rounded-lg border border-sea-glass p-4">
          <FormInput
            label="Paid To (optional)"
            value={payee}
            onChange={setPayee}
          />

          <div>
            <label className="mb-2 block text-sm font-semibold text-graphite">
              Supplier
              <span className="ml-1 text-xs font-normal text-mineral">
                (optional)
              </span>
            </label>

            <select
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
              className="min-h-11 w-full rounded-lg border border-sea-glass bg-enamel px-3 py-2.5 text-sm text-graphite transition-colors hover:border-mineral/50 focus:border-eucalyptus focus:outline-none"
            >
              <option value="">None</option>

              {suppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-2 block text-sm font-semibold text-graphite">
              Payment Method
              <span className="ml-1 text-clay">*</span>
            </label>

            <select
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value)}
              className="min-h-11 w-full rounded-lg border border-sea-glass bg-enamel px-3 py-2.5 text-sm text-graphite transition-colors hover:border-mineral/50 focus:border-eucalyptus focus:outline-none"
            >
              {EXPENSE_PAYMENT_METHODS.map((method) => (
                <option key={method} value={method}>
                  {method}
                </option>
              ))}
            </select>
          </div>

          <FormInput
            label="Reference (optional)"
            value={reference}
            placeholder="e.g. M-Pesa code"
            onChange={setReference}
          />

          <FormTextarea
            label="Notes (optional)"
            value={notes}
            onChange={setNotes}
          />

          <div>
            <label className="mb-2 block text-sm font-semibold text-graphite">
              Receipt
              <span className="ml-1 text-xs font-normal text-mineral">
                (optional, PDF/PNG/JPG up to 5MB)
              </span>
            </label>

            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,application/pdf"
              onChange={(e) => setReceiptFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm text-graphite file:mr-4 file:rounded-lg file:border-0 file:bg-sea-glass file:px-4 file:py-2 file:text-sm file:font-semibold file:text-eucalyptus"
            />
          </div>

          <Button
            type="button"
            variant="quiet"
            className="px-0"
            onClick={() => setShowMore(false)}
          >
            Hide details
          </Button>
        </div>
      )}
    </FormModal>
  );
}
