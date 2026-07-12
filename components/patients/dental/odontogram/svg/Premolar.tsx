"use client";

import ToothSurface from "../ToothSurface";
import { ToothSurfaces } from "../surface";

interface Props {
  surfaces: ToothSurfaces;
}

export default function Premolar({
  surfaces,
}: Props) {
  return (
    <g>

      <ToothSurface
        id="occlusal"
        fill={surfaces.incisal}
        d="
          M -8 -20
          L 8 -20
          L 10 -10
          L -10 -10
          Z
        "
      />

      <ToothSurface
        id="mesial"
        fill={surfaces.mesial}
        d="
          M -14 -10
          L -4 -10
          L -4 18
          L -14 10
          Z
        "
      />

      <ToothSurface
        id="distal"
        fill={surfaces.distal}
        d="
          M 4 -10
          L 14 -10
          L 14 10
          L 4 18
          Z
        "
      />

      <ToothSurface
        id="labial"
        fill={surfaces.labial}
        d="
          M -4 -10
          L 4 -10
          L 4 18
          L -4 18
          Z
        "
      />

      <ToothSurface
        id="palatal"
        fill={surfaces.palatal}
        d="
          M -8 18
          L 8 18
          L 5 26
          L -5 26
          Z
        "
      />

    </g>
  );
}