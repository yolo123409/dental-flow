"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import useRealtimeTables from "@/hooks/useRealtimeTables";
import { logError } from "@/lib/logError";

import {
  countAttentionItems,
  getInventoryAttentionSummary,
} from "@/services/inventory";

const RELOAD_DEBOUNCE_MS = 400;

/**
 * Powers the sidebar's Inventory badge. Fetches only a minimal projection
 * (quantity/minimum/expiry, not full rows) and recomputes the count
 * client-side, matching hooks/useNotifications.ts's shape. Unlike
 * notifications (created one at a time), inventory quantities can change
 * in rapid bulk (e.g. restocking several materials in a row), so realtime
 * reloads are debounced here to avoid a refetch per row-change event.
 */
export default function useInventoryAttentionCount() {
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const debounceRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);

  const load = useCallback(async () => {
    try {
      const rows = await getInventoryAttentionSummary();

      setCount(countAttentionItems(rows));
    } catch (err) {
      logError(
        "[useInventoryAttentionCount] Failed to load:",
        err
      );
    } finally {
      setLoading(false);
    }
  }, []);

  const debouncedReload = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(() => {
      void load();
    }, RELOAD_DEBOUNCE_MS);
  }, [load]);

  useEffect(() => {
    void load();

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [load]);

  const realtimeTables = useMemo(
    () => ["clinic_inventory_items"],
    []
  );

  useRealtimeTables({
    tables: realtimeTables,
    reload: debouncedReload,
  });

  return { count, loading };
}
