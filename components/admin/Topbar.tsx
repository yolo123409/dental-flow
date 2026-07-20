"use client";

import { Bell } from "lucide-react";

import GlobalSearch from "@/components/layout/GlobalSearch";
import UserMenu from "@/components/auth/UserMenu";

export default function Topbar() {
  return (
    <header className="sticky top-0 z-30 flex h-20 items-center justify-between border-b border-slate-200 bg-white px-8">

      <GlobalSearch />

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