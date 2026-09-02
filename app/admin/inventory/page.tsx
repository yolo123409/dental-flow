"use client";

import { useMemo, useRef, useState, useEffect } from "react";
import Link from "next/link";
import { toast } from "sonner";

import {
  Package,
  Wallet,
  AlertTriangle,
  XCircle,
  CalendarClock,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import FormInput from "@/components/ui/FormInput";
import StatCard from "@/components/ui/StatCard";
import LoadingSpinner from "@/components/ui/LoadingSpinner";
import EmptyState from "@/components/ui/EmptyState";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import PermissionGuard from "@/components/auth/PermissionGuard";

import usePermissions from "@/hooks/usePermissions";
import { formatRelativeTime } from "@/lib/formatRelativeTime";

import MaterialModal from "@/components/inventory/MaterialModal";
import AdjustStockModal from "@/components/inventory/AdjustStockModal";
import RestockListModal from "@/components/inventory/RestockListModal";

import {
  ClinicInventoryItem,
  InventoryMovement,
  StockStatus,
  ExpiryStatus,
  getInventoryItems,
  deleteInventoryItem,
  deactivateInventoryItem,
  reactivateInventoryItem,
  getStockStatus,
  getExpiryStatus,
  getRecentMovements,
  calculateMarkupFromPrices,
} from "@/services/inventory";
import { getSafeErrorMessage } from "@/lib/logError";

type StatusFilter =
  | "All"
  | StockStatus
  | ExpiryStatus
  | "Needs Attention"
  | "Inactive";

const STATUS_FILTERS: StatusFilter[] = [
  "All",
  "In Stock",
  "Low Stock",
  "Out of Stock",
  "Expiring Soon",
  "Expired",
  "Needs Attention",
  "Inactive",
];

const STOCK_BADGE_CLASSES: Record<StockStatus, string> = {
  "In Stock": "bg-green-100 text-green-700",
  "Low Stock": "bg-yellow-100 text-yellow-700",
  "Out of Stock": "bg-red-100 text-red-700",
};

const EXPIRY_BADGE_CLASSES: Record<ExpiryStatus, string> = {
  "Expiring Soon": "bg-yellow-100 text-yellow-700",
  Expired: "bg-red-100 text-red-700",
};

type SortBy =
  | "name"
  | "quantity"
  | "value"
  | "cost"
  | "expiry";

type SortDir = "asc" | "desc";

interface AttentionEntry {
  item: ClinicInventoryItem;
  label: string;
  priority: number;
}

function buildAttentionEntry(
  item: ClinicInventoryItem
): AttentionEntry | null {
  const quantity = Number(item.quantity);
  const minimum = Number(item.minimum_stock_level);

  const stockStatus = getStockStatus(
    quantity,
    minimum
  );

  const expiryStatus = getExpiryStatus(
    item.expiry_date
  );

  if (
    stockStatus === "In Stock" &&
    !expiryStatus
  ) {
    return null;
  }

  const daysUntilExpiry = item.expiry_date
    ? Math.round(
        (new Date(item.expiry_date).getTime() -
          Date.now()) /
          (1000 * 60 * 60 * 24)
      )
    : null;

  // Priority: out of stock > expiring very soon (<=7d) > low stock >
  // expiring within 30 days.
  if (stockStatus === "Out of Stock") {
    return {
      item,
      label: `${item.name} — Out of stock`,
      priority: 0,
    };
  }

  if (
    expiryStatus === "Expired" ||
    (daysUntilExpiry !== null && daysUntilExpiry <= 7)
  ) {
    return {
      item,
      label:
        expiryStatus === "Expired"
          ? `${item.name} — Expired`
          : `${item.name} — Expires in ${daysUntilExpiry} day${
              daysUntilExpiry === 1 ? "" : "s"
            }`,
      priority: 1,
    };
  }

  if (stockStatus === "Low Stock") {
    return {
      item,
      label: `${item.name} — Low stock — ${quantity} ${item.unit} remaining`,
      priority: 2,
    };
  }

  if (expiryStatus === "Expiring Soon") {
    return {
      item,
      label: `${item.name} — Expires in ${daysUntilExpiry} days`,
      priority: 3,
    };
  }

  return null;
}

function InventoryPageContent() {
  const { hasPermission } = usePermissions();

  const canManage = hasPermission(
    "inventory_manage"
  );

  const [loading, setLoading] = useState(true);

  const [items, setItems] = useState<
    ClinicInventoryItem[]
  >([]);

  const [recentMovements, setRecentMovements] =
    useState<InventoryMovement[]>([]);

  const [showAllActivity, setShowAllActivity] =
    useState(false);

  const [search, setSearch] = useState("");

  const [statusFilter, setStatusFilter] =
    useState<StatusFilter>("All");

  const [categoryFilter, setCategoryFilter] =
    useState("All");

  const [sortBy, setSortBy] = useState<SortBy>("name");
  const [sortDir, setSortDir] =
    useState<SortDir>("asc");

  const [materialModalOpen, setMaterialModalOpen] =
    useState(false);

  const [stockModalOpen, setStockModalOpen] =
    useState(false);

  const [restockModalOpen, setRestockModalOpen] =
    useState(false);

  const [showDeleteDialog, setShowDeleteDialog] =
    useState(false);

  const [selected, setSelected] =
    useState<ClinicInventoryItem | null>(null);

  const [deleting, setDeleting] = useState(false);

  const [togglingActiveId, setTogglingActiveId] =
    useState<string | null>(null);

  const tableRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadInventory();
    loadRecentActivity();
  }, []);

  async function loadInventory() {
    try {
      setLoading(true);

      const data = await getInventoryItems();

      setItems(data);
    } catch (error) {
      toast.error(
        getSafeErrorMessage(error, "Failed to load inventory.")
      );
    } finally {
      setLoading(false);
    }
  }

  async function loadRecentActivity() {
    try {
      const data = await getRecentMovements(20);

      setRecentMovements(data);
    } catch (error) {
      console.error(error);
    }
  }

  async function refreshAll() {
    await Promise.all([
      loadInventory(),
      loadRecentActivity(),
    ]);
  }

  const categories = useMemo(
    () =>
      Array.from(
        new Set(
          items
            .map((item) => item.category)
            .filter(
              (category): category is string =>
                !!category
            )
        )
      ).sort(),
    [items]
  );

  const totals = useMemo(() => {
    let value = 0;
    let low = 0;
    let outOfStock = 0;
    let expiringSoon = 0;
    let expired = 0;

    for (const item of items) {
      const quantity = Number(item.quantity);
      const costPerUnit = Number(item.cost_per_unit);
      const minimum = Number(
        item.minimum_stock_level
      );

      value += quantity * costPerUnit;

      const status = getStockStatus(
        quantity,
        minimum
      );

      if (status === "Low Stock") low += 1;
      if (status === "Out of Stock")
        outOfStock += 1;

      const expiry = getExpiryStatus(
        item.expiry_date
      );

      if (expiry === "Expiring Soon") {
        expiringSoon += 1;
      }

      if (expiry === "Expired") {
        expired += 1;
      }
    }

    return {
      totalMaterials: items.length,
      value,
      low,
      outOfStock,
      expiringSoon,
      expired,
    };
  }, [items]);

  const attentionEntries = useMemo(() => {
    return items
      .map(buildAttentionEntry)
      .filter(
        (entry): entry is AttentionEntry =>
          entry !== null
      )
      .sort((a, b) => a.priority - b.priority);
  }, [items]);

  const restockItems = useMemo(
    () =>
      items.filter(
        (item) =>
          Number(item.quantity) <=
          Number(item.minimum_stock_level)
      ),
    [items]
  );

  function matchesStatusFilter(
    item: ClinicInventoryItem,
    filter: StatusFilter
  ): boolean {
    if (filter === "All") return true;

    const stockStatus = getStockStatus(
      Number(item.quantity),
      Number(item.minimum_stock_level)
    );

    const expiryStatus = getExpiryStatus(
      item.expiry_date
    );

    if (filter === "Needs Attention") {
      return (
        stockStatus !== "In Stock" ||
        expiryStatus !== null
      );
    }

    if (filter === "Inactive") {
      return !item.active;
    }

    if (
      filter === "Expiring Soon" ||
      filter === "Expired"
    ) {
      return expiryStatus === filter;
    }

    return stockStatus === filter;
  }

  const filtered = useMemo(() => {
    const term = search.toLowerCase();

    const results = items.filter((item) => {
      const matchesSearch =
        item.name
          .toLowerCase()
          .includes(term) ||
        (item.category ?? "")
          .toLowerCase()
          .includes(term) ||
        (item.batch_number ?? "")
          .toLowerCase()
          .includes(term);

      const matchesCategory =
        categoryFilter === "All" ||
        item.category === categoryFilter;

      return (
        matchesSearch &&
        matchesCategory &&
        matchesStatusFilter(item, statusFilter)
      );
    });

    const dir = sortDir === "asc" ? 1 : -1;

    return [...results].sort((a, b) => {
      switch (sortBy) {
        case "quantity":
          return (
            (Number(a.quantity) -
              Number(b.quantity)) *
            dir
          );

        case "value":
          return (
            (Number(a.quantity) *
              Number(a.cost_per_unit) -
              Number(b.quantity) *
                Number(b.cost_per_unit)) *
            dir
          );

        case "cost":
          return (
            (Number(a.cost_per_unit) -
              Number(b.cost_per_unit)) *
            dir
          );

        case "expiry": {
          const aTime = a.expiry_date
            ? new Date(a.expiry_date).getTime()
            : Infinity;

          const bTime = b.expiry_date
            ? new Date(b.expiry_date).getTime()
            : Infinity;

          return (aTime - bTime) * dir;
        }

        default:
          return (
            a.name.localeCompare(b.name) * dir
          );
      }
    });
  }, [
    items,
    search,
    statusFilter,
    categoryFilter,
    sortBy,
    sortDir,
  ]);

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: "KES",
      maximumFractionDigits: 0,
    }).format(amount);

  function applyFilterAndScroll(
    filter: StatusFilter
  ) {
    setStatusFilter(filter);

    tableRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }

  function clearFilters() {
    setSearch("");
    setStatusFilter("All");
    setCategoryFilter("All");
  }

  function handleAdd() {
    setSelected(null);
    setMaterialModalOpen(true);
  }

  function handleEdit(item: ClinicInventoryItem) {
    setSelected(item);
    setMaterialModalOpen(true);
  }

  function handleAdjustStock(
    item: ClinicInventoryItem
  ) {
    setSelected(item);
    setStockModalOpen(true);
  }

  function handleDelete(item: ClinicInventoryItem) {
    setSelected(item);
    setShowDeleteDialog(true);
  }

  async function handleToggleActive(
    item: ClinicInventoryItem
  ) {
    try {
      setTogglingActiveId(item.id);

      if (item.active) {
        await deactivateInventoryItem(item.id);

        toast.success(
          `${item.name} deactivated — hidden from new orders and consumption.`
        );
      } else {
        await reactivateInventoryItem(item.id);

        toast.success(`${item.name} reactivated.`);
      }

      await refreshAll();
    } catch (error) {
      toast.error(
        getSafeErrorMessage(
          error,
          "Failed to update material status."
        )
      );
    } finally {
      setTogglingActiveId(null);
    }
  }

  async function confirmDelete() {
    if (!selected) return;

    try {
      setDeleting(true);

      await deleteInventoryItem(selected.id);

      await refreshAll();

      toast.success("Material deleted.");

      setShowDeleteDialog(false);
      setSelected(null);
    } catch (error) {
      toast.error(
        getSafeErrorMessage(error, "Failed to delete material.")
      );
    } finally {
      setDeleting(false);
    }
  }

  const visibleActivity = showAllActivity
    ? recentMovements
    : recentMovements.slice(0, 5);

  return (
    <div className="space-y-8">

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">

        <div>

          <h1 className="text-3xl font-bold">
            Inventory
          </h1>

          <p className="mt-2 text-slate-500">
            Track your clinic&apos;s materials, stock
            levels, costs, and expiry dates.
          </p>

        </div>

        <div className="flex gap-3">

          {restockItems.length > 0 && (
            <Button
              variant="secondary"
              onClick={() =>
                setRestockModalOpen(true)
              }
            >
              Restock List ({restockItems.length})
            </Button>
          )}

          {canManage && (
            <Button onClick={handleAdd}>
              + Add Material
            </Button>
          )}

        </div>

      </div>

      <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-6">

        <StatCard
          title="Total Materials"
          value={totals.totalMaterials}
          icon={<Package size={20} />}
        />

        <StatCard
          title="Inventory Value"
          value={formatCurrency(totals.value)}
          icon={<Wallet size={20} />}
        />

        <button
          onClick={() =>
            applyFilterAndScroll("Low Stock")
          }
          className="text-left transition hover:-translate-y-0.5"
        >
          <StatCard
            title="Low Stock"
            value={totals.low}
            icon={<AlertTriangle size={20} />}
          />
        </button>

        <button
          onClick={() =>
            applyFilterAndScroll("Out of Stock")
          }
          className="text-left transition hover:-translate-y-0.5"
        >
          <StatCard
            title="Out of Stock"
            value={totals.outOfStock}
            icon={<XCircle size={20} />}
          />
        </button>

        <button
          onClick={() =>
            applyFilterAndScroll("Expiring Soon")
          }
          className="text-left transition hover:-translate-y-0.5"
        >
          <StatCard
            title="Expiring Soon"
            value={totals.expiringSoon}
            icon={<CalendarClock size={20} />}
          />
        </button>

        <button
          onClick={() =>
            applyFilterAndScroll("Expired")
          }
          className="text-left transition hover:-translate-y-0.5"
        >
          <StatCard
            title="Expired Items"
            value={totals.expired}
            icon={<XCircle size={20} />}
          />
        </button>

      </div>

      {attentionEntries.length > 0 && (

        <Card title="Needs Attention">

          <div className="space-y-3">

            {attentionEntries
              .slice(0, 6)
              .map((entry) => (
                <div
                  key={entry.item.id}
                  className="flex items-center justify-between rounded-lg border border-sea-glass bg-porcelain px-4 py-3 text-sm"
                >
                  <span className="text-graphite">
                    {entry.label}
                  </span>

                  <Link
                    href={`/admin/inventory/${entry.item.id}`}
                    className="font-semibold text-eucalyptus hover:underline"
                  >
                    View
                  </Link>
                </div>
              ))}

          </div>

          {attentionEntries.length > 6 && (
            <div className="mt-4 text-right">
              <button
                onClick={() =>
                  applyFilterAndScroll(
                    "Needs Attention"
                  )
                }
                className="text-sm font-semibold text-eucalyptus hover:underline"
              >
                View All ({attentionEntries.length})
              </button>
            </div>
          )}

        </Card>

      )}

      <div ref={tableRef}>

      <Card title="Materials">

        <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">

          <div className="lg:max-w-sm lg:flex-1">

            <FormInput
              label="Search"
              placeholder="Search by name, category, or batch..."
              value={search}
              onChange={setSearch}
            />

          </div>

          <div className="flex flex-wrap items-center gap-3">

            <div className="flex flex-wrap gap-2">

              {STATUS_FILTERS.map((status) => (
                <Button
                  key={status}
                  variant={
                    statusFilter === status
                      ? "primary"
                      : "secondary"
                  }
                  className="px-3 py-2 text-xs"
                  onClick={() =>
                    setStatusFilter(status)
                  }
                >
                  {status}
                </Button>
              ))}

            </div>

            {categories.length > 0 && (

              <select
                value={categoryFilter}
                onChange={(e) =>
                  setCategoryFilter(
                    e.target.value
                  )
                }
                className="min-h-11 rounded-lg border border-sea-glass bg-enamel px-3 py-2.5 text-sm text-graphite transition-colors hover:border-mineral/50 focus:border-eucalyptus focus:outline-none"
              >
                <option value="All">
                  All Categories
                </option>

                {categories.map((category) => (
                  <option
                    key={category}
                    value={category}
                  >
                    {category}
                  </option>
                ))}
              </select>

            )}

            <select
              value={sortBy}
              onChange={(e) =>
                setSortBy(
                  e.target.value as SortBy
                )
              }
              className="min-h-11 rounded-lg border border-sea-glass bg-enamel px-3 py-2.5 text-sm text-graphite transition-colors hover:border-mineral/50 focus:border-eucalyptus focus:outline-none"
            >
              <option value="name">
                Sort: Name
              </option>
              <option value="quantity">
                Sort: Quantity
              </option>
              <option value="value">
                Sort: Inventory Value
              </option>
              <option value="cost">
                Sort: Cost
              </option>
              <option value="expiry">
                Sort: Expiry Date
              </option>
            </select>

            <button
              onClick={() =>
                setSortDir((d) =>
                  d === "asc" ? "desc" : "asc"
                )
              }
              aria-label="Toggle sort direction"
              className="flex min-h-11 items-center justify-center rounded-lg border border-sea-glass bg-enamel px-3 text-graphite transition-colors hover:border-mineral/50"
            >
              {sortDir === "asc" ? (
                <ChevronUp size={16} />
              ) : (
                <ChevronDown size={16} />
              )}
            </button>

          </div>

        </div>

        {loading ? (

          <LoadingSpinner text="Loading inventory..." />

        ) : filtered.length === 0 &&
          items.length === 0 ? (

          <EmptyState
            title="Start tracking your clinic inventory"
            description="Add materials to monitor stock levels, costs and expiry dates."
            action={
              canManage ? (
                <Button onClick={handleAdd}>
                  + Add First Material
                </Button>
              ) : undefined
            }
          />

        ) : filtered.length === 0 ? (

          <EmptyState
            title="No materials match these filters"
            description="Try a different search term or filter."
            action={
              <Button
                variant="secondary"
                onClick={clearFilters}
              >
                Clear Filters
              </Button>
            }
          />

        ) : (

          <div className="overflow-x-auto rounded-2xl border border-slate-200">

            <table className="min-w-full">

              <thead className="bg-slate-50">

                <tr>

                  <th className="px-6 py-4 text-left text-sm font-semibold">
                    Material
                  </th>

                  <th className="px-6 py-4 text-left text-sm font-semibold">
                    Category
                  </th>

                  <th className="px-6 py-4 text-right text-sm font-semibold">
                    Stock
                  </th>

                  <th className="px-6 py-4 text-left text-sm font-semibold">
                    Unit
                  </th>

                  <th className="px-6 py-4 text-right text-sm font-semibold">
                    Cost / Unit
                  </th>

                  <th className="px-6 py-4 text-right text-sm font-semibold">
                    Markup
                  </th>

                  <th className="px-6 py-4 text-right text-sm font-semibold">
                    Selling Price
                  </th>

                  <th className="px-6 py-4 text-right text-sm font-semibold">
                    Inventory Value
                  </th>

                  <th className="px-6 py-4 text-right text-sm font-semibold">
                    Minimum
                  </th>

                  <th className="px-6 py-4 text-left text-sm font-semibold">
                    Expiry
                  </th>

                  <th className="px-6 py-4 text-left text-sm font-semibold">
                    Status
                  </th>

                  {canManage && (
                    <th className="px-6 py-4 text-right text-sm font-semibold">
                      Actions
                    </th>
                  )}

                </tr>

              </thead>

              <tbody>

                {filtered.map((item) => {
                  const quantity = Number(
                    item.quantity
                  );

                  const costPerUnit = Number(
                    item.cost_per_unit
                  );

                  const minimum = Number(
                    item.minimum_stock_level
                  );

                  const stockStatus = getStockStatus(
                    quantity,
                    minimum
                  );

                  const expiryStatus = getExpiryStatus(
                    item.expiry_date
                  );

                  return (
                    <tr
                      key={item.id}
                      className={`border-t border-slate-200 ${
                        item.active ? "" : "opacity-60"
                      }`}
                    >

                      <td className="px-6 py-5 font-medium">
                        <Link
                          href={`/admin/inventory/${item.id}`}
                          className="text-eucalyptus hover:underline"
                        >
                          {item.name}
                        </Link>
                      </td>

                      <td className="px-6 py-5 text-slate-600">
                        {item.category || "-"}
                      </td>

                      <td className="px-6 py-5 text-right">
                        {quantity}
                      </td>

                      <td className="px-6 py-5 text-slate-600">
                        {item.unit}
                      </td>

                      <td className="px-6 py-5 text-right">
                        {formatCurrency(
                          costPerUnit
                        )}
                      </td>

                      <td className="px-6 py-5 text-right">
                        {(() => {
                          if (item.selling_price == null) return "—";

                          const impliedMarkup = calculateMarkupFromPrices(
                            costPerUnit,
                            item.selling_price
                          );

                          return impliedMarkup != null
                            ? `${impliedMarkup}%`
                            : "—";
                        })()}
                      </td>

                      <td className="px-6 py-5 text-right">
                        {item.selling_price != null
                          ? formatCurrency(item.selling_price)
                          : "—"}
                      </td>

                      <td className="px-6 py-5 text-right font-semibold">
                        {formatCurrency(
                          quantity * costPerUnit
                        )}
                      </td>

                      <td className="px-6 py-5 text-right text-slate-600">
                        {minimum}
                      </td>

                      <td className="px-6 py-5 text-slate-600">
                        {item.expiry_date
                          ? new Date(
                              item.expiry_date
                            ).toLocaleDateString()
                          : "-"}
                      </td>

                      <td className="px-6 py-5">

                        <div className="flex flex-col items-start gap-1.5">

                          <span
                            className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${STOCK_BADGE_CLASSES[stockStatus]}`}
                          >
                            {stockStatus}
                          </span>

                          {expiryStatus && (
                            <span
                              className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${EXPIRY_BADGE_CLASSES[expiryStatus]}`}
                            >
                              {expiryStatus}
                            </span>
                          )}

                          {!item.active && (
                            <span className="inline-flex items-center rounded-full bg-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-600">
                              Inactive
                            </span>
                          )}

                        </div>

                      </td>

                      {canManage && (
                        <td className="px-6 py-5">

                          <div className="flex justify-end gap-2">

                            <Button
                              variant="secondary"
                              className="px-3 py-2"
                              onClick={() =>
                                handleEdit(item)
                              }
                            >
                              Edit
                            </Button>

                            <Button
                              variant="secondary"
                              className="px-3 py-2"
                              onClick={() =>
                                handleAdjustStock(
                                  item
                                )
                              }
                            >
                              Stock
                            </Button>

                            <Button
                              variant="secondary"
                              className="px-3 py-2"
                              disabled={
                                togglingActiveId ===
                                item.id
                              }
                              onClick={() =>
                                handleToggleActive(
                                  item
                                )
                              }
                            >
                              {item.active
                                ? "Deactivate"
                                : "Reactivate"}
                            </Button>

                            <Button
                              variant="danger"
                              className="px-3 py-2"
                              onClick={() =>
                                handleDelete(item)
                              }
                            >
                              Delete
                            </Button>

                          </div>

                        </td>
                      )}

                    </tr>
                  );
                })}

              </tbody>

            </table>

          </div>

        )}

      </Card>

      </div>

      {recentMovements.length > 0 && (

        <Card title="Recent Inventory Activity">

          <div className="space-y-3">

            {visibleActivity.map((movement) => (
              <div
                key={movement.id}
                className="flex items-center justify-between rounded-lg border border-sea-glass bg-porcelain px-4 py-3 text-sm"
              >

                <div>

                  <p className="font-medium text-graphite">
                    {movement.movement_type ===
                    "Increase"
                      ? "+"
                      : "-"}
                    {Math.abs(
                      Number(
                        movement.quantity_change
                      )
                    )}{" "}
                    {
                      movement
                        .clinic_inventory_items
                        ?.name
                    }{" "}
                    {
                      movement
                        .clinic_inventory_items
                        ?.unit
                    }
                  </p>

                  <p className="mt-1 text-xs text-mineral">
                    {movement.reason}
                    {movement.clinic_users
                      ?.full_name &&
                      ` by ${movement.clinic_users.full_name}`}
                  </p>

                </div>

                <span className="text-xs text-mineral">
                  {formatRelativeTime(
                    movement.created_at
                  )}
                </span>

              </div>
            ))}

          </div>

          {recentMovements.length > 5 && (
            <div className="mt-4 text-right">
              <button
                onClick={() =>
                  setShowAllActivity((v) => !v)
                }
                className="text-sm font-semibold text-eucalyptus hover:underline"
              >
                {showAllActivity
                  ? "Show Less"
                  : "View History"}
              </button>
            </div>
          )}

        </Card>

      )}

      <MaterialModal
        open={materialModalOpen}
        material={selected}
        existingCategories={categories}
        onClose={() =>
          setMaterialModalOpen(false)
        }
        onSaved={refreshAll}
      />

      <AdjustStockModal
        open={stockModalOpen}
        material={selected}
        onClose={() => setStockModalOpen(false)}
        onSaved={refreshAll}
      />

      <RestockListModal
        open={restockModalOpen}
        items={restockItems}
        onClose={() =>
          setRestockModalOpen(false)
        }
      />

      <ConfirmDialog
        open={showDeleteDialog}
        title="Delete material"
        description={
          selected
            ? `Delete "${selected.name}"? This cannot be undone. Materials with stock movement or usage history can't be deleted — deactivate them instead.`
            : undefined
        }
        confirmText="Delete"
        loading={deleting}
        onCancel={() =>
          setShowDeleteDialog(false)
        }
        onConfirm={confirmDelete}
      />

    </div>
  );
}

export default function InventoryPage() {
  return (
    <PermissionGuard permission="inventory">
      <InventoryPageContent />
    </PermissionGuard>
  );
}
