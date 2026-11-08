export function formatINR(paise: number, decimals = false): string {
  const value = paise / 100;
  const formatted = new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: decimals ? 2 : 0,
    maximumFractionDigits: decimals ? 2 : 0,
  }).format(value);
  return `\u20B9${formatted}`;
}

export function formatPct(pct: number | null, digits = 1): string {
  if (pct === null) return "unavailable";
  return `${pct.toFixed(digits)}%`;
}

export function formatDelta(pct: number | null): string {
  if (pct === null) return "n/a";
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Kolkata",
  });
}
