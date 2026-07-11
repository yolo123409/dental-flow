"use client";

import {
  User,
  Settings,
  KeyRound,
  LogOut,
} from "lucide-react";

import { useAuth } from "@/contexts/AuthContext";

interface Props {
  onLogout: () => void;
}

export default function UserDropdown({
  onLogout,
}: Props) {
  const { profile } = useAuth();

  return (
    <div className="absolute right-0 top-16 z-50 w-72 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">

      {/* Header */}

      <div className="border-b border-slate-100 bg-slate-50 px-5 py-4">

        <p className="text-lg font-semibold text-slate-900">
          {profile?.full_name ?? "User"}
        </p>

        <p className="text-sm text-slate-500">
          {profile?.role}
        </p>

      </div>

      {/* Menu */}

      <div className="py-2">

        <button className="flex w-full items-center gap-3 px-5 py-3 text-left transition hover:bg-slate-50">

          <User size={18} />

          <span>My Profile</span>

        </button>

        <button className="flex w-full items-center gap-3 px-5 py-3 text-left transition hover:bg-slate-50">

          <Settings size={18} />

          <span>Settings</span>

        </button>

        <button className="flex w-full items-center gap-3 px-5 py-3 text-left transition hover:bg-slate-50">

          <KeyRound size={18} />

          <span>Change Password</span>

        </button>

      </div>

      {/* Logout */}

  <div className="border-t border-slate-100 py-2">

  <button
    onClick={onLogout}
    className="flex w-full items-center gap-3 px-5 py-3 text-left text-red-600 transition hover:bg-red-50"
  >
    <LogOut size={18} />

    <span>Logout</span>

  </button>

</div>

    </div>
  );
}