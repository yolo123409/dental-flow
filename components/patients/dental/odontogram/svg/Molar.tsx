"use client";

import ToothSurface from "../ToothSurface";
import { ToothSurfaces } from "../surface";

interface Props {
  surfaces: ToothSurfaces;
}

export default function Molar({
  surfaces,
}: Props) {
  return (
    <g>

      <ToothSurface
        id="occlusal"
        fill={surfaces.incisal}
        d="
          M -10 -22
          L 10 -22
          L 12 -8
          L -12 -8
          Z
        "
      />

      <ToothSurface
        id="mesial"
        fill={surfaces.mesial}
        d="
          M -16 -8
          L -5 -8
          L -5 20
          L -16 12
          Z
        "
      />

      <ToothSurface
        id="distal"
        fill={surfaces.distal}
        d="
          M 5 -8
          L 16 -8
          L 16 12
          L 5 20
          Z
        "
      />

      <ToothSurface
        id="labial"
        fill={surfaces.labial}
        d="
          M -5 -8
          L 5 -8
          L 5 20
          L -5 20
          Z
        "
      />

      <ToothSurface
        id="palatal"
        fill={surfaces.palatal}
        d="
          M -10 20
          L 10 20
          L 6 30
          L -6 30
          Z
        "
      />

    </g>
  );
}