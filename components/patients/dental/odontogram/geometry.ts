export interface Point {
  x: number;
  y: number;
}

export function pointOnEllipse(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  angle: number
): Point {
  const radians = (angle * Math.PI) / 180;

  return {
    x: cx + rx * Math.cos(radians),
    y: cy + ry * Math.sin(radians),
  };
}