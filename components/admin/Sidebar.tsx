"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import {
  LayoutDashboard,
  Package,
  Boxes,
  ShoppingCart,
  Users,
  UserRound,
  Stethoscope,
  CalendarDays,
  Calendar,
  BarChart3,
  Settings,
  Truck,
  ClipboardList,
  PackageCheck,
  Wallet,
  TrendingUp,
  FileBarChart,
  BookOpen,
  Scale,
  HandCoins,
  LineChart,
  Landmark,
  ScrollText,
  Receipt,
  Activity,
  Percent,
  Gauge,
  Timer,
  UserPlus,
  Building2,
  LayoutGrid,
  CircleDollarSign,
  LucideIcon,
} from "lucide-react";

import { Permission } from "@/lib/permissions";

import { useAuth } from "@/contexts/AuthContext";
import usePermissions from "@/hooks/usePermissions";
import useOrganization from "@/hooks/useOrganization";
import useInventoryAttentionCount from "@/hooks/useInventoryAttentionCount";

import BranchSwitcher from "@/components/organization/BranchSwitcher";

interface SidebarLink {
  name: string;
  href: string;
  icon: LucideIcon;
  permission: Permission;
}

interface SidebarSection {
  title: string;
  links: SidebarLink[];
}

const sections: SidebarSection[] = [
  {
    title: "OVERVIEW",
    links: [
      {
        name: "Dashboard",
        href: "/admin",
        icon: LayoutDashboard,
        permission: "dashboard",
      },
      {
        name: "Analytics",
        href: "/admin/analytics",
        icon: BarChart3,
        permission: "analytics",
      },
      {
        name: "Reports",
        href: "/admin/reports",
        icon: FileBarChart,
        permission: "analytics",
      },
      {
        name: "Visit Analytics",
        href: "/admin/analytics/visits",
        icon: UserPlus,
        permission: "analytics",
      },
    ],
  },

  {
    title: "CLINIC",
    links: [
      {
        name: "Patients",
        href: "/admin/patients",
        icon: UserRound,
        permission: "patients",
      },
      {
        name: "Dentists",
        href: "/admin/dentists",
        icon: Stethoscope,
        permission: "patients",
      },
      {
        name: "Appointments",
        href: "/admin/appointments",
        icon: CalendarDays,
        permission: "appointments",
      },
      {
        name: "Calendar",
        href: "/admin/calendar",
        icon: Calendar,
        permission: "calendar",
      },
      {
        name: "Treatments",
        href: "/admin/treatments",
        icon: Package,
        permission: "patients",
      },
      {
        name: "Inventory",
        href: "/admin/inventory",
        icon: Boxes,
        permission: "inventory",
      },
      {
        name: "Suppliers",
        href: "/admin/inventory/suppliers",
        icon: Truck,
        permission: "procurement",
      },
      {
        name: "Purchase Orders",
        href: "/admin/inventory/purchase-orders",
        icon: ClipboardList,
        permission: "procurement",
      },
      {
        name: "Goods Received",
        href: "/admin/inventory/grns",
        icon: PackageCheck,
        permission: "procurement",
      },
    ],
  },

  {
    title: "BUSINESS",
    links: [
      {
        name: "Billing",
        href: "/admin/billing",
        icon: ShoppingCart,
        permission: "billing",
      },
      {
        name: "Money Out",
        href: "/admin/money-out",
        icon: Wallet,
        permission: "money_out",
      },
      {
        name: "Treatment Profitability",
        href: "/admin/treatment-profitability",
        icon: TrendingUp,
        permission: "treatment_profitability",
      },
    ],
  },

  {
    title: "ACCOUNTING",
    links: [
      {
        name: "Ledger",
        href: "/admin/ledger",
        icon: BookOpen,
        permission: "ledger",
      },
      {
        name: "Trial Balance",
        href: "/admin/ledger/trial-balance",
        icon: Scale,
        permission: "ledger",
      },
      {
        name: "Profit & Loss",
        href: "/admin/ledger/profit-loss",
        icon: LineChart,
        permission: "ledger",
      },
      {
        name: "Cash Flow",
        href: "/admin/ledger/cash-flow",
        icon: Landmark,
        permission: "ledger",
      },
      {
        name: "Balance Sheet",
        href: "/admin/ledger/balance-sheet",
        icon: ScrollText,
        permission: "ledger",
      },
      {
        name: "Accounts Receivable",
        href: "/admin/ledger/accounts-receivable",
        icon: Receipt,
        permission: "ledger",
      },
      {
        name: "EBIT / EBITDA",
        href: "/admin/ledger/ebit-ebitda",
        icon: Activity,
        permission: "ledger",
      },
      {
        name: "Margins & Markup",
        href: "/admin/ledger/margins-markup",
        icon: Percent,
        permission: "ledger",
      },
      {
        name: "Financial Ratios",
        href: "/admin/ledger/financial-ratios",
        icon: Gauge,
        permission: "ledger",
      },
      {
        name: "Stock Days",
        href: "/admin/ledger/stock-days",
        icon: Timer,
        permission: "ledger",
      },
      {
        name: "Accounts Payable",
        href: "/admin/accounts-payable",
        icon: HandCoins,
        permission: "accounts_payable",
      },
    ],
  },

  {
    title: "ADMINISTRATION",
    links: [
      {
        name: "Users",
        href: "/admin/users",
        icon: Users,
        permission: "users",
      },
      {
        name: "Settings",
        href: "/admin/settings",
        icon: Settings,
        permission: "settings",
      },
    ],
  },
];

