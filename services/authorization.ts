import { canAccess, Permission, UserRole } from "@/lib/permissions";
import { getCurrentClinicUser } from "./clinicUsers";

/**
 * Thrown by assertPermission() below - a distinct type (not a bare
 * Error) so a UI layer could special-case it later (e.g. a generic
 * "Access denied" toast) without string-matching a message, though no
 * caller does that yet.
 */
export class AuthorizationError extends Error {
  constructor(message = "You do not have permission to perform this action.") {
    super(message);
    this.name = "AuthorizationError";
  }
}

/**
 * Service-level defense-in-depth for the clinic-role permission system
 * (lib/permissions.ts) - reuses the exact same role/permission
 * definitions PermissionGuard and usePermissions() already check, just
 * callable from a services/*.ts function instead of a React component.
 *
 * IMPORTANT - what this actually guarantees in this codebase: every
 * services/*.ts function (including this one) runs in the BROWSER via
 * the anon-key Supabase client, not behind a server API this app
 * controls. That means this check is real UX (fails fast with a clear
 * message, before even issuing a network request) and real defense in
 * depth (closes "restricted operations must not be executable merely by
 * calling the service directly" for anyone using this app's own
 * services layer, e.g. via React DevTools or a modified build) - but it
 * is NOT an unbypassable security boundary on its own, because a
 * determined attacker could always call the underlying Supabase
 * REST/RPC endpoints directly with their own valid JWT, skipping this
 * TypeScript function entirely. The one boundary that's actually
 * unbypassable for every caller is Postgres RLS (clinic_id membership
 * via clinic_users.auth_user_id = auth.uid()), which this check does
 * not replace or weaken. lib/permissions.ts's role tiers (e.g. Dentist
 * cannot see billing) are enforced at this layer and the UI layer only,
 * same as before this function existed - RLS in this codebase has
 * always drawn the line at clinic isolation, not per-role table access,
 * and this function does not change that boundary.
 */
export async function assertPermission(permission: Permission): Promise<void> {
  const clinicUser = await getCurrentClinicUser();

  const role = clinicUser?.role as UserRole | undefined;

  if (!role || !canAccess(role, permission)) {
    throw new AuthorizationError();
  }
}
