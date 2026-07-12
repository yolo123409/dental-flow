"use client";

interface Props {
  id: string;
  d: string;
  fill: string;

  selected?: boolean;

  onClick?: (surface: string) => void;
}

export default function ToothSurface({
  id,
  d,
  fill,
  selected = false,
  onClick,
}: Props) {
  return (
    <path
      d={d}
      fill={fill}
      stroke={selected ? "#2563EB" : "#334155"}
      strokeWidth={selected ? 2.5 : 1.5}
      style={{
        cursor: "pointer",
        transition: "150ms",
      }}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.(id);
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.opacity = "0.8";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.opacity = "1";
      }}
    />
  );
}