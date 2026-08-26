/**
 * Pure FDI tooth-numbering and selection-set logic for the odontogram.
 * No React, no DOM - kept separate from useToothSelection.ts so the
 * numbering/quadrant rules (the part that must never be wrong) can be
 * unit tested in isolation.
 */

export type Quadrant = "UR" | "UL" | "LL" | "LR";
export type Arch = "upper" | "lower";
export type Dentition = "Permanent" | "Primary";

// FDI notation: quadrant digit (1=UR, 2=UL, 3=LL, 4=LR) + position digit
// (1=central incisor .. 8=third molar, always counted from the midline
// outward - so position 1 is nearest the midline in every quadrant).
export const UPPER_RIGHT: readonly number[] = [18, 17, 16, 15, 14, 13, 12, 11];
export const UPPER_LEFT: readonly number[] = [21, 22, 23, 24, 25, 26, 27, 28];
export const LOWER_LEFT: readonly number[] = [31, 32, 33, 34, 35, 36, 37, 38];
export const LOWER_RIGHT: readonly number[] = [48, 47, 46, 45, 44, 43, 42, 41];

export const QUADRANT_TEETH: Record<Quadrant, readonly number[]> = {
  UR: UPPER_RIGHT,
  UL: UPPER_LEFT,
  LL: LOWER_LEFT,
  LR: LOWER_RIGHT,
};

export const QUADRANT_LABELS: Record<Quadrant, string> = {
  UR: "Upper Right",
  UL: "Upper Left",
  LL: "Lower Left",
  LR: "Lower Right",
};

export const UPPER_ARCH: readonly number[] = [...UPPER_RIGHT, ...UPPER_LEFT];
export const LOWER_ARCH: readonly number[] = [...LOWER_RIGHT, ...LOWER_LEFT];
export const ALL_TEETH: readonly number[] = [...UPPER_ARCH, ...LOWER_ARCH];

const QUADRANT_BY_TOOTH: ReadonlyMap<number, Quadrant> = new Map(
  (Object.keys(QUADRANT_TEETH) as Quadrant[]).flatMap((quadrant) =>
    QUADRANT_TEETH[quadrant].map((tooth) => [tooth, quadrant] as const)
  )
);

export function isValidTooth(tooth: number): boolean {
  return QUADRANT_BY_TOOTH.has(tooth);
}

export function getQuadrant(tooth: number): Quadrant | null {
  return QUADRANT_BY_TOOTH.get(tooth) ?? null;
}

// Primary (deciduous) FDI notation: quadrant digit 5=UR, 6=UL, 7=LL, 8=LR
// (the permanent quadrant digit + 4, the standard FDI convention) +
// position digit 1=central incisor .. 5=second molar - a primary
// quadrant only has 5 teeth (no premolars, no third molar).
export const PRIMARY_UPPER_RIGHT: readonly number[] = [51, 52, 53, 54, 55];
export const PRIMARY_UPPER_LEFT: readonly number[] = [61, 62, 63, 64, 65];
export const PRIMARY_LOWER_LEFT: readonly number[] = [71, 72, 73, 74, 75];
export const PRIMARY_LOWER_RIGHT: readonly number[] = [81, 82, 83, 84, 85];

export const PRIMARY_QUADRANT_TEETH: Record<Quadrant, readonly number[]> = {
  UR: PRIMARY_UPPER_RIGHT,
  UL: PRIMARY_UPPER_LEFT,
  LL: PRIMARY_LOWER_LEFT,
  LR: PRIMARY_LOWER_RIGHT,
};

export const PRIMARY_UPPER_ARCH: readonly number[] = [
  ...PRIMARY_UPPER_RIGHT,
  ...PRIMARY_UPPER_LEFT,
];
export const PRIMARY_LOWER_ARCH: readonly number[] = [
  ...PRIMARY_LOWER_RIGHT,
  ...PRIMARY_LOWER_LEFT,
];
export const ALL_PRIMARY_TEETH: readonly number[] = [
  ...PRIMARY_UPPER_ARCH,
  ...PRIMARY_LOWER_ARCH,
];

const PRIMARY_QUADRANT_BY_TOOTH: ReadonlyMap<number, Quadrant> = new Map(
  (Object.keys(PRIMARY_QUADRANT_TEETH) as Quadrant[]).flatMap((quadrant) =>
    PRIMARY_QUADRANT_TEETH[quadrant].map((tooth) => [tooth, quadrant] as const)
  )
);

export function isValidPrimaryTooth(tooth: number): boolean {
  return PRIMARY_QUADRANT_BY_TOOTH.has(tooth);
}

export function getPrimaryQuadrant(tooth: number): Quadrant | null {
  return PRIMARY_QUADRANT_BY_TOOTH.get(tooth) ?? null;
}

export function toggleTooth(
  selection: ReadonlySet<number>,
  tooth: number
): Set<number> {
  const next = new Set(selection);

  if (next.has(tooth)) {
    next.delete(tooth);
  } else {
    next.add(tooth);
  }

  return next;
}

export function selectQuadrant(
  quadrant: Quadrant,
  dentition: Dentition = "Permanent"
): Set<number> {
  const table = dentition === "Primary" ? PRIMARY_QUADRANT_TEETH : QUADRANT_TEETH;
  return new Set(table[quadrant]);
}

export function selectArch(
  arch: Arch,
  dentition: Dentition = "Permanent"
): Set<number> {
  if (dentition === "Primary") {
    return new Set(arch === "upper" ? PRIMARY_UPPER_ARCH : PRIMARY_LOWER_ARCH);
  }
  return new Set(arch === "upper" ? UPPER_ARCH : LOWER_ARCH);
}

export function selectAllTeeth(dentition: Dentition = "Permanent"): Set<number> {
  return new Set(dentition === "Primary" ? ALL_PRIMARY_TEETH : ALL_TEETH);
}

export function removeFromSelection(
  selection: ReadonlySet<number>,
  tooth: number
): Set<number> {
  const next = new Set(selection);
  next.delete(tooth);
  return next;
}

export function sortedTeeth(selection: ReadonlySet<number>): number[] {
  return Array.from(selection).sort((a, b) => a - b);
}

/**
 * Human-readable summary for the selection toolbar, e.g. "1 tooth
 * selected", "3 teeth selected", "Upper arch selected", "All teeth
 * selected". Recognizes an exact quadrant/arch/all-teeth match so the
 * toolbar can name the group instead of just the count.
 */
export function describeSelection(selection: ReadonlySet<number>): string {
  const count = selection.size;

  if (count === 0) {
    return "No teeth selected";
  }

  if (count === 1) {
    return "1 tooth selected";
  }

  if (setEquals(selection, ALL_TEETH)) {
    return `All teeth selected · ${count} teeth`;
  }

  if (setEquals(selection, UPPER_ARCH)) {
    return `Upper arch selected · ${count} teeth`;
  }

  if (setEquals(selection, LOWER_ARCH)) {
    return `Lower arch selected · ${count} teeth`;
  }

  for (const quadrant of Object.keys(QUADRANT_TEETH) as Quadrant[]) {
    if (setEquals(selection, QUADRANT_TEETH[quadrant])) {
      return `${QUADRANT_LABELS[quadrant]} selected · ${count} teeth`;
    }
  }

  return `${count} teeth selected`;
}

function setEquals(
  selection: ReadonlySet<number>,
  teeth: readonly number[]
): boolean {
  if (selection.size !== teeth.length) {
    return false;
  }

  return teeth.every((tooth) => selection.has(tooth));
}
