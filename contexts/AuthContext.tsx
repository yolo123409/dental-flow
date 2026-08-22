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
import { logError, toError } from "@/lib/logError";
import {
  provisionPendingClinicIfNeeded,
  acceptPendingInvitationIfNeeded,
} from "@/services/clinic";
import { provisionPendingOrganizationIfNeeded } from "@/services/organizations";
import { getCurrentClinicUser } from "@/services/clinicUsers";

import { ClinicUser } from "@/types/clinicUser";

interface AuthContextType {
  session: Session | null;
  authUser: User | null;
  profile: ClinicUser | null;
  loading: boolean;
  profileLoading: boolean;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  session: null,
  authUser: null,
  profile: null,
  loading: true,
  profileLoading: false,
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

  // True for the duration of loadProfile() - including any deferred
  // onboarding provisioning it triggers below. Pages that redirect based
  // on authUser (e.g. the login page) must wait for this to go false
  // too, or they navigate to a clinic-scoped page before the clinic
  // actually exists yet.
  const [profileLoading, setProfileLoading] =
    useState(false);

  async function loadProfile(
    user: User | null
  ) {
    if (!user) {
      setProfile(null);
      return;
    }

    setProfileLoading(true);

    try {
      await loadProfileInner(user);
    } finally {
      setProfileLoading(false);
    }
  }

  async function loadProfileInner(
    user: User
  ) {
    // getCurrentClinicUser() (services/clinicUsers.ts) resolves 0 or 1
    // clinic_users rows exactly like the old direct .maybeSingle() query
    // did, and additionally resolves 2+ rows via the organization's
    // active-branch selection - required now that a CEO can hold more
    // than one clinic_users row (one per branch). The old raw query here
    // would throw "multiple rows returned" the moment a CEO had a second
    // branch, permanently breaking their session on next load.
    let clinicUser: ClinicUser | null;

    try {
      clinicUser = (await getCurrentClinicUser()) as ClinicUser | null;
    } catch (error) {
      logError("[auth] Failed to load clinic profile:", toError(error));

      setProfile(null);

      return;
    }

    // A session can become authenticated without ever going through the
    // signup form's own onboarding call - e.g. Supabase's email-confirmation
    // link establishes a session on whatever page it lands on. This is the
    // single place that guarantees onboarding finishes before any page
    // treats the user as "no clinic" regardless of how they got signed in.
    if (
      !clinicUser &&
      user.user_metadata?.pending_clinic_name
    ) {
      try {
        await provisionPendingClinicIfNeeded();

        clinicUser = (await getCurrentClinicUser()) as ClinicUser | null;
      } catch (provisionError) {
        logError(
          "[auth] Clinic provisioning failed:",
          provisionError
        );
      }
    }

    // Same deferred-session gap, for Multi-Branch Organization signups -
    // mirrors the pending_clinic_name branch above exactly, just for the
    // organization/initial-branch RPC (services/organizations.ts).
    if (
      !clinicUser &&
      user.user_metadata?.pending_organization_name
    ) {
      try {
        await provisionPendingOrganizationIfNeeded();

        clinicUser = (await getCurrentClinicUser()) as ClinicUser | null;
      } catch (provisionError) {
        logError(
          "[auth] Organization provisioning failed:",
          provisionError
        );
      }
    }

    // Same deferred-session gap, for staff who signed up via an invite
    // link rather than creating a clinic.
    if (
      !clinicUser &&
      user.user_metadata?.pending_invitation_token
    ) {
      console.log(
        "[auth] no clinic_users row yet but a pending invitation token was found - accepting now"
      );

      try {
        await acceptPendingInvitationIfNeeded();

        clinicUser = (await getCurrentClinicUser()) as ClinicUser | null;
      } catch (acceptError) {
        logError(
          "[auth] Invitation acceptance failed:",
          acceptError
        );
      }
    }

    setProfile(clinicUser);
  }

  async function refreshProfile() {
    await loadProfile(authUser);
  }

  useEffect(() => {
    async function initialize() {
      try {
        const {
          data: { session },
          error,
        } = await supabase.auth.getSession();

        if (error) {
          logError("[auth] Failed to get session:", error);
        }

        setSession(session);

        const user = session?.user ?? null;

        setAuthUser(user);

        await loadProfile(user);
      } catch (error) {
        logError("[auth] Failed to initialize auth state:", error);
      } finally {
        setLoading(false);
      }
    }

    initialize();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        try {
          setSession(session);

          const user = session?.user ?? null;

          setAuthUser(user);

          await loadProfile(user);
        } catch (error) {
          logError(
            "[auth] Failed to handle auth state change:",
            error
          );
        }
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
        profileLoading,
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