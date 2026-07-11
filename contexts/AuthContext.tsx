"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  ReactNode,
} from "react";

import { Session, User } from "@supabase/supabase-js";

import { supabase } from "@/lib/supabase";

import { ClinicUser } from "@/types/clinicUser";

interface AuthContextType {
  session: Session | null;
  authUser: User | null;
  profile: ClinicUser | null;
  loading: boolean;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  session: null,
  authUser: null,
  profile: null,
  loading: true,
  refreshProfile: async () => {},
});

export function AuthProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [session, setSession] =
    useState<Session | null>(null);

  const [authUser, setAuthUser] =
    useState<User | null>(null);

  const [profile, setProfile] =
    useState<ClinicUser | null>(null);

  const [loading, setLoading] =
    useState(true);

  async function loadProfile(
    user: User | null
  ) {
    if (!user) {
      setProfile(null);
      return;
    }

    const { data, error } = await supabase
      .from("clinic_users")
      .select("*")
      .eq("auth_user_id", user.id)
      .maybeSingle();

      console.log("Logged in user ID:", user.id);
console.log("Returned data:", data);
console.log("Returned error:", error);

    if (error) {
  console.error("Profile loading failed:", error);
  console.error("Message:", error.message);
  console.error("Details:", error.details);
  console.error("Hint:", error.hint);

  setProfile(null);

  return;
}

    setProfile(data as ClinicUser);
  }

  async function refreshProfile() {
    await loadProfile(authUser);
  }

  useEffect(() => {
    async function initialize() {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      setSession(session);

      const user = session?.user ?? null;

      setAuthUser(user);

      await loadProfile(user);

      setLoading(false);
    }

    initialize();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        setSession(session);

        const user = session?.user ?? null;

        setAuthUser(user);

        await loadProfile(user);
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  return (
    <AuthContext.Provider
      value={{
        session,
        authUser,
        profile,
        loading,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}