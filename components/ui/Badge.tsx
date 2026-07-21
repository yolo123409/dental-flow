"use client";

import { ReactNode } from "react";

interface BadgeProps {
  children: ReactNode;
  color?:
    | "blue"
    | "green"
    | "red"
    | "yellow"
    | "gray"
    | "purple";
  className?: string;
}

const colors = {
  blue: "bg-blue-100 text-blue-700",
  green: "bg-green-100 text-green-700",
  red: "bg-red-100 text-red-700",
  yellow: "bg-yellow-100 text-yellow-700",
  gray: "bg-slate-100 text-slate-700",
  purple: "bg-purple-100 text-purple-700",
};

export default function Badge({
  children,
  color = "blue",
  className = "",
}: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${colors[color]} ${className}`}
    >
      {children}
    </span>
  );
}