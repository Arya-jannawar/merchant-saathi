/**
 * All monetary amounts in Merchant Saathi are integers in paise (1 INR = 100 paise).
 * Floating point never touches stored money. Formatting happens only at the UI edge.
 */

export function formatINR(paise: number, opts?: { decimals?: boolean }): string {
  if (!Number.isInteger(paise)) {
    throw new TypeError(`formatINR expects integer paise, received ${paise}`);
  }
  const decimals = opts?.decimals ?? false;
  const value = paise / 100;
  const formatted = new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: decimals ? 2 : 0,
    maximumFractionDigits: decimals ? 2 : 0,
  }).format(value);
  return `\u20B9${formatted}`;
}

export function formatINRPlain(paise: number): string {
  return formatINR(paise).replace("\u20B9", "\u20B9 ");
}

/** Format a margin ratio (0.4286) as "42.9%". */
export function formatPct(ratio: number, digits = 1): string {
  return `${(ratio * 100).toFixed(digits)}%`;
}

/**
 * Parse a user-entered rupee amount ("70", "70.5") into integer paise.
 * Returns null when the input is not a valid non-negative amount.
 */
export function parseRupeesToPaise(input: string | number): number | null {
  const raw = String(input).trim().replace(/[,\u20B9\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) return null;
  const paise = Math.round(parseFloat(raw) * 100);
  return Number.isFinite(paise) && paise >= 0 ? paise : null;
}

export function assertIntegerPaise(paise: number, label: string): void {
  if (!Number.isInteger(paise) || paise < 0) {
    throw new TypeError(`${label} must be a non-negative integer number of paise, got ${paise}`);
  }
}
