"use client";

import { Minus, TrendingDown, TrendingUp } from "lucide-react";

interface ChangeBadgeProps {
  value: number | null;
  /** Set when a larger value is actually bad (e.g. expenses) - flips the color/direction judgment, not the arrow's sign. */
  invert?: boolean;
}

export default function ChangeBadge({ value, invert = false }: ChangeBadgeProps) {
  if (value == null) {
    return <span className="text-sm text-mineral">—</span>;
  }

  const isFlat = Math.abs(value) < 0.05;
  const isPositive = invert ? value < 0 : value > 0;
  const isNegative = invert ? value > 0 : value < 0;

  const colorClass = isFlat
    ? "text-mineral"
    : isPositive
      ? "text-eucalyptus"
      : isNegative
        ? "text-red-600"
        : "text-mineral";

  const Icon = isFlat ? Minus : value > 0 ? TrendingUp : TrendingDown;

  return (
    <span className={`inline-flex items-center gap-1 text-sm font-semibold ${colorClass}`}>
      <Icon size={14} />
      {value >= 0 ? "+" : ""}
      {value.toFixed(1)}%
    </span>
  );
}
