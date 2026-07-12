"use client";

import { useMemo } from "react";
import { svgPathProperties } from "svg-path-properties";

import { PatientTooth } from "@/types";

import Tooth from "./Tooth";

import {
  upperTeeth,
  lowerTeeth,
} from "./toothMap";

import {
  SVG_WIDTH,
  SVG_HEIGHT,
  MAXILLA_PATH,
  MANDIBLE_PATH,
} from "./constants";

import { tangentAngle } from "./math";

interface Props {
  selected: number | null;

  selectedSurface?: string | null;

  toothData: Record<number, PatientTooth>;

  onSelect: (tooth: number) => void;

  onSurfaceClick?: (
    tooth: number,
    surface: string
  ) => void;
}

export default function Odontogram({
  selected,
  selectedSurface,
  toothData,
  onSelect,
  onSurfaceClick,
}: Props) {
  const upperPath = useMemo(
    () => new svgPathProperties(MAXILLA_PATH),
    []
  );

  const lowerPath = useMemo(
    () => new svgPathProperties(MANDIBLE_PATH),
    []
  );

  const upperLength =
    upperPath.getTotalLength();

  const lowerLength =
    lowerPath.getTotalLength();

  return (
    <svg
      viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
      className="w-full"
    >
      {/* Jaw outlines */}

      <path
        d={MAXILLA_PATH}
        fill="none"
        stroke="#E2E8F0"
        strokeWidth="3"
      />

      <path
        d={MANDIBLE_PATH}
        fill="none"
        stroke="#E2E8F0"
        strokeWidth="3"
      />

      {/* Upper Teeth */}

      {upperTeeth.map((tooth, index) => {
        const distance =
          (upperLength / 16.5) * index + 12;

        const point =
          upperPath.getPointAtLength(distance);

        return (
          <Tooth
            key={tooth.number}
            x={point.x}
            y={point.y}
            number={tooth.number}
            rotation={
              tangentAngle(
                upperPath,
                distance
              ) + 90
            }
            selected={
              selected === tooth.number
            }
            selectedSurface={
              selected === tooth.number
                ? selectedSurface ?? undefined
                : undefined
            }
            data={toothData[tooth.number]}
            onClick={onSelect}
            onSurfaceClick={onSurfaceClick}
          />
        );
      })}

      {/* Lower Teeth */}

      {lowerTeeth.map((tooth, index) => {
        const distance =
          (lowerLength / 16.5) * index + 12;

        const point =
          lowerPath.getPointAtLength(distance);

        return (
          <Tooth
            key={tooth.number}
            x={point.x}
            y={point.y}
            number={tooth.number}
            rotation={
              tangentAngle(
                lowerPath,
                distance
              ) - 90
            }
            selected={
              selected === tooth.number
            }
            selectedSurface={
              selected === tooth.number
                ? selectedSurface ?? undefined
                : undefined
            }
            data={toothData[tooth.number]}
            onClick={onSelect}
            onSurfaceClick={onSurfaceClick}
          />
        );
      })}

      {/* Occlusal Plane */}

      <line
        x1="150"
        y1="350"
        x2="850"
        y2="350"
        stroke="#CBD5E1"
        strokeDasharray="8 8"
      />

      <text
        x="500"
        y="340"
        textAnchor="middle"
        fontSize="12"
        fill="#64748B"
        fontWeight="600"
      >
        OCCLUSAL PLANE
      </text>
    </svg>
  );
}