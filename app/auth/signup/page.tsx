"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import Link from "next/link";

export default function SignupPage() {
  const router = useRouter();

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [loading, setLoading] = useState(false);

  async function signUp() {
    if (!fullName || !email || !password) {
      alert("Please complete all fields.");
      return;
    }

    setLoading(true);

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
    });

    if (error) {
      setLoading(false);
      alert(error.message);
      return;
    }

    if (data.user) {
      await supabase.from("profiles").insert({
        id: data.user.id,
        full_name: fullName,
        email,
        role: "customer",
      });
    }

    setLoading(false);

    alert("Account created successfully.");

    router.push("/auth/login");
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100">
      <div className="w-full max-w-md rounded-2xl bg-white p-10 shadow-xl">

        <h1 className="text-3xl font-bold">
          Create Your Account
        </h1>

        <p className="mt-3 text-slate-600">
          Join Dental Flow.
        </p>

        <div className="mt-8 space-y-5">

          <input
            placeholder="Full Name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className="w-full rounded-lg border p-3"
          />

          <input
            placeholder="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border p-3"
          />

          <input
            placeholder="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border p-3"
          />

          <button
            onClick={signUp}
            disabled={loading}
            className="w-full rounded-lg bg-blue-600 py-3 text-white font-semibold hover:bg-blue-700"
          >
            {loading ? "Creating Account..." : "Create Account"}
          </button>

        </div>

        <p className="mt-8 text-center text-slate-600">
          Already have an account?
        </p>

        <Link
          href="/auth/login"
          className="mt-3 block text-center font-semibold text-blue-600"
        >
          Login
        </Link>

      </div>
    </main>
  );
}