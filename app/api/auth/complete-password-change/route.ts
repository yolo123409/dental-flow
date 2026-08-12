import { NextRequest, NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/supabase-admin";
import { authenticateRequest } from "@/lib/supabase-request";

/**
 * Called after the client has already changed its own password via the
 * normal, user-editable supabase.auth.updateUser({ password }). This
 * route's only job is clearing must_change_password in app_metadata, which
 * is deliberately NOT client-writable (see lib/supabase-request.ts /
 * ProtectedRoute.tsx) - that's what makes the forced-change gate actually
 * enforceable instead of something a signed-in user could clear themselves
 * from the browser console.
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await authenticateRequest(req);

    if (!auth) {
      return NextResponse.json(
        { message: "Not authenticated." },
        { status: 401 }
      );
    }

    const { error } = await supabaseAdmin.auth.admin.updateUserById(
      auth.user.id,
      { app_metadata: { must_change_password: false } }
    );

    if (error) {
      return NextResponse.json(
        { message: error.message },
        { status: 502 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error(
      "[auth/complete-password-change] Unexpected error:",
      error
    );

    return NextResponse.json(
      { message: "Unable to complete the password change." },
      { status: 500 }
    );
  }
}
