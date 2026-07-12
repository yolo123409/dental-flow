"use client";

interface Props {
  x: number;
  y: number;
}

export default function ToothPosition({
  x,
  y,
}: Props) {
  return (
    <circle
      cx={x}
      cy={y}
      r="7"
      fill="#2563EB"
    />
  );
}