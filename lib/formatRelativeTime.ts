const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 60 * 60 * 24 * 365],
  ["month", 60 * 60 * 24 * 30],
  ["week", 60 * 60 * 24 * 7],
  ["day", 60 * 60 * 24],
  ["hour", 60 * 60],
  ["minute", 60],
];

const formatter = new Intl.RelativeTimeFormat(undefined, {
  numeric: "auto",
});

export function formatRelativeTime(isoDate: string): string {
  const seconds = Math.round(
    (new Date(isoDate).getTime() - Date.now()) / 1000
  );

  if (Math.abs(seconds) < 60) {
    return "just now";
  }

  for (const [unit, secondsInUnit] of UNITS) {
    if (Math.abs(seconds) >= secondsInUnit) {
      return formatter.format(
        Math.round(seconds / secondsInUnit),
        unit
      );
    }
  }

  return formatter.format(Math.round(seconds / 60), "minute");
}
