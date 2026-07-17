"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import {
  LayoutDashboard,
  Package,
  ShoppingCart,
  Users,
  UserRound,
  Stethoscope,
  CalendarDays,
  Calendar,
  Bot,
  MessageSquare,
  BarChart3,
  Settings,
  LucideIcon,
} from "lucide-react";

import { Permission } from "@/lib/permissions";

import { useAuth } from "@/contexts/AuthContext";
import usePermissions from "@/hooks/usePermissions";

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
        name: "Customers",
        href: "/admin/customers",
        icon: Users,
        permission: "patients",
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

export default function Sidebar() {
  const pathname = usePathname();

  const { profile } = useAuth();

  const { hasPermission, role } =
    usePermissions();

  return (
    <aside className="fixed left-0 top-0 flex h-screen w-72 flex-col border-r border-slate-200 bg-white shadow-sm">

      {/* Logo */}

      <div className="border-b border-slate-200 p-8">

        <h1 className="text-3xl font-black text-blue-600">
          Dental Flow
        </h1>

        <p className="mt-2 text-sm text-slate-500">
          AI Clinic Platform
        </p>

      </div>

      {/* Navigation */}

      <nav className="flex-1 overflow-y-auto px-4 py-6">

        {sections.map((section) => {
          const visibleLinks =
  section.links;

          if (visibleLinks.length === 0) {
            return null;
          }

          return (
            <div
              key={section.title}
              className="mb-8"
            >

              <p className="mb-3 px-3 text-xs font-bold uppercase tracking-widest text-slate-400">
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
                    className={`mb-2 flex items-center gap-3 rounded-xl px-4 py-3 transition-all duration-200 ${
                      active
                        ? "bg-blue-600 text-white shadow-lg"
                        : "text-slate-700 hover:bg-slate-100"
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
          );
        })}

      </nav>

      {/* Footer */}

      <div className="border-t border-slate-200 p-6">

        <div className="rounded-2xl bg-slate-100 p-4">

          <p className="text-sm text-slate-500">
            Dental Flow v2.0
          </p>

          <p className="mt-2 font-semibold text-slate-800">
            Built with ❤️ and AI
          </p>

          <p className="mt-3 text-xs text-slate-500">
            Logged in as{" "}
            <span className="font-semibold">
              {profile?.full_name ?? "Loading..."}
            </span>
          </p>

          <p className="text-xs font-semibold text-blue-600">
            {role}
          </p>

        </div>

      </div>

    </aside>
  );
}