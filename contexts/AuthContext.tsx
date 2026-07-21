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
import {
  provisionPendingClinicIfNeeded,
  acceptPendingInvitationIfNeeded,
} from "@/services/clinic";

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

    console.log("[auth] loading clinic profile for", user.id);

    let { data, error } = await supabase
      .from("clinic_users")
      .select("*")
      .eq("auth_user_id", user.id)
      .maybeSingle();

    if (error) {
      console.error("[auth] Failed to load clinic profile:", error);

      setProfile(null);

      return;
    }

    // A session can become authenticated without ever going through the
    // signup form's own onboarding call - e.g. Supabase's email-confirmation
    // link establishes a session on whatever page it lands on. This is the
    // single place that guarantees onboarding finishes before any page
    // treats the user as "no clinic" regardless of how they got signed in.
    if (
      !data &&
      user.user_metadata?.pending_clinic_name
    ) {
      console.log(
        "[auth] no clinic_users row yet but pending clinic metadata found - provisioning now:",
        user.user_metadata.pending_clinic_name
      );

      try {
        await provisionPendingClinicIfNeeded();

        const retry = await supabase
          .from("clinic_users")
          .select("*")
          .eq("auth_user_id", user.id)
          .maybeSingle();

        data = retry.data;
        error = retry.error;

        if (error) {
          console.error(
            "[auth] Failed to re-fetch clinic profile after provisioning:",
            error
          );
        } else {
          console.log(
            "[auth] provisioning finished, clinic profile loaded:",
            data
          );
        }
      } catch (provisionError) {
        console.error(
          "[auth] Clinic provisioning failed:",
          provisionError
        );
      }
    }

    // Same deferred-session gap, for staff who signed up via an invite
    // link rather than creating a clinic.
    if (
      !data &&
      user.user_metadata?.pending_invitation_token
    ) {
      console.log(
        "[auth] no clinic_users row yet but a pending invitation token was found - accepting now"
      );

      try {
        await acceptPendingInvitationIfNeeded();

        const retry = await supabase
          .from("clinic_users")
          .select("*")
          .eq("auth_user_id", user.id)
          .maybeSingle();

        data = retry.data;
        error = retry.error;
      } catch (acceptError) {
        console.error(
          "[auth] Invitation acceptance failed:",
          acceptError
        );
      }
    }

    setProfile((data ?? null) as ClinicUser | null);
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