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

                  </Link>
                );
              })}

            </div>
          );
        })}

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
