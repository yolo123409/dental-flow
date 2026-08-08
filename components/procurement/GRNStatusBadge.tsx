"use client";

import Badge from "@/components/ui/Badge";

import { GRNStatus } from "@/types/procurement";

const COLORS: Record<GRNStatus, "blue" | "green" | "red" | "yellow" | "gray" | "purple"> = {
  Draft: "gray",
  Received: "green",
  Cancelled: "red",
};

export default function GRNStatusBadge({ status }: { status: GRNStatus }) {
  return <Badge color={COLORS[status]}>{status}</Badge>;
}
