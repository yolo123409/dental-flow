"use client";

import Badge from "@/components/ui/Badge";

import { PurchaseOrderStatus } from "@/types/procurement";

const COLORS: Record<
  PurchaseOrderStatus,
  "blue" | "green" | "red" | "yellow" | "gray" | "purple"
> = {
  Draft: "gray",
  Sent: "blue",
  "Partially Received": "yellow",
  Received: "green",
  Cancelled: "red",
};

export default function POStatusBadge({
  status,
}: {
  status: PurchaseOrderStatus;
}) {
  return <Badge color={COLORS[status]}>{status}</Badge>;
}
