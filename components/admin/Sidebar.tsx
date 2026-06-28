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
  Bot,
  MessageSquare,
  BarChart3,
  Settings,
} from "lucide-react";

const links = [
  {
    name: "Dashboard",
    href: "/admin",
    icon: LayoutDashboard,
  },
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
    name: "AI Receptionist",
    href: "/admin/receptionist",
    icon: Bot,
  },
  {
    name: "AI Playground",
    href: "/admin/playground",
    icon: MessageSquare,
  },
  {
    name: "Analytics",
    href: "/admin/analytics",
    icon: BarChart3,
  },
  {
    name: "Settings",
    href: "/admin/settings",
    icon: Settings,
  },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="fixed left-0 top-0 flex h-screen w-72 flex-col border-r bg-white">

      <div className="border-b p-8">

        <h1 className="text-3xl font-black text-blue-600">
          Dental Flow
        </h1>

        <p className="mt-2 text-sm text-slate-500">
          AI Clinic Platform
        </p>

      </div>

      <nav className="flex-1 p-4">

        {links.map((link) => {
          const Icon = link.icon;

          const active = pathname === link.href;

          return (
            <Link
              key={link.href}
              href={link.href}
              className={`mb-2 flex items-center gap-3 rounded-xl px-5 py-4 transition ${
                active
                  ? "bg-blue-600 text-white"
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

      </nav>

      <div className="border-t p-6">

        <div className="rounded-xl bg-slate-100 p-4">

          <p className="text-sm text-slate-500">
            Dental Flow v1
          </p>

          <p className="mt-2 font-semibold">
            Built with ❤️ and AI
          </p>

        </div>

      </div>

    </aside>
  );
}