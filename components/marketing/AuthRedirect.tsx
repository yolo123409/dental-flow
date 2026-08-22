"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { useAuth } from "@/contexts/AuthContext";

/**
 * Renders nothing - its only job is to send an already-authenticated
 * visitor on to /admin. Deliberately does NOT gate the landing page's
 * render on auth state the way /auth/login and /auth/signup gate their
 * forms: those pages showing a stale form to a logged-in user for a
 * moment is awkward, but the landing page is public marketing content
 * that the overwhelming majority of visitors (anonymous) should see
 * instantly, with no loading flash. An authenticated visitor sees the
 * landing page for a moment before this redirects them - a standard,
 * acceptable tradeoff for a marketing homepage.
 */
export default function AuthRedirect() {
  const router = useRouter();

  const { authUser, loading, profileLoading } = useAuth();

  useEffect(() => {
    if (!loading && !profileLoading && authUser) {
      router.replace("/admin");
    }
  }, [loading, profileLoading, authUser, router]);

  return null;
}
