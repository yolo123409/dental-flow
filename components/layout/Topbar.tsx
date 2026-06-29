"use client";

import { Bell, UserCircle } from "lucide-react";

import GlobalSearch from "@/components/layout/GlobalSearch";

export default function Topbar() {
  return (
    <header className="sticky top-0 z-40 flex items-center justify-between rounded-3xl border border-slate-200 bg-white px-6 py-4 shadow-sm backdrop-blur">

      {/* Global Search */}

      <GlobalSearch />

      {/* Right Side */}

      <div className="ml-6 flex items-center gap-5">

        {/* Notifications */}

        <button
          className="relative rounded-2xl bg-slate-100 p-3 transition-all duration-300 hover:-translate-y-0.5 hover:bg-slate-200 hover:shadow-md"
          aria-label="Notifications"
        >
          <Bell size={20} />

          <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-red-500" />
        </button>

        {/* User */}

        <button className="flex items-center gap-3 rounded-2xl bg-slate-100 px-4 py-2 transition-all duration-300 hover:bg-slate-200 hover:shadow-md">

          <UserCircle
            size={36}
            className="text-blue-600"
          />

          <div className="text-left">

            <p className="text-xs text-slate-500">
              Administrator
            </p>

            <p className="font-semibold">
              Bilal
            </p>

          </div>

        </button>

      </div>

    </header>
  );
}