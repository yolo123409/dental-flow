"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";

type Message = {
  id: string;
  sender: string;
  message: string;
};

export default function PlaygroundPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadConversation();
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({
      behavior: "smooth",
    });
  }, [messages]);

  async function loadConversation() {
    const { data } = await supabase
      .from("ai_conversations")
      .select("*")
      .order("created_at");

    setMessages(data || []);
  }

  async function clearConversation() {
    if (!confirm("Clear conversation?")) return;

    await supabase
      .from("ai_conversations")
      .delete()
      .neq("id", "");

    setMessages([]);
  }

  async function sendMessage() {
    if (!prompt.trim()) return;

    setLoading(true);

    const patientMessage = prompt;
    setPrompt("");

    await supabase.from("ai_conversations").insert({
      sender: "Patient",
      message: patientMessage,
    });

    const response = await fetch("/api/ai", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: patientMessage,
      }),
    });

    const result = await response.json();

    if (!response.ok) {
      alert(result.error || "AI request failed.");
      setLoading(false);
      await loadConversation();
      return;
    }

    await supabase.from("ai_conversations").insert({
      sender: "AI Receptionist",
      message: result.reply,
    });

    await loadConversation();

    setLoading(false);
  }

  return (
    <main className="min-h-screen bg-slate-100">
      <div className="mx-auto flex h-screen max-w-5xl flex-col p-8">

        <div className="mb-6 flex items-center justify-between">

          <div>

            <h1 className="text-5xl font-bold">
              AI Playground
            </h1>

            <p className="mt-2 text-slate-600">
              Chat with your AI Receptionist.
            </p>

          </div>

          <button
            onClick={clearConversation}
            className="rounded-xl bg-red-600 px-6 py-3 text-white hover:bg-red-700"
          >
            Clear Chat
          </button>

        </div>

        <div className="flex-1 overflow-y-auto rounded-2xl bg-white p-8 shadow">

          {messages.length === 0 ? (

            <div className="text-center text-slate-500">

              <h2 className="text-3xl font-bold">
                Start chatting
              </h2>

              <p className="mt-3">
                Ask the AI Receptionist anything.
              </p>

            </div>

          ) : (

            messages.map((message) => (

              <div
                key={message.id}
                className={`mb-6 flex ${
                  message.sender === "Patient"
                    ? "justify-end"
                    : "justify-start"
                }`}
              >

                <div
                  className={`max-w-xl rounded-2xl px-6 py-4 ${
                    message.sender === "Patient"
                      ? "bg-blue-600 text-white"
                      : "bg-slate-200"
                  }`}
                >

                  <p className="mb-2 text-sm font-bold">
                    {message.sender}
                  </p>

                  <p className="whitespace-pre-wrap">
                    {message.message}
                  </p>

                </div>

              </div>

            ))

          )}

          <div ref={bottomRef} />

        </div>

        <div className="mt-6 flex gap-4">

          <input
            value={prompt}
            onChange={(e) =>
              setPrompt(e.target.value)
            }
            onKeyDown={(e) => {
              if (e.key === "Enter" && !loading) {
                sendMessage();
              }
            }}
            placeholder="Message your AI receptionist..."
            className="flex-1 rounded-xl border p-4"
          />

          <button
            disabled={loading}
            onClick={sendMessage}
            className="rounded-xl bg-blue-600 px-8 text-white hover:bg-blue-700"
          >
            {loading ? "Thinking..." : "Send"}
          </button>

        </div>

      </div>
    </main>
  );
}