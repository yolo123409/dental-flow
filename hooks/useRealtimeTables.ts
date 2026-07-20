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

    console.log("Creating channel:", channelName);

    const channel = supabase.channel(channelName);

    tables.forEach((table) => {
      console.log("Subscribing to:", table);

      channel.on(
        "postgres_changes",
        {
          event: "*",
          schema,
          table,
        },
        async (payload) => {
          console.log("EVENT RECEIVED", table, payload);

          await reloadRef.current();
        }
      );
    });

    channel.subscribe((status) => {
      console.log("CHANNEL STATUS:", status);
    });

    return () => {
      console.log("Removing channel:", channelName);

      void supabase.removeChannel(channel);
    };
  }, [schema, tables]);
}