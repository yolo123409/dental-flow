"use client";

interface Props {
  d: string;
}

export default function JawPath({
  d,
}: Props) {
  return (
    <path
      d={d}
      fill="none"
      stroke="#CBD5E1"
      strokeWidth="3"
    />
  );
}