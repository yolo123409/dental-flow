"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import useRealtimeTables from "@/hooks/useRealtimeTables";
import { logError } from "@/lib/logError";

import {
  checkOverdueInvoices,
  deleteNotification,
  getNotifications,
  getUnreadNotificationCount,
  markAllNotificationsRead,
  markNotificationRead,
} from "@/services/notifications";

import { Notification } from "@/types/notification";

export default function useNotifications() {
  const [notifications, setNotifications] = useState<
    Notification[]
  >([]);

  const [unreadCount, setUnreadCount] = useState(0);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const realtimeTables = useMemo(
    () => ["notifications"],
    []
  );

  const load = useCallback(async () => {
    try {
      setError(null);

      const [list, count] = await Promise.all([
        getNotifications(),
        getUnreadNotificationCount(),
      ]);

      setNotifications(list);
      setUnreadCount(count);
    } catch (err) {
      logError("[useNotifications] Failed to load notifications:", err);

      setError(
        err instanceof Error
          ? err.message
          : "Failed to load notifications."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    // One-time, lazy overdue-invoice sweep for this session - any new
    // notifications it creates arrive via the realtime subscription below.
    void checkOverdueInvoices();
  }, [load]);

  useRealtimeTables({
    tables: realtimeTables,
    reload: load,
  });

  async function markRead(id: string) {
    try {
      await markNotificationRead(id);
      await load();
    } catch (err) {
      logError(
        "[useNotifications] Failed to mark notification read:",
        err
      );
    }
  }

  async function markAllRead() {
    try {
      await markAllNotificationsRead();
      await load();
    } catch (err) {
      logError(
        "[useNotifications] Failed to mark all notifications read:",
        err
      );
    }
  }

  async function remove(id: string) {
    try {
      await deleteNotification(id);
      await load();
    } catch (err) {
      logError(
        "[useNotifications] Failed to delete notification:",
        err
      );
    }
  }

  return {
    notifications,
    unreadCount,
    loading,
    error,
    markRead,
    markAllRead,
    remove,
  };
}
