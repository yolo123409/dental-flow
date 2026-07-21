"use client";

import GlobalSearch from "@/components/layout/GlobalSearch";
import UserMenu from "@/components/auth/UserMenu";
import NotificationBell from "@/components/notifications/NotificationBell";

export default function Topbar() {
  return (
    <header className="sticky top-0 z-30 flex h-20 items-center justify-between border-b border-slate-200 bg-white px-8">

      <GlobalSearch />

      <div className="flex items-center gap-6">

        <NotificationBell />

        <UserMenu />

      </div>

    </header>
  );
}