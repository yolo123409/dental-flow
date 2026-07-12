"use client";

import { useState } from "react";

import {
  PatientTooth,
  ToothCondition,
} from "@/types";

import ToothIcon from "./svg/ToothIcon";
import ToothTooltip from "./ToothTooltip";

interface Props {
  number: number;
  selected: boolean;
  condition?: ToothCondition;
  data?: PatientTooth;
  onClick: () => void;
}

export default function Tooth({
  number,
  selected,
  condition,
  data,
  onClick,
}: Props) {
  const [hovered, setHovered] =
    useState(false);

  return (
    <div
      className="relative"
      onMouseEnter={() =>
        setHovered(true)
      }
      onMouseLeave={() =>
        setHovered(false)
      }
    >
      {hovered && (
        <ToothTooltip
          tooth={number}
          data={data}
        />
      )}

      <button
        onClick={onClick}
        title={`Tooth ${number}${
          condition ? ` • ${condition}` : ""
        }`}
        className={`flex flex-col items-center transition-all duration-200 ${
          selected
            ? "scale-110"
            : "hover:scale-105"
        }`}
      >
        <ToothIcon
          condition={condition}
          selected={selected}
        />

        <span
          className={`mt-2 text-sm font-semibold ${
            selected
              ? "text-blue-600"
              : "text-slate-700"
          }`}
        >
          {number}
        </span>
      </button>
    </div>
  );
}