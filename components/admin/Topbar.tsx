"use client";

import { Bell, Search } from "lucide-react";

import UserMenu from "@/components/auth/UserMenu";

export default function Topbar() {
  return (
    <header className="sticky top-0 z-30 flex h-20 items-center justify-between border-b border-slate-200 bg-white px-8">

      <div className="relative w-full max-w-md">

        <Search
          size={18}
          className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"
        />

        <input
          type="text"
          placeholder="Search patients, appointments, products..."
          className="w-full rounded-xl border border-slate-200 bg-slate-50 py-3 pl-11 pr-4 outline-none transition focus:border-blue-500 focus:bg-white"
        />

      </div>

      <div className="flex items-center gap-6">

        <button className="relative rounded-xl bg-slate-100 p-3 transition hover:bg-slate-200">

          <Bell size={20} />

          <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-red-500" />

        </button>

        <UserMenu />

      </div>

    </header>
  );
}