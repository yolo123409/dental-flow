"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import FormInput from "@/components/ui/FormInput";
import LoadingSpinner from "@/components/ui/LoadingSpinner";
import PermissionGuard from "@/components/auth/PermissionGuard";

import {
  createLedgerAccount,
  getLedgerAccounts,
  getLedgerSettings,
  setExpenseCategoryAccount,
  setLedgerAccountActive,
  setOpeningBalance,
  updateLedgerAccount,
  updateLedgerSettings,
} from "@/services/ledger";
import { getExpenseCategories } from "@/services/expenseCategories";
import { getClinicSettings } from "@/services/settings";

import { LedgerAccount, LedgerAccountType, LedgerSettings } from "@/types/ledger";
import { ExpenseCategory } from "@/types/expenses";
import { getSafeErrorMessage } from "@/lib/logError";

const ACCOUNT_TYPES: LedgerAccountType[] = ["Asset", "Liability", "Equity", "Income", "Expense"];

const PAYMENT_METHODS = ["Cash", "M-Pesa", "Bank Transfer", "Card", "Cheque", "Insurance", "Other"];

const MAPPING_FIELDS: { key: keyof LedgerSettings; label: string }[] = [
  { key: "treatment_revenue_account_id", label: "Treatment Revenue" },
  { key: "accounts_receivable_account_id", label: "Accounts Receivable" },
  { key: "inventory_account_id", label: "Inventory" },
  { key: "accounts_payable_account_id", label: "Accounts Payable" },
  { key: "supplies_used_account_id", label: "Supplies Used (Inventory Consumption)" },
  { key: "default_expense_account_id", label: "Default Expense Account (unmapped categories)" },
  { key: "default_cash_account_id", label: "Default Cash Account (unmapped payment methods)" },
  { key: "opening_balance_equity_account_id", label: "Opening Balance Equity" },
];

