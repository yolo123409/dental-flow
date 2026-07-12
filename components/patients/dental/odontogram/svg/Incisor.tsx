"use client";

import ToothSurface from "../ToothSurface";
import { ToothSurfaces } from "../surface";

interface Props {
  surfaces: ToothSurfaces;
  selectedSurface?: string;
  onSurfaceClick?: (surface: string) => void;
}

export default function Incisor({
  surfaces,
  selectedSurface,
  onSurfaceClick,
}: Props) {
  return (
    <g>
      {/* Incisal */}

      <ToothSurface
        id="incisal"
        d="
          M -8 -20
          L 8 -20
          L 6 -12
          L -6 -12
          Z
        "
        fill={surfaces.incisal}
        selected={selectedSurface === "incisal"}
        onClick={onSurfaceClick}
      />

      {/* Mesial */}

      <ToothSurface
        id="mesial"
        d="
          M -12 -12
          L -6 -12
          L -4 14
          L -12 8
          Z
        "
        fill={surfaces.mesial}
        selected={selectedSurface === "mesial"}
        onClick={onSurfaceClick}
      />

      {/* Distal */}

      <ToothSurface
        id="distal"
        d="
          M 6 -12
          L 12 -12
          L 12 8
          L 4 14
          Z
        "
        fill={surfaces.distal}
        selected={selectedSurface === "distal"}
        onClick={onSurfaceClick}
      />

      {/* Labial */}

      <ToothSurface
        id="labial"
        d="
          M -4 -12
          L 4 -12
          L 4 14
          L -4 14
          Z
        "
        fill={surfaces.labial}
        selected={selectedSurface === "labial"}
        onClick={onSurfaceClick}
      />

      {/* Palatal */}

      <ToothSurface
        id="palatal"
        d="
          M -8 14
          L 8 14
          L 5 22
          L -5 22
          Z
        "
        fill={surfaces.palatal}
        selected={selectedSurface === "palatal"}
        onClick={onSurfaceClick}
      />
    </g>
  );
}