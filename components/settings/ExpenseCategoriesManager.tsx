"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ChevronUp, ChevronDown } from "lucide-react";

import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import FormModal from "@/components/ui/FormModal";
import FormInput from "@/components/ui/FormInput";
import FormTextarea from "@/components/ui/FormTextarea";
import LoadingSpinner from "@/components/ui/LoadingSpinner";

import {
  getExpenseCategories,
  createExpenseCategory,
  updateExpenseCategory,
  archiveExpenseCategory,
  reactivateExpenseCategory,
  reorderExpenseCategories,
} from "@/services/expenseCategories";
import { getSafeErrorMessage, logError } from "@/lib/logError";

import { ExpenseCategory } from "@/types/expenses";

const SUGGESTED_CATEGORIES = [
  "Staff / Payroll",
  "Rent",
  "Utilities",
  "Dental Lab",
  "Inventory & Supplies",
  "Equipment",
  "Marketing",
  "Software / Subscriptions",
  "Taxes / Licences",
  "Miscellaneous",
];

export default function ExpenseCategoriesManager() {
  const [loading, setLoading] = useState(true);
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [showArchived, setShowArchived] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingCategory, setEditingCategory] =
    useState<ExpenseCategory | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      setLoading(true);

      const data = await getExpenseCategories({ includeInactive: true });

      setCategories(data);
    } catch (error) {
      toast.error(
        getSafeErrorMessage(
          error,
          "Failed to load expense categories.",
          "[ExpenseCategoriesManager] load failed:"
        )
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const active = categories
    .filter((category) => category.active)
    .sort((a, b) => a.display_order - b.display_order);

  const archived = categories.filter((category) => !category.active);

  function openAddModal() {
    setEditingCategory(null);
    setName("");
    setDescription("");
    setModalOpen(true);
  }

  function openEditModal(category: ExpenseCategory) {
    setEditingCategory(category);
    setName(category.name);
    setDescription(category.description ?? "");
    setModalOpen(true);
  }

  async function handleSave() {
    if (!name.trim()) {
      toast.error("Category name is required.");
      return;
    }

    try {
      setBusy(true);

      if (editingCategory) {
        await updateExpenseCategory(editingCategory.id, {
          name: name.trim(),
          description: description.trim() || null,
        });
      } else {
        await createExpenseCategory({
          name: name.trim(),
          description: description.trim() || null,
        });
      }

      toast.success(editingCategory ? "Category updated." : "Category added.");

      setModalOpen(false);

      await load();
    } catch (error) {
      toast.error(
        getSafeErrorMessage(
          error,
          "Failed to save category.",
          "[ExpenseCategoriesManager] save failed:"
        )
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleArchive(category: ExpenseCategory) {
    try {
      await archiveExpenseCategory(category.id);

      toast.success(`"${category.name}" archived.`);

      await load();
    } catch (error) {
      toast.error(
        getSafeErrorMessage(
          error,
          "Failed to archive category.",
          "[ExpenseCategoriesManager] archive failed:"
        )
      );
    }
  }

  async function handleReactivate(category: ExpenseCategory) {
    try {
      await reactivateExpenseCategory(category.id);

      toast.success(`"${category.name}" reactivated.`);

      await load();
    } catch (error) {
      toast.error(
        getSafeErrorMessage(
          error,
          "Failed to reactivate category.",
          "[ExpenseCategoriesManager] reactivate failed:"
        )
      );
    }
  }

  async function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= active.length) return;

    const next = [...active];
    [next[index], next[target]] = [next[target], next[index]];

    setCategories((prev) => {
      const archivedOnly = prev.filter((c) => !c.active);
      return [...next, ...archivedOnly];
    });

    try {
      await reorderExpenseCategories(next.map((c) => c.id));
    } catch (error) {
      logError("[ExpenseCategoriesManager] reorder failed:", error);

      toast.error("Failed to save the new order.");

      await load();
    }
  }

  async function addSuggested() {
    try {
      setBusy(true);

      const existingNames = new Set(
        categories.map((c) => c.name.toLowerCase())
      );

      const toAdd = SUGGESTED_CATEGORIES.filter(
        (name) => !existingNames.has(name.toLowerCase())
      );

      for (const suggestedName of toAdd) {
        await createExpenseCategory({ name: suggestedName });
      }

      toast.success("Suggested categories added.");

      await load();
    } catch (error) {
      logError("[ExpenseCategoriesManager] addSuggested failed:", error);

      toast.error("Failed to add suggested categories.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <LoadingSpinner text="Loading categories..." />;
  }

  return (
    <div>
      <p className="mb-4 text-sm text-mineral">
        Customize the expense categories your clinic uses in Money Out.
      </p>

      {active.length === 0 ? (
        <div className="rounded-lg border border-dashed border-sea-glass p-6 text-center">
          <p className="mb-4 text-sm text-mineral">
            No expense categories yet.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <Button variant="secondary" onClick={addSuggested} disabled={busy}>
              Add Suggested Categories
            </Button>
            <Button onClick={openAddModal}>+ Add Category</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {active.map((category, index) => (
            <div
              key={category.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-sea-glass px-4 py-3"
            >
              <div>
                <p className="font-semibold text-graphite">{category.name}</p>
                {category.description && (
                  <p className="text-sm text-mineral">
                    {category.description}
                  </p>
                )}
              </div>

              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => move(index, -1)}
                  disabled={index === 0}
                  className="rounded-lg p-2 text-slate-500 hover:bg-porcelain disabled:opacity-30"
                  aria-label="Move up"
                >
                  <ChevronUp size={16} />
                </button>
                <button
                  type="button"
                  onClick={() => move(index, 1)}
                  disabled={index === active.length - 1}
                  className="rounded-lg p-2 text-slate-500 hover:bg-porcelain disabled:opacity-30"
                  aria-label="Move down"
                >
                  <ChevronDown size={16} />
                </button>

                <Button
                  variant="secondary"
                  className="px-3 py-2 text-xs"
                  onClick={() => openEditModal(category)}
                >
                  Edit
                </Button>
                <Button
                  variant="danger"
                  className="px-3 py-2 text-xs"
                  onClick={() => handleArchive(category)}
                >
                  Archive
                </Button>
              </div>
            </div>
          ))}

          <Button variant="secondary" onClick={openAddModal}>
            + Add Category
          </Button>
        </div>
      )}

      {archived.length > 0 && (
        <div className="mt-6">
          <button
            type="button"
            onClick={() => setShowArchived((prev) => !prev)}
            className="text-sm font-semibold text-eucalyptus hover:underline"
          >
            {showArchived ? "Hide" : "Show"} archived categories (
            {archived.length})
          </button>

          {showArchived && (
            <div className="mt-3 space-y-2">
              {archived.map((category) => (
                <div
                  key={category.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-sea-glass px-4 py-3"
                >
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-graphite">
                      {category.name}
                    </p>
                    <Badge color="gray">Archived</Badge>
                  </div>

                  <Button
                    variant="secondary"
                    className="px-3 py-2 text-xs"
                    onClick={() => handleReactivate(category)}
                  >
                    Reactivate
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <FormModal
        open={modalOpen}
        title={editingCategory ? "Edit Category" : "Add Category"}
        loading={busy}
        onClose={() => setModalOpen(false)}
        onSubmit={handleSave}
      >
        <FormInput label="Name" required value={name} onChange={setName} />

        <FormTextarea
          label="Description (optional)"
          value={description}
          onChange={setDescription}
        />
      </FormModal>
    </div>
  );
}
