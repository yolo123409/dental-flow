"use client";

import { BellOff } from "lucide-react";

import NotificationRow from "./NotificationRow";

import { Notification } from "@/types/notification";

interface Props {
  notifications: Notification[];
  unreadCount: number;
  loading: boolean;
  error: string | null;
  onRead: (id: string) => void;
  onDelete: (id: string) => void;
  onMarkAllRead: () => void;
  onNavigate: () => void;
}

export default function NotificationPanel({
  notifications,
  unreadCount,
  loading,
  error,
  onRead,
  onDelete,
  onMarkAllRead,
  onNavigate,
}: Props) {
  return (
    <div className="absolute right-0 top-16 z-50 w-96 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
      <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-5 py-4">
        <p className="text-lg font-semibold text-slate-900">
          Notifications
        </p>

        {unreadCount > 0 && (
          <button
            type="button"
            onClick={onMarkAllRead}
            className="text-sm font-medium text-blue-600 hover:underline"
          >
            Mark all as read
          </button>
        )}
      </div>

      <div className="max-h-[26rem] overflow-y-auto">
        {loading ? (
          <div className="py-12 text-center text-sm text-slate-400">
            Loading notifications...
          </div>
        ) : error ? (
          <div className="px-5 py-8 text-center">
            <p className="text-sm font-semibold text-red-600">
              Couldn&apos;t load notifications
            </p>
            <p className="mt-1 text-xs text-red-500">{error}</p>
          </div>
        ) : notifications.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-center">
            <BellOff className="text-slate-300" size={28} />
            <p className="text-sm font-medium text-slate-500">
              You&apos;re all caught up.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100 py-1">
            {notifications.map((notification) => (
              <NotificationRow
                key={notification.id}
                notification={notification}
                onRead={onRead}
                onDelete={onDelete}
                onNavigate={onNavigate}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
