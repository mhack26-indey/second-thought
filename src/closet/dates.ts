// Calendar dates (order dates, return deadlines) as "YYYY-MM-DD" strings.
// Postgres `date` columns are read with to_char, so a deadline never shifts a
// day when a Date at UTC midnight is shown in a US time zone.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Today in server local time. */
export function today(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** A real calendar date in YYYY-MM-DD form ("2026-02-30" isn't). */
export function isDate(s: string | null | undefined): s is string {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  return new Date(`${s}T00:00:00Z`).toISOString().startsWith(s);
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** "Nov 2" */
export function formatDay(date: string): string {
  const [, month, day] = date.split("-").map(Number);
  return `${MONTHS[month! - 1]} ${day}`;
}
