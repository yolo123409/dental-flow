import { createClient, User } from "@supabase/supabase-js";
import { NextRequest } from "next/server";

import { supabaseAdmin } from "@/lib/supabase-admin";

/**
 * Shared by every app/api/** route that needs to act on behalf of the
 * signed-in caller. Two distinct clients are needed for these routes, for
 * different reasons:
 *
 * - supabaseAdmin (service role) can call auth.admin.* and read/write
 *   across RLS, but Postgres sees no JWT when it's used, so any RPC relying
 *   on auth.uid() (e.g. is_organization_ceo()) resolves to null through it.
 * - The "caller" client below is scoped to the caller's own access token
 *   (anon key + Authorization header, same as the browser's own supabase
 *   client would send), so RPCs that check auth.uid() keep working exactly
 *   as they do when called directly from the client - no changes needed to
 *   create_organization_invitation/resend_organization_invitation/
 *   cancel_organization_invitation/link_organization_invitation_
 *   provisioned_user's own authorization checks.
 */
export async function authenticateRequest(
  req: NextRequest
): Promise<{ user: User; token: string } | null> {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");

  if (!token) return null;

  const {
    data: { user },
    error,
  } = await supabaseAdmin.auth.getUser(token);

  if (error || !user) return null;

  return { user, token };
}

export function createCallerClient(token: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
      global: {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    }
  );
}