function AccountingSettingsContent() {
  const [loading, setLoading] = useState(true);
  const [currency, setCurrency] = useState("KES");

  const [accounts, setAccounts] = useState<LedgerAccount[]>([]);
  const [settings, setSettings] = useState<LedgerSettings | null>(null);
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);

  const [newCode, setNewCode] = useState("");
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<LedgerAccountType>("Expense");
  const [creating, setCreating] = useState(false);

  const [openingAmounts, setOpeningAmounts] = useState<Record<string, string>>({});
  const [savingOpening, setSavingOpening] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);

      const [clinicSettings, accountRows, settingsRow, categoryRows] = await Promise.all([
        getClinicSettings(),
        getLedgerAccounts({ includeInactive: true }),
        getLedgerSettings(),
        getExpenseCategories(),
      ]);

      setCurrency(clinicSettings.currency || "KES");
      setAccounts(accountRows);
      setSettings(settingsRow);
      setCategories(categoryRows);
    } catch (error) {
      toast.error(getSafeErrorMessage(error, "Failed to load accounting settings."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleCreateAccount() {
    if (!newCode.trim() || !newName.trim()) {
      toast.error("Enter both a code and a name.");
      return;
    }

    try {
      setCreating(true);

      await createLedgerAccount({ code: newCode.trim(), name: newName.trim(), type: newType });

      toast.success("Account created.");

      setNewCode("");
      setNewName("");

      await load();
    } catch (error) {
      toast.error(getSafeErrorMessage(error, "Unable to create account."));
    } finally {
      setCreating(false);
    }
  }

  async function handleRenameAccount(account: LedgerAccount, name: string) {
    if (name.trim() === account.name || !name.trim()) return;

    try {
      await updateLedgerAccount(account.id, { name: name.trim() });
      await load();
    } catch (error) {
      toast.error(getSafeErrorMessage(error, "Unable to rename account."));
    }
  }

  async function handleToggleActive(account: LedgerAccount) {
    try {
      await setLedgerAccountActive(account.id, !account.active);
      toast.success(account.active ? "Account deactivated." : "Account reactivated.");
      await load();
    } catch (error) {
      toast.error(getSafeErrorMessage(error, "Unable to update account."));
    }
  }

  async function handleMappingChange(key: keyof LedgerSettings, accountId: string) {
    try {
      await updateLedgerSettings({ [key]: accountId || null } as Partial<LedgerSettings>);
      await load();
    } catch (error) {
      toast.error(getSafeErrorMessage(error, "Unable to update mapping."));
    }
  }

  async function handlePaymentMethodMapping(method: string, accountId: string) {
    if (!settings) return;

    try {
      const next = { ...settings.payment_method_accounts };
      if (accountId) next[method] = accountId;
      else delete next[method];

      await updateLedgerSettings({ payment_method_accounts: next });
      await load();
    } catch (error) {
      toast.error(getSafeErrorMessage(error, "Unable to update mapping."));
    }
  }

  async function handleCategoryMapping(categoryId: string, accountId: string) {
    try {
      await setExpenseCategoryAccount(categoryId, accountId || null);
      await load();
    } catch (error) {
      toast.error(getSafeErrorMessage(error, "Unable to update category mapping."));
    }
  }

  async function handleSetOpeningBalance(account: LedgerAccount) {
    const raw = openingAmounts[account.id];
    const amount = Number(raw || 0);

    if (!raw || amount < 0) {
      toast.error("Enter an opening balance of 0 or more.");
      return;
    }

    try {
      setSavingOpening(account.id);

      await setOpeningBalance(account.id, amount);

      toast.success(`Opening balance set for ${account.name}.`);

      setOpeningAmounts((prev) => ({ ...prev, [account.id]: "" }));
    } catch (error) {
      toast.error(getSafeErrorMessage(error, "Unable to set opening balance."));
    } finally {
      setSavingOpening(null);
    }
  }

  if (loading || !settings) {
    return <LoadingSpinner text="Loading accounting settings..." />;
  }

  const activeAccounts = accounts.filter((a) => a.active);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Accounting Settings</h1>
        <p className="mt-2 text-slate-500">
          Manage the Chart of Accounts, default postings, and opening balances for the ledger.
        </p>
      </div>

      <Card title="Chart of Accounts">
        <div className="mb-6 flex flex-wrap items-end gap-3 rounded-lg border border-dashed border-sea-glass p-4">
          <div className="w-40">
            <FormInput label="Code" value={newCode} onChange={setNewCode} />
          </div>
          <div className="flex-1">
            <FormInput label="Account Name" value={newName} onChange={setNewName} />
          </div>
          <div>
            <label className="mb-2 block text-sm font-semibold text-graphite">Type</label>
            <select
              value={newType}
              onChange={(e) => setNewType(e.target.value as LedgerAccountType)}
              className="min-h-11 rounded-lg border border-sea-glass bg-enamel px-3 py-2.5 text-sm text-graphite focus:border-eucalyptus focus:outline-none"
            >
              {ACCOUNT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </div>
          <Button disabled={creating} onClick={handleCreateAccount}>
            {creating ? "Adding..." : "+ Add Account"}
          </Button>
        </div>

        <div className="overflow-x-auto rounded-2xl border border-slate-200">
          <table className="min-w-full">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-6 py-4 text-left text-sm font-semibold">Code</th>
                <th className="px-6 py-4 text-left text-sm font-semibold">Name</th>
                <th className="px-6 py-4 text-left text-sm font-semibold">Type</th>
                <th className="px-6 py-4 text-left text-sm font-semibold">Status</th>
                <th className="w-32"></th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((account) => (
                <tr key={account.id} className="border-t border-slate-200">
                  <td className="px-6 py-3 text-slate-600">{account.code}</td>
                  <td className="px-6 py-3">
                    <input
                      defaultValue={account.name}
                      onBlur={(e) => handleRenameAccount(account, e.target.value)}
                      className="w-full rounded-md border border-transparent bg-transparent px-2 py-1 hover:border-sea-glass focus:border-eucalyptus focus:outline-none"
                    />
                  </td>
                  <td className="px-6 py-3 text-slate-600">{account.type}</td>
                  <td className="px-6 py-3">
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${
                        account.active
                          ? "bg-green-100 text-green-700"
                          : "bg-slate-100 text-slate-500"
                      }`}
                    >
                      {account.active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="px-6 py-3 text-right">
                    <button
                      onClick={() => handleToggleActive(account)}
                      className="text-sm font-medium text-eucalyptus hover:underline"
                    >
                      {account.active ? "Deactivate" : "Reactivate"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Default Account Mappings">
        <p className="mb-4 text-sm text-mineral">
          These control where automatic postings go when an invoice, payment, GRN, or inventory
          consumption event happens.
        </p>

        <div className="grid gap-5 sm:grid-cols-2">
          {MAPPING_FIELDS.map((field) => (
            <div key={String(field.key)}>
              <label className="mb-2 block text-sm font-semibold text-graphite">
                {field.label}
              </label>
              <select
                value={(settings[field.key] as string) ?? ""}
                onChange={(e) => handleMappingChange(field.key, e.target.value)}
                className="min-h-11 w-full rounded-lg border border-sea-glass bg-enamel px-3 py-2.5 text-sm text-graphite focus:border-eucalyptus focus:outline-none"
              >
                <option value="">Not configured</option>
                {activeAccounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.code} {account.name}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      </Card>

      <Card title="Payment Method → Account Mapping">
        <p className="mb-4 text-sm text-mineral">
          Patient payments and Money Out expenses post to whichever account is mapped to the
          payment method used. Unmapped methods fall back to the Default Cash Account above.
        </p>

        <div className="grid gap-5 sm:grid-cols-2">
          {PAYMENT_METHODS.map((method) => (
            <div key={method}>
              <label className="mb-2 block text-sm font-semibold text-graphite">{method}</label>
              <select
                value={settings.payment_method_accounts[method] ?? ""}
                onChange={(e) => handlePaymentMethodMapping(method, e.target.value)}
                className="min-h-11 w-full rounded-lg border border-sea-glass bg-enamel px-3 py-2.5 text-sm text-graphite focus:border-eucalyptus focus:outline-none"
              >
                <option value="">Use default cash account</option>
                {activeAccounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.code} {account.name}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      </Card>

      <Card title="Money Out Category → Account Mapping">
        <p className="mb-4 text-sm text-mineral">
          Each expense category posts to its mapped account. Unmapped categories fall back to the
          Default Expense Account above - they still post, never silently dropped.
        </p>

        {categories.length === 0 ? (
          <p className="text-sm text-mineral">No expense categories configured yet.</p>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2">
            {categories.map((category) => (
              <div key={category.id}>
                <label className="mb-2 block text-sm font-semibold text-graphite">
                  {category.name}
                </label>
                <select
                  value={category.default_ledger_account_id ?? ""}
                  onChange={(e) => handleCategoryMapping(category.id, e.target.value)}
                  className="min-h-11 w-full rounded-lg border border-sea-glass bg-enamel px-3 py-2.5 text-sm text-graphite focus:border-eucalyptus focus:outline-none"
                >
                  <option value="">Use default expense account</option>
                  {activeAccounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.code} {account.name}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title="Opening Balances">
        <p className="mb-4 text-sm text-mineral">
          Set a starting balance for an account as of today. Setting a new opening balance
          replaces the previous one (via reversal - the original stays in the audit trail).
        </p>

        <div className="space-y-3">
          {activeAccounts
            .filter((account) => account.type === "Asset" || account.type === "Liability")
            .map((account) => (
              <div
                key={account.id}
                className="flex flex-wrap items-center gap-3 rounded-lg border border-sea-glass px-4 py-3"
              >
                <span className="w-64 font-medium text-graphite">
                  {account.code} {account.name}
                </span>

                <input
                  type="number"
                  placeholder={`Opening balance (${currency})`}
                  value={openingAmounts[account.id] ?? ""}
                  onChange={(e) =>
                    setOpeningAmounts((prev) => ({ ...prev, [account.id]: e.target.value }))
                  }
                  className="min-h-11 w-56 rounded-lg border border-sea-glass bg-enamel px-3 py-2.5 text-sm text-graphite focus:border-eucalyptus focus:outline-none"
                />

                <Button
                  variant="secondary"
                  className="px-3 py-2 text-sm"
                  disabled={savingOpening === account.id}
                  onClick={() => handleSetOpeningBalance(account)}
                >
                  {savingOpening === account.id ? "Saving..." : "Set Opening Balance"}
                </Button>
              </div>
            ))}
        </div>
      </Card>
    </div>
  );
}

export default function AccountingSettingsPage() {
  return (
    <PermissionGuard permission="ledger_manage">
      <AccountingSettingsContent />
    </PermissionGuard>
  );
}
