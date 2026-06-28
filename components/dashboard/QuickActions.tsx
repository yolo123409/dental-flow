"use client";

import Link from "next/link";
import {
  UserPlus,
  CalendarPlus,
  Bot,
  Package,
} from "lucide-react";

const actions = [
  {
    title: "Add Patient",
    href: "/admin/patients",
    icon: UserPlus,
  },
  {
    title: "Book Appointment",
    href: "/admin/appointments",
    icon: CalendarPlus,
  },
  {
    title: "AI Receptionist",
    href: "/admin/receptionist",
    icon: Bot,
  },
  {
    title: "Products",
    href: "/admin/products",
    icon: Package,
  },
];

export default function QuickActions() {
  return (
    <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
      {actions.map((action) => {
        const Icon = action.icon;

        return (
          <Link
            key={action.title}
            href={action.href}
            className="group rounded-2xl bg-gradient-to-r from-blue-600 to-indigo-600 p-6 text-white shadow-lg transition duration-300 hover:-translate-y-1 hover:shadow-2xl"
          >
            <Icon
              size={34}
              className="mb-5 transition group-hover:scale-110"
            />

            <h3 className="text-lg font-semibold">
              {action.title}
            </h3>

            <p className="mt-2 text-sm text-blue-100">
              Open module
            </p>
          </Link>
        );
      })}
    </div>
  );
}