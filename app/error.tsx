"use client";

import { useEffect } from "react";

import Button from "@/components/ui/Button";
import { logError } from "@/lib/logError";

/**
 * Catches any otherwise-uncaught render/data error in a route segment
 * that doesn't have its own closer error.tsx (app/admin/error.tsx
 * handles the admin section specifically). Found missing entirely
 * during a production-hardening audit - previously any uncaught
 * exception fell through to Next's bare default error screen with
 * nothing captured. Deliberately shows only a generic message, never
 * error.message - the real detail (which may include internal
 * Postgres/RPC error text) goes to the console only, via the same
 * logError() convention used everywhere else in this app.
 */
export default function GlobalRouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    logError("[app error boundary]", error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-porcelain px-6">
      <div className="w-full max-w-md rounded-lg border border-sea-glass bg-enamel p-8 text-center">
        <h1 className="font-display text-xl font-bold text-graphite">
          Something went wrong
        </h1>

        <p className="mt-3 text-sm text-slate-500">
          An unexpected error occurred. You can try again, or go back to
          the dashboard.
        </p>

        <div className="mt-6 flex justify-center gap-3">
          <Button variant="secondary" onClick={() => reset()}>
            Try again
          </Button>

          <Button onClick={() => (window.location.href = "/admin")}>
            Go to dashboard
          </Button>
        </div>
      </div>
    </div>
  );
}
