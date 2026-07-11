"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";

import { signIn } from "@/services/auth";

import { toast } from "sonner";

export default function LoginForm() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [loading, setLoading] = useState(false);

  async function handleSubmit(
    e: React.FormEvent<HTMLFormElement>
  ) {
    e.preventDefault();

    if (loading) return;

    try {
      setLoading(true);

      await signIn(
        email.trim(),
        password
      );

      toast.success("Welcome back!");

      router.push("/admin");
      router.refresh();

    } catch (error: unknown) {
      console.error(error);

      if (error instanceof Error) {
        toast.error(
          error.message || "Unable to sign in."
        );
      } else {
        toast.error("Unable to sign in.");
      }

    } finally {
      setLoading(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-6"
    >
      <Input
        placeholder="Email address"
        value={email}
        onChange={(e) =>
          setEmail(e.target.value)
        }
      />

      <Input
        type="password"
        placeholder="Password"
        value={password}
        onChange={(e) =>
          setPassword(e.target.value)
        }
      />

      <Button
        type="submit"
        disabled={loading}
        className="w-full"
      >
        {loading
          ? "Signing In..."
          : "Sign In"}
      </Button>

    </form>
  );
}