/** Local-time date helpers. Everything crossing the DB boundary is a plain
 *  `YYYY-MM-DD` / `YYYY-MM` string, so nothing here ever touches UTC. */

export const DAY_MS = 86_400_000;

export function ymd(d: Date): string {
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export function ym(d: Date): string {
  return `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, "0")}`;
}

export function fromYmd(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

export function addMonths(d: Date, n: number): Date {
  const out = new Date(d.getFullYear(), d.getMonth() + n, 1);
  return out;
}

/** Monday-based week start. */
export function startOfWeek(d: Date): Date {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const shift = (out.getDay() + 6) % 7;
  return addDays(out, -shift);
}

export function isWeekend(d: Date): boolean {
  const day = d.getDay();
  return day === 0 || day === 6;
}

export function today(): Date {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate());
}

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DOW_FULL = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const MON = ["January", "February", "March", "April", "May", "June",
             "July", "August", "September", "October", "November", "December"];

export function dowLabel(d: Date): string {
  return DOW[(d.getDay() + 6) % 7];
}

export function shortDate(d: Date): string {
  return `${d.getDate()} ${MON[d.getMonth()].slice(0, 3)}`;
}

/** "Sep 2026" — for the narrow monthly panel header. */
export function monthShort(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number);
  return `${MON[m - 1].slice(0, 3)} ${y}`;
}

export function monthLabel(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number);
  return `${MON[m - 1]} ${y}`;
}

/** "1 – 7 Sep 2026", collapsing the month and year when they don't change. */
export function weekLabel(monday: Date): string {
  const sunday = addDays(monday, 6);
  const sameMonth = monday.getMonth() === sunday.getMonth();
  const sameYear = monday.getFullYear() === sunday.getFullYear();
  const left = sameMonth
    ? `${monday.getDate()}`
    : `${monday.getDate()} ${MON[monday.getMonth()].slice(0, 3)}${sameYear ? "" : ` ${monday.getFullYear()}`}`;
  return `${left} – ${sunday.getDate()} ${MON[sunday.getMonth()].slice(0, 3)} ${sunday.getFullYear()}`;
}

/** Human "3 days ago" / "in 2 weeks", used on backlog and search cards. */
export function relative(dateStr: string, base = today()): string {
  const diff = Math.round((fromYmd(dateStr).getTime() - base.getTime()) / DAY_MS);
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  if (diff === -1) return "yesterday";
  const n = Math.abs(diff);
  const unit = n < 14 ? [n, "day"] : n < 60 ? [Math.round(n / 7), "week"] : [Math.round(n / 30), "month"];
  const plural = (unit[0] as number) === 1 ? "" : "s";
  return diff < 0 ? `${unit[0]} ${unit[1]}${plural} ago` : `in ${unit[0]} ${unit[1]}${plural}`;
}

/** "Thursday 4 September" — the history sheet's day headings. */
export function longDate(d: Date): string {
  return `${DOW_FULL[(d.getDay() + 6) % 7]} ${d.getDate()} ${MON[d.getMonth()]}`;
}

/** Local calendar day of a stored RFC3339 completion stamp. */
export function localDateOfIso(iso: string): string {
  return ymd(new Date(iso));
}

/** Re-stamp a completion onto a different calendar day, keeping the clock time
 *  so ordering within a day stays stable. */
export function isoOnLocalDate(dateStr: string, from = new Date()): string {
  const d = fromYmd(dateStr);
  d.setHours(from.getHours(), from.getMinutes(), from.getSeconds(), 0);
  return d.toISOString();
}
