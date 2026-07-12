"use client";

import ToothSurface from "../ToothSurface";
import { ToothSurfaces } from "../surface";

interface Props {
  surfaces: ToothSurfaces;
}

export default function Canine({
  surfaces,
}: Props) {
  return (
    <g>

      <ToothSurface
        id="incisal"
        fill={surfaces.incisal}
        d="
          M -5 -24
          L 0 -30
          L 5 -24
          L 3 -14
          L -3 -14
          Z
        "
      />

      <ToothSurface
        id="mesial"
        fill={surfaces.mesial}
        d="
          M -12 -14
          L -3 -14
          L -4 16
          L -12 8
          Z
        "
      />

      <ToothSurface
        id="distal"
        fill={surfaces.distal}
        d="
          M 3 -14
          L 12 -14
          L 12 8
          L 4 16
          Z
        "
      />

      <ToothSurface
        id="labial"
        fill={surfaces.labial}
        d="
          M -4 -14
          L 4 -14
          L 4 16
          L -4 16
          Z
        "
      />

      <ToothSurface
        id="palatal"
        fill={surfaces.palatal}
        d="
          M -7 16
          L 7 16
          L 4 24
          L -4 24
          Z
        "
      />

    </g>
  );
}