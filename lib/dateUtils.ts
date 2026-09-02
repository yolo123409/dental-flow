/**
 * Full-app audit fix C4 (Critical): converts a Date to a YYYY-MM-DD
 * string using the Date's own LOCAL calendar date - never round-tripping
 * through UTC first.
 *
 * `date.toISOString().slice(0, 10)` is the wrong tool for this:
 * toISOString() always normalizes to UTC before formatting, so a Date
 * representing local midnight (e.g. `new Date(2026, 7, 1)` - Aug 1 at
 * 00:00 in whatever timezone this code is running in) shifts to the
 * PREVIOUS calendar day the instant the local timezone is ahead of UTC -
 * which Africa/Nairobi (UTC+3, this app's own documented default) always
 * is, for roughly 21 hours of every single day. Every "This Month/
 * Quarter/Year" report boundary, and every plain "today" check, must
 * derive its date string this way instead - confirmed live: for a
 * UTC+3 clinic, the old pattern makes a transaction dated on the last
 * day of a month satisfy BOTH "this month" and "last month" at once.
 */
export function localDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
