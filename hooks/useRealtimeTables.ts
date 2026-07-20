"use client";

import { useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";

interface UseRealtimeTablesOptions {
  tables: string[];
  reload: () => Promise<void> | void;
  schema?: string;
}

export default function useRealtimeTables({
  tables,
  reload,
  schema = "public",
}: UseRealtimeTablesOptions) {
  const reloadRef = useRef(reload);

  useEffect(() => {
    reloadRef.current = reload;
  }, [reload]);

  useEffect(() => {
    const channelName = `realtime-${tables.join("-")}`;

    const channel = supabase.channel(channelName);

    tables.forEach((table) => {
      channel.on(
        "postgres_changes",
        {
          event: "*",
          schema,
          table,
        },
        async () => {
          await reloadRef.current();
        }
      );
    });

    channel.subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [schema, tables]);
}