"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import Modal from "@/components/ui/Modal";
import Button from "@/components/ui/Button";
import FormInput from "@/components/ui/FormInput";
import FormTextarea from "@/components/ui/FormTextarea";

import { createManualJournalEntry } from "@/services/ledger";
import { LedgerAccount } from "@/types/ledger";

interface Props {
  open: boolean;
  accounts: LedgerAccount[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}

const NONE = "";

/**
 * Owner/Admin only (enforced both by lib/permissions.ts's ledger_manage
 * gate around the button that opens this, and again server-side by the
 * create_manual_journal_entry RPC itself). A single debit account + a
 * single credit account for the same amount is always balanced by
 * construction (section 15's own simplified requirement - not a
 * general-purpose N-line journal).
 */
export default function ManualJournalEntryModal({ open, accounts, onClose, onSaved }: Props) {
  const [transactionDate, setTransactionDate] = useState("");
  const [description, setDescription] = useState("");
  const [debitAccountId, setDebitAccountId] = useState(NONE);
  const [creditAccountId, setCreditAccountId] = useState(NONE);
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;

    setTransactionDate(new Date().toISOString().slice(0, 10));
    setDescription("");
    setDebitAccountId(NONE);
    setCreditAccountId(NONE);
    setAmount("");
    setNotes("");
  }, [open]);

  if (!open) return null;

  const parsedAmount = Number(amount || 0);

  async function handleSave() {
    if (!description.trim()) {
      toast.error("Enter a description.");
      return;
    }

    if (!debitAccountId || !creditAccountId) {
      toast.error("Select both a debit account and a credit account.");
      return;
    }

    if (debitAccountId === creditAccountId) {
      toast.error("Debit and credit accounts must be different.");
      return;
    }

    if (!amount.trim() || parsedAmount <= 0) {
      toast.error("Enter an amount greater than 0.");
      return;
    }

    try {
      setSaving(true);

      await createManualJournalEntry({
        transactionDate,
        description: description.trim(),
        debitAccountId,
        creditAccountId,
        amount: parsedAmount,
        notes: notes.trim() || undefined,
      });

      toast.success("Manual journal entry posted.");

      await onSaved();

      onClose();
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : "Unable to post journal entry.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      title="Manual Journal Entry"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Posting..." : "Post Entry"}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <p className="rounded-lg bg-porcelain px-4 py-3 text-xs text-mineral">
          This will be recorded as a &quot;Manual Journal Entry&quot; and cannot be edited once
          posted - if it needs correcting later, it can be reversed.
        </p>

        <div className="grid gap-5 sm:grid-cols-2">
          <FormInput
            label="Date"
            type="date"
            required
            value={transactionDate}
            onChange={setTransactionDate}
          />
          <FormInput label="Amount" type="number" required value={amount} onChange={setAmount} />
        </div>

        <FormInput
          label="Description"
          required
          value={description}
          onChange={setDescription}
        />

        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label className="mb-2 block text-sm font-semibold text-graphite">
              Debit Account
              <span className="ml-1 text-clay">*</span>
            </label>
            <select
              value={debitAccountId}
              onChange={(e) => setDebitAccountId(e.target.value)}
              className="min-h-11 w-full rounded-lg border border-sea-glass bg-enamel px-3 py-2.5 text-sm text-graphite focus:border-eucalyptus focus:outline-none"
            >
              <option value={NONE}>Select an account...</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.code} {account.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-2 block text-sm font-semibold text-graphite">
              Credit Account
              <span className="ml-1 text-clay">*</span>
            </label>
            <select
              value={creditAccountId}
              onChange={(e) => setCreditAccountId(e.target.value)}
              className="min-h-11 w-full rounded-lg border border-sea-glass bg-enamel px-3 py-2.5 text-sm text-graphite focus:border-eucalyptus focus:outline-none"
            >
              <option value={NONE}>Select an account...</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.code} {account.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <FormTextarea label="Notes (optional)" value={notes} onChange={setNotes} />

        {parsedAmount > 0 && debitAccountId && creditAccountId && (
          <div className="rounded-lg border border-sea-glass bg-porcelain px-4 py-3 text-sm text-graphite">
            <div className="flex items-center justify-center gap-2">
              <span className="text-eucalyptus">Debit {parsedAmount.toLocaleString()}</span>
              <span className="text-mineral">/</span>
              <span className="text-clay">Credit {parsedAmount.toLocaleString()}</span>
              <span className="text-mineral">— Balanced</span>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
