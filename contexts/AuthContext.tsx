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
import { logError } from "@/lib/logError";
import {
  provisionPendingClinicIfNeeded,
  acceptPendingInvitationIfNeeded,
} from "@/services/clinic";
import {
  getCurrentClinicUser,
  getStoredActiveClinicId,
  setStoredActiveClinicId,
} from "@/services/clinicUsers";
import {
  getCurrentOrganizationUser,
  getOrganizationBranches,
  provisionPendingOrganizationIfNeeded,
} from "@/services/organizations";
import { provisionPendingOrganizationInvitationIfNeeded } from "@/services/organizationInvitations";

import { ClinicUser } from "@/types/clinicUser";
import { OrganizationUser } from "@/types/organization";

interface AuthContextType {
  session: Session | null;
  authUser: User | null;
  profile: ClinicUser | null;
  organizationUser: OrganizationUser | null;
  hasOrganizationBranches: boolean;
  loading: boolean;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  session: null,
  authUser: null,
  profile: null,
  organizationUser: null,
  hasOrganizationBranches: false,
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

  const [organizationUser, setOrganizationUser] =
    useState<OrganizationUser | null>(null);

  const [hasOrganizationBranches, setHasOrganizationBranches] =
    useState(false);

  const [loading, setLoading] =
    useState(true);

  async function loadProfile(
    user: User | null
  ) {
    if (!user) {
      setProfile(null);
      setOrganizationUser(null);
      setHasOrganizationBranches(false);

      // Avoid a stale active-clinic id surviving into a different user's
      // session on a shared/kiosk tab.
      setStoredActiveClinicId(null);

      return;
    }

    console.log("[auth] loading clinic profile for", user.id);

    let data: ClinicUser | null = null;

    try {
      data = (await getCurrentClinicUser()) as ClinicUser | null;
    } catch (error) {
      logError("[auth] Failed to load clinic profile:", error);

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

        data = (await getCurrentClinicUser()) as ClinicUser | null;

        console.log(
          "[auth] provisioning finished, clinic profile loaded:",
          data
        );
      } catch (provisionError) {
        logError(
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

        data = (await getCurrentClinicUser()) as ClinicUser | null;
      } catch (acceptError) {
        logError(
          "[auth] Invitation acceptance failed:",
          acceptError
        );
      }
    }

    // Organization membership is resolved independently of clinic_users -
    // a CEO with no branch yet has organizationUser but no profile, and a
    // CEO who's created a branch has both. This is a cheap query (returns
    // null immediately) for every existing single-clinic user, who never
    // has an organization_users row.
    let orgData: OrganizationUser | null = null;

    try {
      orgData = await getCurrentOrganizationUser();

      if (
        !orgData &&
        user.user_metadata?.pending_organization_name
      ) {
        console.log(
          "[auth] no organization_users row yet but pending organization metadata found - provisioning now:",
          user.user_metadata.pending_organization_name
        );

        await provisionPendingOrganizationIfNeeded();

        orgData = await getCurrentOrganizationUser();
      } else if (
        !orgData &&
        user.user_metadata?.pending_organization_invitation_token
      ) {
        console.log(
          "[auth] no organization_users row yet but a pending organization invitation token was found - accepting now"
        );

        await provisionPendingOrganizationInvitationIfNeeded();

        orgData = await getCurrentOrganizationUser();
      }

      setOrganizationUser(orgData);

      if (orgData) {
        const branches = await getOrganizationBranches(
          orgData.organization_id
        );

        setHasOrganizationBranches(branches.length > 0);
      } else {
        setHasOrganizationBranches(false);
      }
    } catch (orgError) {
      logError(
        "[auth] Failed to load organization membership:",
        orgError
      );

      setOrganizationUser(null);
      setHasOrganizationBranches(false);
    }

    // An organization member with no branch explicitly selected THIS
    // session defaults to Organization Overview, never an arbitrary
    // branch (spec: "the CEO's preferred default destination should be
    // Organization Overview") - even though getCurrentClinicUser() above
    // may have resolved some clinic_users row (e.g. their first branch,
    // from a prior session). Once they explicitly switch into a branch,
    // setStoredActiveClinicId() makes this override a no-op for the rest
    // of that session.
    if (orgData && !getStoredActiveClinicId()) {
      setProfile(null);
    } else {
      setProfile(data);
    }
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
        organizationUser,
        hasOrganizationBranches,
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
