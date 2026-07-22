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
  status?: "Scheduled" | "Ongoing" | "Completed" | "Cancelled";
}

const colors = {
  blue: "bg-sea-glass text-eucalyptus",
  green: "status-completed",
  red: "status-cancelled",
  yellow: "status-scheduled",
  gray: "bg-porcelain text-mineral",
  purple: "bg-sea-glass text-graphite",
};

export default function Badge({
  children,
  color = "blue",
  className = "",
  status,
}: BadgeProps) {
  const statusStyles = status
    ? `status-${status.toLowerCase()}`
    : colors[color];
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold tracking-[0.04em] ${statusStyles} ${className}`}
    >
      {children}
    </span>
  );
}
