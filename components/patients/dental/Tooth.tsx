"use client";

interface Props {
  number: number;
  selected: boolean;
  onClick: () => void;
}

export default function Tooth({
  number,
  selected,
  onClick,
}: Props) {
  return (
    <button
      onClick={onClick}
      className={`flex h-14 w-14 items-center justify-center rounded-xl border-2 font-semibold transition-all duration-200 hover:scale-105 ${
        selected
          ? "border-blue-600 bg-blue-600 text-white shadow-lg"
          : "border-slate-200 bg-white hover:border-blue-300"
      }`}
    >
      {number}
    </button>
  );
}