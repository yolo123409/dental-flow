"use client";

import { PatientTooth } from "@/types";

import Tooth from "./Tooth";

import {
  upperArch,
  lowerArch,
} from "./archLayout";

interface Props {
  teeth: number[];
  selected: number | null;
  toothData: Record<number, PatientTooth>;
  onSelect: (tooth: number) => void;
}

export default function DentalArch({
  teeth,
  selected,
  toothData,
  onSelect,
}: Props) {
  const positions =
    teeth[0] < 30
      ? upperArch
      : lowerArch;

  return (
    <div className="flex justify-center overflow-x-auto">

      <div
        className="relative"
        style={{
          width: 1100,
          height: 180,
        }}
      >
        {teeth.map((tooth) => {
          const position =
            positions[tooth];

          return (
            <div
              key={tooth}
              className="absolute"
              style={{
                left:
                  position.x * 60,
                top:
                  position.y,
              }}
            >
              <Tooth
                number={tooth}
                selected={
                  selected === tooth
                }
                condition={
                  toothData[tooth]
                    ?.condition
                }
                data={
                  toothData[tooth]
                }
                onClick={() =>
                  onSelect(tooth)
                }
              />
            </div>
          );
        })}
      </div>

    </div>
  );
}