/**
 * Rounds to 2 decimal places via integer cents, avoiding the float drift
 * that plain `Math.round(x * 100) / 100` can produce for values like
 * 1.005. Used anywhere tax/discount math derives a new money amount rather
 * than reading one straight from the database.
 */
export function roundMoney(amount: number): number {
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}