// CEO is an organization-level capability, entirely separate from the
// clinic permissions above - it's checked via useOrganization()
// (organization_users.role), not lib/permissions.ts, and rendered as
// its own section rather than folded into the permission-filtered
// `sections` array so the two dimensions never get confused with each
// other.
const organizationLinks: SidebarLink[] = [
  {
    name: "Dashboard",
    href: "/admin/organization/dashboard",
    icon: LayoutGrid,
    permission: "dashboard",
  },
  {
    name: "Branches",
    href: "/admin/organization/branches",
    icon: Building2,
    permission: "dashboard",
  },
  {
    name: "Staff",
    href: "/admin/organization/staff",
    icon: Users,
    permission: "dashboard",
  },
  {
    name: "Invitations",
    href: "/admin/organization/invitations",
    icon: UserPlus,
    permission: "dashboard",
  },
  {
    name: "Financials",
    href: "/admin/organization/financials",
    icon: CircleDollarSign,
    permission: "dashboard",
  },
];

export default function Sidebar() {
  const pathname = usePathname();

  const { profile } = useAuth();

  const { hasPermission, role } =
    usePermissions();

  const { isCeo } = useOrganization();

  const { count: attentionCount } =
    useInventoryAttentionCount();

  return (
    <aside className="fixed left-0 top-0 flex h-screen w-72 flex-col border-r border-sea-glass bg-enamel">

      {/* Logo */}

      <div className="border-b border-sea-glass p-8">

        <h1 className="font-display text-3xl font-bold text-eucalyptus">
          Dental Flow
        </h1>

        <p className="mt-2 text-sm text-mineral">
          AI Clinic Platform
        </p>

      </div>

      {/* Active branch switcher - only rendered for multi-branch
          organization members (CEO or Member), never for independent
          clinics; renders itself as a plain read-only label for a
          single-branch member, an interactive dropdown for anyone with
          2+ branches. See components/organization/BranchSwitcher.tsx. */}

      <BranchSwitcher />

      {/* Navigation */}

      <nav className="flex-1 overflow-y-auto px-4 py-6">

        {sections.map((section) => {
          const visibleLinks =
            section.links.filter((link) =>
              hasPermission(link.permission)
            );

          if (visibleLinks.length === 0) {
            return null;
          }

          return (
            <div
              key={section.title}
              className="mb-8"
            >

              <p className="mb-3 px-3 text-[11px] font-bold uppercase tracking-[0.12em] text-mineral">
                {section.title}
              </p>

              {visibleLinks.map((link) => {
                const Icon = link.icon;

                const active =
                  pathname === link.href ||
                  pathname.startsWith(`${link.href}/`);

                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={`mb-2 flex items-center gap-3 rounded-lg px-4 py-3 text-sm transition-colors ${
                      active
                        ? "bg-eucalyptus text-white"
                        : "text-graphite hover:bg-porcelain"
                    }`}
                  >
                    <Icon size={20} />

                    <span className="font-medium">
                      {link.name}
                    </span>

                    {link.name === "Inventory" &&
                      attentionCount > 0 && (
                        <span
                          className={`ml-auto flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] font-semibold ${
                            active
                              ? "bg-white/20 text-white"
                              : "bg-red-500 text-white"
                          }`}
                        >
                          {attentionCount > 9
                            ? "9+"
                            : attentionCount}
                        </span>
                      )}

                  </Link>
                );
              })}

            </div>
          );
        })}

        {/* Organization - CEO-only, gated on organization_users.role
            rather than lib/permissions.ts (a separate capability
            dimension layered on top of the ordinary clinic role the CEO
            also holds in every branch). */}

        {isCeo && (
          <div className="mb-8">

            <p className="mb-3 px-3 text-[11px] font-bold uppercase tracking-[0.12em] text-mineral">
              ORGANIZATION
            </p>

            {organizationLinks.map((link) => {
              const Icon = link.icon;

              const active =
                pathname === link.href ||
                pathname.startsWith(`${link.href}/`);

              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`mb-2 flex items-center gap-3 rounded-lg px-4 py-3 text-sm transition-colors ${
                    active
                      ? "bg-eucalyptus text-white"
                      : "text-graphite hover:bg-porcelain"
                  }`}
                >
                  <Icon size={20} />

                  <span className="font-medium">
                    {link.name}
                  </span>
                </Link>
              );
            })}

          </div>
        )}

      </nav>

      {/* Footer */}

      <div className="border-t border-sea-glass p-6">

        <div className="rounded-lg bg-porcelain p-4">

          <p className="text-sm text-mineral">
            Dental Flow v2.0
          </p>

          <p className="mt-2 font-semibold text-graphite">
            Built for clinical flow
          </p>

          <p className="mt-3 text-xs text-mineral">
            Logged in as{" "}
            <span className="font-semibold">
              {profile?.full_name ?? "Loading..."}
            </span>
          </p>

          <p className="text-xs font-semibold text-eucalyptus">
            {role}
          </p>

        </div>

      </div>

    </aside>
  );
}
