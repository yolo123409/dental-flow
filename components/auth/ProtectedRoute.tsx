"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { useAuth } from "@/contexts/AuthContext";
import { signOut } from "@/services/auth";

interface Props {
  children: React.ReactNode;
}

export default function ProtectedRoute({
  children,
}: Props) {
  const router = useRouter();

  const {
    authUser,
    profile,
    loading,
    profileLoading,
  } = useAuth();

  useEffect(() => {
    if (!loading && !authUser) {
      router.replace("/auth/login");
    }
  }, [loading, authUser, router]);

  if (loading || profileLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <p className="text-slate-500">
          Loading...
        </p>
      </div>
    );
  }

  if (!authUser) {
    return null;
  }

  // Critical Safety Closure (Audit II, Critical #3): a valid auth session
  // with no visible clinic_users row means either the account was
  // removed, or (per the server-side fix in migrations 0130/0131) it was
  // suspended - clinic_users_select_self now excludes non-Active rows,
  // so a suspended user's own row is invisible to them exactly like a
  // deleted one. The app has no way to tell these two apart and doesn't
  // need to - either way, access ends here with a clear message instead
  // of falling through to a confusing per-page Access Denied.
  if (!profile) {
    async function handleSignOut() {
      try {
        await signOut();
      } catch (error) {
        console.error(error);
      } finally {
        router.replace("/auth/login");
        router.refresh();
      }
    }

    return (
      <div className="flex h-screen items-center justify-center px-6">
        <div className="max-w-sm text-center">
          <p className="text-lg font-semibold text-slate-900">
            Your access has been removed or suspended
          </p>

          <p className="mt-2 text-sm text-slate-500">
            Contact your clinic administrator if you believe this is a
            mistake.
          </p>

          <button
            onClick={handleSignOut}
            className="mt-6 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
          >
            Sign Out
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}