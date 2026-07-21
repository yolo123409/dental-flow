"use client";

import { useRouter } from "next/navigation";
import { X } from "lucide-react";

import NotificationTypeIcon from "./NotificationTypeIcon";

import { getNotificationHref } from "@/services/notifications";
import { formatRelativeTime } from "@/lib/formatRelativeTime";

import { Notification } from "@/types/notification";

interface Props {
  notification: Notification;
  onRead: (id: string) => void;
  onDelete: (id: string) => void;
  onNavigate: () => void;
}

export default function NotificationRow({
  notification,
  onRead,
  onDelete,
  onNavigate,
}: Props) {
  const router = useRouter();

  function handleClick() {
    if (!notification.read) {
      onRead(notification.id);
    }

    const href = getNotificationHref(notification);

    if (href) {
      onNavigate();
      router.push(href);
    }
  }

  return (
    <div
      className={`group relative flex w-full items-start gap-3 px-5 py-3 transition hover:bg-slate-50 ${
        notification.read ? "" : "bg-blue-50/60"
      }`}
    >
      <button
        type="button"
        onClick={handleClick}
        className="flex flex-1 items-start gap-3 text-left"
      >
        <NotificationTypeIcon type={notification.type} />

        <div className="min-w-0 flex-1">
          <p
            className={`text-sm ${
              notification.read
                ? "font-medium text-slate-700"
                : "font-semibold text-slate-900"
            }`}
          >
            {notification.title}
          </p>

          <p className="mt-0.5 line-clamp-2 text-sm text-slate-500">
            {notification.message}
          </p>

          <p className="mt-1 text-xs text-slate-400">
            {formatRelativeTime(notification.created_at)}
          </p>
        </div>

        {!notification.read && (
          <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-blue-600" />
        )}
      </button>

      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onDelete(notification.id);
        }}
        aria-label="Delete notification"
        className="absolute right-3 top-3 rounded-lg p-1 text-slate-300 opacity-0 transition hover:bg-slate-200 hover:text-slate-600 group-hover:opacity-100"
      >
        <X size={14} />
      </button>
    </div>
  );
}
