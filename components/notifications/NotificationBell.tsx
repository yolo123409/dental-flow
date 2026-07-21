"use client";

import { useEffect, useRef, useState } from "react";
import { Bell } from "lucide-react";

import NotificationPanel from "./NotificationPanel";

import useNotifications from "@/hooks/useNotifications";

export default function NotificationBell() {
  const [open, setOpen] = useState(false);

  const bellRef = useRef<HTMLDivElement>(null);

  const {
    notifications,
    unreadCount,
    loading,
    error,
    markRead,
    markAllRead,
    remove,
  } = useNotifications();

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        bellRef.current &&
        !bellRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener(
        "mousedown",
        handleClickOutside
      );
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  return (
    <div ref={bellRef} className="relative">
      <button
        onClick={() => setOpen((prev) => !prev)}
        aria-label="Notifications"
        className="relative rounded-xl bg-slate-100 p-3 transition hover:bg-slate-200"
      >
        <Bell size={20} />

        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[11px] font-semibold text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      <div
        className={`absolute right-0 top-18 origin-top-right transition-all duration-200 ${
          open
            ? "scale-100 opacity-100"
            : "pointer-events-none scale-95 opacity-0"
        }`}
      >
        <NotificationPanel
          notifications={notifications}
          unreadCount={unreadCount}
          loading={loading}
          error={error}
          onRead={markRead}
          onDelete={remove}
          onMarkAllRead={markAllRead}
          onNavigate={() => setOpen(false)}
        />
      </div>
    </div>
  );
}
