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
} from "lucide-react";

const sections = [
  {
    title: "OVERVIEW",
    links: [
      {
        name: "Dashboard",
        href: "/admin",
        icon: LayoutDashboard,
      },
      {
        name: "Analytics",
        href: "/admin/analytics",
        icon: BarChart3,
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
      },
      {
        name: "Dentists",
        href: "/admin/dentists",
        icon: Stethoscope,
      },
      {
        name: "Appointments",
        href: "/admin/appointments",
        icon: CalendarDays,
      },
      {
        name: "Calendar",
        href: "/admin/calendar",
        icon: Calendar,
      },
    ],
  },

  {
    title: "BUSINESS",
    links: [
      {
        name: "Products",
        href: "/admin/products",
        icon: Package,
      },
      {
        name: "Orders",
        href: "/admin/orders",
        icon: ShoppingCart,
      },
      {
        name: "Customers",
        href: "/admin/customers",
        icon: Users,
      },
    ],
  },

  {
    title: "AI",
    links: [
      {
        name: "AI Receptionist",
        href: "/admin/receptionist",
        icon: Bot,
      },
      {
        name: "AI Playground",
        href: "/admin/playground",
        icon: MessageSquare,
      },
    ],
  },

  {
    title: "SYSTEM",
    links: [
      {
        name: "Settings",
        href: "/admin/settings",
        icon: Settings,
      },
    ],
  },
];

export default function Sidebar() {
  const pathname = usePathname();

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

        {sections.map((section) => (

          <div
            key={section.title}
            className="mb-8"
          >

            <p className="mb-3 px-3 text-xs font-bold uppercase tracking-widest text-slate-400">

              {section.title}

            </p>

            {section.links.map((link) => {

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

        ))}

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

        </div>

      </div>

    </aside>
  );
}