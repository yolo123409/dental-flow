import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { supabaseAdmin } from "@/lib/supabase-admin";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

export async function POST(req: NextRequest) {
  try {
    const { message } = await req.json();

    const { data: receptionist } = await supabaseAdmin
      .from("ai_receptionists")
      .select("*")
      .single();

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