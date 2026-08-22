"use client";

import { useEffect } from "react";

import Button from "@/components/ui/Button";
import { logError } from "@/lib/logError";

/**
 * Admin-section-specific boundary: catches an uncaught error thrown by
 * any app/admin/**\/page.tsx while app/admin/layout.tsx (sidebar/shell,
 * ProtectedRoute, OrganizationProvider) stays mounted around it - a
 * closer, more specific catch than the root app/error.tsx, so a single
 * broken page doesn't take the whole admin shell down with it. Same
 * generic-message-only convention as app/error.tsx - never renders
 * error.message.
 */
export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    logError("[admin error boundary]", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-6">
      <div className="w-full max-w-md rounded-lg border border-sea-glass bg-enamel p-8 text-center">
        <h1 className="font-display text-xl font-bold text-graphite">
          This page ran into a problem
        </h1>

        <p className="mt-3 text-sm text-slate-500">
          Something went wrong loading this page. You can try again, or
          go back to the dashboard.
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
