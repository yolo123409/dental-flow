"use client";

import { ToothCondition } from "@/types";

interface Props {
  condition?: ToothCondition;
  selected?: boolean;
}

export default function ToothIcon({
  condition,
  selected = false,
}: Props) {
  const fill = (() => {
    switch (condition) {
      case "Caries":
        return "#ef4444";
      case "Filling":
        return "#3b82f6";
      case "Crown":
        return "#facc15";
      case "Implant":
        return "#8b5cf6";
      case "Missing":
        return "#94a3b8";
      default:
        return "#ffffff";
    }
  })();

  return (
    <svg
      width="42"
      height="56"
      viewBox="0 0 64 80"
      className={`transition-all duration-200 ${
        selected
          ? "scale-110 drop-shadow-lg"
          : "hover:scale-105"
      }`}
    >
      <path
        d="M16 8
           C16 0 48 0 48 8
           C58 20 58 34 52 48
           L44 72
           C42 76 38 80 32 80
           C26 80 22 76 20 72
           L12 48
           C6 34 6 20 16 8"
        fill={fill}
        stroke="#334155"
        strokeWidth="2"
      />
    </svg>
  );
}