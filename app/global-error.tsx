"use client";

import { useEffect } from "react";

/**
 * Last-resort boundary: catches an error thrown in the ROOT layout
 * itself (app/layout.tsx), which app/error.tsx cannot catch since it
 * only wraps that layout's children. Must render its own <html>/<body>
 * since it fully replaces the root layout - kept deliberately plain
 * (no shared UI components, no Tailwind theme tokens) since a failure
 * this deep means those dependencies may themselves be the problem.
 * Logs to the console directly rather than via lib/logError.ts for the
 * same reason - this boundary should have as few dependencies as
 * possible.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[global error boundary]", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          display: "flex",
          minHeight: "100vh",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "system-ui, sans-serif",
          padding: "24px",
        }}
      >
        <div style={{ textAlign: "center", maxWidth: "28rem" }}>
          <h1 style={{ fontSize: "1.25rem", fontWeight: 700 }}>
            Something went wrong
          </h1>

          <p style={{ marginTop: "0.75rem", color: "#64748b" }}>
            An unexpected error occurred. Please try again.
          </p>

          <button
            onClick={() => reset()}
            style={{
              marginTop: "1.5rem",
              padding: "0.625rem 1.25rem",
              borderRadius: "0.5rem",
              border: "none",
              background: "#0f766e",
              color: "white",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
