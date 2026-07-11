"use client";

import {
  useState,
  useEffect,
  useRef,
} from "react";

import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";

import Avatar from "@/components/ui/Avatar";

import { useAuth } from "@/contexts/AuthContext";
import { signOut } from "@/services/auth";

import UserDropdown from "./UserDropdown";

import { toast } from "sonner";

export default function UserMenu() {
  const router = useRouter();

  const { profile } = useAuth();

  const [loading, setLoading] = useState(false);
  const [open, setOpen] =useState(false);

  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        menuRef.current &&
        !menuRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener(
      "mousedown",
      handleClickOutside
    );

    document.addEventListener(
      "keydown",
      handleEscape
    );

    return () => {
      document.removeEventListener(
        "mousedown",
        handleClickOutside
      );

      document.removeEventListener(
        "keydown",
        handleEscape
      );
    };
  }, []);

  async function handleLogout() {
    try {
      setLoading(true);

      setOpen(false);

      await signOut();

      toast.success("Signed out successfully.");

      router.replace("/auth/login");
      router.refresh();
    } catch (error) {
      console.error(error);

      toast.error("Unable to sign out.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      ref={menuRef}
      className="relative"
    >
      <button
        onClick={() => setOpen((prev) => !prev)}
        className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white px-4 py-2 shadow-sm transition hover:bg-slate-50"
      >
        <Avatar
          name={profile?.full_name ?? "User"}
          avatarUrl={profile?.avatar_url}
          size="md"
        />

        <div className="min-w-[120px] text-left">
          <p className="font-semibold text-slate-900">
            {profile?.full_name}
          </p>

          <p className="text-sm text-slate-500">
            {profile?.role}
          </p>
        </div>

        <ChevronDown
          size={18}
          className={`transition-transform duration-200 ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      <div
        className={`absolute right-0 top-[72px] origin-top-right transition-all duration-200 ${
          open
            ? "scale-100 opacity-100"
            : "pointer-events-none scale-95 opacity-0"
        }`}
      >
        <UserDropdown
          onLogout={handleLogout}
        />
      </div>
    </div>
  );
}