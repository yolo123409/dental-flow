export function tangentAngle(
  path: any,
  distance: number
) {
  const before = path.getPointAtLength(
    Math.max(0, distance - 1)
  );

  const after = path.getPointAtLength(
    Math.min(
      path.getTotalLength(),
      distance + 1
    )
  );

  const angle =
    Math.atan2(
      after.y - before.y,
      after.x - before.x
    ) *
    180 /
    Math.PI;

  return angle;
}