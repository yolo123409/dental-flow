"use client";

import GlobalSearch from "@/components/layout/GlobalSearch";
import UserMenu from "@/components/auth/UserMenu";
import NotificationBell from "@/components/notifications/NotificationBell";
import ThemeToggle from "@/components/ui/ThemeToggle";

export default function Topbar() {
  return (
    <header className="sticky top-0 z-30 flex h-20 items-center justify-between border-b border-sea-glass bg-enamel/95 px-4 backdrop-blur sm:px-6 xl:px-8">

      <div className="flex items-center gap-4">
        <GlobalSearch />
      </div>

      <div className="flex items-center gap-6">

        <NotificationBell />

        <ThemeToggle />

        <UserMenu />

      </div>

    </header>
  );
}
