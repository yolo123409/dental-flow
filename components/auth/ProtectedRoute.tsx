"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { useAuth } from "@/contexts/AuthContext";

interface Props {
  children: React.ReactNode;
}

export default function ProtectedRoute({
  children,
}: Props) {
  const router = useRouter();

  const {
    authUser,
    loading,
  } = useAuth();

  useEffect(() => {
    if (!loading && !authUser) {
      router.replace("/auth/login");
    }
  }, [loading, authUser, router]);

  if (loading) {
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

  return <>{children}</>;
}