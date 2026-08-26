/**
 * Adapter between the vendored react-odontogram (which only knows the
 * permanent FDI id scheme "teeth-11".."teeth-48", one path per quadrant
 * position 1-8) and DentalFlow's primary/deciduous FDI tooth numbers
 * (51-55/61-65/71-75/81-85).
 *
 * The vendor library has no primary-dentition mode of its own - despite
 * appearances, there's no "primary" concept anywhere in vendor/ (checked
 * data.ts, type.ts, Odontogram.tsx, utils.ts). What it does have is a
 * `maxTeeth` prop that already slices each quadrant down to its first N
 * tooth shapes, and a primary quadrant has exactly 5 teeth (central
 * incisor, lateral incisor, canine, first molar, second molar) where a
 * permanent quadrant has 8. Reusing the SAME shapes for those first 5
 * positions and remapping the quadrant digit (permanent 1-4 -> primary
 * 5-8, the standard FDI convention) gets a correctly-numbered, correctly
 * laid out primary odontogram without drawing new artwork or touching
 * vendor/ at all.
 */

export const PRIMARY_ODONTOGRAM_MAX_TEETH = 5;

/**
 * Primary FDI number (51-85) -> the vendor's own permanent-style element
 * id ("teeth-11".."teeth-45") for the same quadrant position. Used to
 * build `defaultSelected` when rendering the primary odontogram.
 */
export function primaryToothToVendorId(primaryTooth: number): string {
  const quadrant = Math.floor(primaryTooth / 10) - 4;
  const position = primaryTooth % 10;
  return `teeth-${quadrant}${position}`;
}

/**
 * The vendor's reported FDI-shaped number (from ToothDetail.notations.fdi,
 * always in the 11-45 range while `maxTeeth` is capped at 5) -> the
 * primary FDI number (51-85) it actually represents. The inverse of
 * primaryToothToVendorId.
 */
export function vendorFdiToPrimaryTooth(vendorFdi: number): number {
  const quadrant = Math.floor(vendorFdi / 10) + 4;
  const position = vendorFdi % 10;
  return quadrant * 10 + position;
}
