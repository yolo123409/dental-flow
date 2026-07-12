"use client";

import { PatientTooth } from "@/types";

import Incisor from "./svg/Incisor";
import Canine from "./svg/Canine";
import Premolar from "./svg/Premolar";
import Molar from "./svg/Molar";

import {
  healthySurfaces,
  ToothSurfaces,
} from "./surface";

interface Props {
  x: number;
  y: number;
  rotation: number;
  number: number;

  selected: boolean;

  selectedSurface?: string;

  data?: PatientTooth;

  onClick: (tooth: number) => void;

  onSurfaceClick?: (
    tooth: number,
    surface: string
  ) => void;
}

function getFill(condition?: string) {
  switch (condition) {
    case "Caries":
      return "#EF4444";

    case "Filling":
      return "#3B82F6";

    case "Crown":
      return "#FACC15";

    case "Implant":
      return "#8B5CF6";

    case "Missing":
      return "#64748B";

    default:
      return "#FFFFFF";
  }
}

function createSurfaces(
  condition?: string
): ToothSurfaces {
  const fill = getFill(condition);

  return {
    ...healthySurfaces,
    incisal: fill,
    mesial: fill,
    distal: fill,
    labial: fill,
    palatal: fill,
  };
}

function ToothShape({
  number,
  surfaces,
  selectedSurface,
  onSurfaceClick,
}: {
  number: number;
  surfaces: ToothSurfaces;
  selectedSurface?: string;
  onSurfaceClick?: (
    surface: string
  ) => void;
}) {
  if (
    [11,12,21,22,31,32,41,42].includes(number)
  ) {
    return (
      <Incisor
        surfaces={surfaces}
        selectedSurface={selectedSurface}
        onSurfaceClick={onSurfaceClick}
      />
    );
  }

  if (
    [13,23,33,43].includes(number)
  ) {
    return (
      <Canine
        surfaces={surfaces}
      />
    );
  }

  if (
    [14,15,24,25,34,35,44,45].includes(number)
    ) {
    return (
      <Premolar
        surfaces={surfaces}
      />
    );
  }

  return (
    <Molar
      surfaces={surfaces}
    />
  );
}

export default function Tooth({
  x,
  y,
  rotation,
  number,
  selected,
  selectedSurface,
  data,
  onClick,
  onSurfaceClick,
}: Props) {

  const surfaces =
    createSurfaces(data?.condition);

  return (
    <g
      transform={`translate(${x},${y}) rotate(${rotation})`}
      onClick={() => onClick(number)}
      style={{
        cursor: "pointer",
      }}
    >
      {selected && (
        <circle
          r="24"
          fill="none"
          stroke="#2563EB"
          strokeWidth="3"
        />
      )}

      <ToothShape
        number={number}
        surfaces={surfaces}
        selectedSurface={selectedSurface}
        onSurfaceClick={(surface) =>
          onSurfaceClick?.(
            number,
            surface
          )
        }
      />

      <text
        y="42"
        textAnchor="middle"
        fontSize="12"
        fontWeight="700"
        fill="#334155"
      >
        {number}
      </text>
    </g>
  );
}