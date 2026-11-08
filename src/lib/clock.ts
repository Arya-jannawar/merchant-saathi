/**
 * Injected clock + Asia/Kolkata helpers.
 *
 * IST (UTC+05:30) has no daylight saving, so conversions are fixed offsets.
 * All timestamps are stored in UTC (ISO 8601); trading-period bucketing happens
 * in IST so a 3-6 p.m. afternoon order is always 15:00-17:59 local.
 */

export const IST_OFFSET_MINUTES = 330;

export const FIXTURE_NOW_ISO = "2026-11-06T19:00:00+05:30";

/** Returns the demo "now". DEMO_NOW overrides; DEMO_MODE=true pins to fixture time. */
export function getNow(): Date {
  const override = process.env.DEMO_NOW;
  if (override && override.trim()) {
    const d = new Date(override.trim());
    if (!Number.isNaN(d.getTime())) return d;
  }
  if (process.env.DEMO_MODE !== "false") {
    return new Date(FIXTURE_NOW_ISO);
  }
  return new Date();
}

export function isClockInjected(): boolean {
  return Boolean(process.env.DEMO_NOW?.trim()) || process.env.DEMO_MODE !== "false";
}

/** Date parts as seen on an Asia/Kolkata wall clock. */
export function istParts(d: Date): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number; // 0=Sun .. 6=Sat
} {
  const shifted = new Date(d.getTime() + IST_OFFSET_MINUTES * 60_000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    weekday: shifted.getUTCDay(),
  };
}

/** Build a UTC ISO timestamp from Asia/Kolkata wall-clock parts. */
export function istToUtcIso(year: number, month: number, day: number, hour = 0, minute = 0): string {
  const utcMs = Date.UTC(year, month - 1, day, hour, minute) - IST_OFFSET_MINUTES * 60_000;
  return new Date(utcMs).toISOString();
}

/** Monday 00:00 IST of the week containing the given instant (IST view). */
export function istWeekStartMonday(d: Date): Date {
  const p = istParts(d);
  const mondayIstMs = Date.UTC(p.year, p.month - 1, p.day - p.weekday) + IST_OFFSET_MINUTES * 60_000;
  return new Date(mondayIstMs);
}

export interface AfternoonWindow {
  /** Monday 15:00 IST (inclusive), ISO UTC */
  startIso: string;
  /** Friday 18:00 IST (exclusive), ISO UTC */
  endIso: string;
  /** Human label, e.g. "26-30 Oct 2026" */
  label: string;
  /** ISO date (IST) of the window's Monday */
  mondayIsoDate: string;
}

/**
 * The most recent COMPLETE Mon-Fri 3-6 p.m. window as of `now`:
 * a window is complete once its Friday 18:00 IST has passed.
 */
export function lastCompleteAfternoonWindow(now: Date): AfternoonWindow {
  const p = istParts(now);
  // Days back to the most recent Friday (weekday 5) whose 18:00 IST has passed.
  let backFromFriday: number;
  if (p.weekday === 5) {
    // Friday: the current week completes only at/after 18:00 IST.
    backFromFriday = p.hour >= 18 ? 0 : 7;
  } else {
    backFromFriday = p.weekday - 5;
    if (backFromFriday < 0) backFromFriday += 7;
  }
  const fridayIstMidnight = Date.UTC(p.year, p.month - 1, p.day - backFromFriday);
  const mondayIstMidnight = fridayIstMidnight - 4 * 24 * 3600_000;
  const startIso = new Date(mondayIstMidnight + 15 * 3600_000 - IST_OFFSET_MINUTES * 60_000).toISOString();
  const endIso = new Date(fridayIstMidnight + 18 * 3600_000 - IST_OFFSET_MINUTES * 60_000).toISOString();

  const mon = new Date(mondayIstMidnight + IST_OFFSET_MINUTES * 60_000);
  const fri = new Date(fridayIstMidnight + IST_OFFSET_MINUTES * 60_000);
  const fmt = (d: Date) => {
    const dd = d.getUTCDate();
    const m = d.getUTCMonth() + 1;
    return { dd, m };
  };
  const a = fmt(mon);
  const b = fmt(fri);
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const label = `${a.dd}-${b.dd} ${monthNames[b.m - 1]} ${fri.getUTCFullYear()}`;
  const mondayIsoDate = `${mon.getUTCFullYear()}-${String(mon.getUTCMonth() + 1).padStart(2, "0")}-${String(
    mon.getUTCDate()
  ).padStart(2, "0")}`;
  return { startIso, endIso, label, mondayIsoDate };
}

/** The complete window immediately before the given one. */
export function previousAfternoonWindow(w: AfternoonWindow): AfternoonWindow {
  const WEEK_MS = 7 * 24 * 3600_000;
  const start = new Date(new Date(w.startIso).getTime() - WEEK_MS);
  const end = new Date(new Date(w.endIso).getTime() - WEEK_MS);
  const mondayIst = new Date(new Date(`${w.mondayIsoDate}T00:00:00Z`).getTime() - WEEK_MS);
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const a = { dd: mondayIst.getUTCDate(), m: mondayIst.getUTCMonth() + 1 };
  const fridayIst = new Date(mondayIst.getTime() + 4 * 24 * 3600_000);
  const b = { dd: fridayIst.getUTCDate(), m: fridayIst.getUTCMonth() + 1 };
  return {
    startIso: start.toISOString(),
    endIso: end.toISOString(),
    label: `${a.dd}-${b.dd} ${monthNames[b.m - 1]} ${fridayIst.getUTCFullYear()}`,
    mondayIsoDate: `${mondayIst.getUTCFullYear()}-${String(mondayIst.getUTCMonth() + 1).padStart(2, "0")}-${String(
      mondayIst.getUTCDate()
    ).padStart(2, "0")}`,
  };
}

/** Is this instant inside the 15:00-18:00 IST afternoon band on a Mon-Fri? */
export function isAfternoonIst(d: Date): boolean {
  const p = istParts(d);
  return p.weekday >= 1 && p.weekday <= 5 && p.hour >= 15 && p.hour < 18;
}
