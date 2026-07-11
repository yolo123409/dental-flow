"use client";

import Tooth from "./Tooth";

interface Props {
  teeth: number[];
  selected: number | null;
  onSelect: (tooth: number) => void;
}

export default function DentalArch({
  teeth,
  selected,
  onSelect,
}: Props) {
  return (
    <div className="flex flex-wrap justify-center gap-3">
      {teeth.map((tooth) => (
        <Tooth
          key={tooth}
          number={tooth}
          selected={selected === tooth}
          onClick={() => onSelect(tooth)}
        />
      ))}
    </div>
  );
}