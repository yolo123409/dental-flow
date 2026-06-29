"use client";

import { useEffect } from "react";
import { supabase } from "@/lib/supabase";

export default function useRealtimeDashboard(
  reload: () => Promise<void>
) {
  useEffect(() => {
    const channel = supabase
      .channel("dashboard-realtime")

      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "patients",
        },
        () => reload()
      )

      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "appointments",
        },
        () => reload()
      )

      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "dentists",
        },
        () => reload()
      )

      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "orders",
        },
        () => reload()
      )

      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [reload]);
}