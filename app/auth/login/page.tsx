"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function LoginPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleLogin() {
    if (!email || !password) {
      alert("Please enter your email and password.");
      return;
    }

    setLoading(true);

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    setLoading(false);

    if (error) {
      alert(error.message);
      return;
    }

    router.push("/dashboard");
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100">
      <div className="w-full max-w-md rounded-2xl bg-white p-10 shadow-xl">

        <h1 className="text-3xl font-bold">
          Welcome Back
        </h1>

        <p className="mt-3 text-slate-600">
          Login to your Dental Flow account.
        </p>

        <div className="mt-8 space-y-5">

          <input
            type="email"
            placeholder="Email Address"
            className="w-full rounded-lg border p-3"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />

          <input
            type="password"
            placeholder="Password"
            className="w-full rounded-lg border p-3"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          <button
            onClick={handleLogin}
            disabled={loading}
            className="w-full rounded-lg bg-blue-600 py-3 font-semibold text-white hover:bg-blue-700"
          >
            {loading ? "Logging In..." : "Login"}
          </button>

        </div>

        <p className="mt-8 text-center text-slate-600">
          Don't have an account?
        </p>

        <Link
          href="/auth/signup"
          className="mt-3 block text-center font-semibold text-blue-600"
        >
          Create an Account
        </Link>

      </div>
    </main>
  );
}