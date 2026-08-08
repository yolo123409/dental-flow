import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { supabaseAdmin } from "@/lib/supabase-admin";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

export async function POST(req: NextRequest) {
  try {
    const token = req.headers
      .get("authorization")
      ?.replace("Bearer ", "");

    if (!token) {
      return NextResponse.json(
        { error: "Not authenticated." },
        { status: 401 }
      );
    }

    const {
      data: { user },
      error: authError,
    } = await supabaseAdmin.auth.getUser(token);

    if (authError || !user) {
      return NextResponse.json(
        { error: "Not authenticated." },
        { status: 401 }
      );
    }

    // A user can now have more than one clinic_users row (organization
    // members who've switched into multiple branches) - .limit(1) avoids
    // a hard crash on 2+ rows. This route has no concept of "which branch
    // is active" (it's a stateless API route, not the browser session
    // that tracks that), so for a multi-branch user it may pick a
    // different branch than the one they're actively working in - low
    // severity for this AI-receptionist config lookup (wrong branch's
    // persona, not a cross-tenant leak), not fully solved here.
    const { data: clinicUser } = await supabaseAdmin
      .from("clinic_users")
      .select("clinic_id")
      .eq("auth_user_id", user.id)
      .limit(1)
      .maybeSingle();

    if (!clinicUser?.clinic_id) {
      return NextResponse.json(
        { error: "This account is not linked to a clinic." },
        { status: 403 }
      );
    }

    const { message } = await req.json();

    if (typeof message !== "string" || !message.trim()) {
      return NextResponse.json(
        { error: "Message is required." },
        { status: 400 }
      );
    }

    const { data: receptionist } = await supabaseAdmin
      .from("ai_receptionists")
      .select("*")
      .eq("clinic_id", clinicUser.clinic_id)
      .maybeSingle();

    const systemPrompt = `
You are ${receptionist?.ai_name || "Ava"}.

Clinic:
${receptionist?.clinic_name || "Dental Clinic"}

Personality:
${receptionist?.personality || "Professional and friendly"}

Knowledge:
${receptionist?.knowledge || ""}

Only answer using the clinic information.
If you don't know something, say you don't know.
`;

    const response = await openai.responses.create({
      model: "gpt-4.1",
      input: [
        {
          role: "system",
          content: systemPrompt,
        },
        {
          role: "user",
          content: message,
        },
      ],
    });

    return NextResponse.json({
      reply: response.output_text,
    });
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      {
        error: "AI request failed.",
      },
      {
        status: 500,
      }
    );
  }
}
