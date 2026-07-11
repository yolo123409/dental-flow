"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
} from "react";

import { Session, User } from "@supabase/supabase-js";

import { supabase } from "@/lib/supabase";

interface AuthContextType {
  session: Session | null;
  authUser: User | null;
  loading: boolean;
}

const AuthContext =
  createContext<AuthContextType>({
    session: null,
    authUser: null,
    loading: true,
  });

export function AuthProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [session, setSession] =
    useState<Session | null>(null);

  const [authUser, setAuthUser] =
    useState<User | null>(null);

  const [loading, setLoading] =
    useState(true);

  useEffect(() => {
    async function loadSession() {
      const {
        data: { session },
      } =
        await supabase.auth.getSession();

      setSession(session);
      setAuthUser(session?.user ?? null);

      setLoading(false);
    }

    loadSession();

    const {
      data: { subscription },
    } =
      supabase.auth.onAuthStateChange(
        (_event, session) => {
          setSession(session);
          setAuthUser(session?.user ?? null);
        }
      );

    return () =>
      subscription.unsubscribe();
  }, []);

  return (
    <AuthContext.Provider
      value={{
        session,
        authUser,
        loading,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}