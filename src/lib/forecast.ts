/**
 * Next-day net-sales forecast: weekly seasonal naive baseline vs a small ridge
 * regression, evaluated by walk-forward backtest. Pure and deterministic - no
 * ML dependency, no randomness; the ridge strength is fixed ahead of any
 * evaluation window (spec: choose strength before the test window).
 *
 * Definitions used on screen:
 *   MAE  = mean absolute error in rupees.
 *   WAPE = MAE / mean(|actual|) - matches the acceptance numbers in the plan;
 *          guarded against an all-zero actual window ("n/a").
 * Gate: at least 42 consecutive local days (28 to build lags, then 14
 * walk-forward holdouts). Fewer usable rows -> an honest "insufficient
 * history" state instead of a forecast.
 */

export interface DailySales {
  date: string; // local YYYY-MM-DD
  netPaise: number;
}

export interface ForecastCandidate {
  model: "ridge" | "seasonal-naive";
  maeRupees: number;
  wapePct: number | null;
  predictions: { date: string; predictedRupees: number; actualRupees: number }[];
}

export interface TomorrowForecast {
  usable: boolean;
  reason: string | null;
  tomorrowDate: string;
  selectedModel: "ridge" | "seasonal-naive" | null;
  predictedRupees: number | null;
  baseline: ForecastCandidate | null;
  ridge: ForecastCandidate | null;
  trainingDays: number;
  lastTrainingDate: string | null;
  coverageDays: number;
  explanation: string[];
}

const GATE_DAYS = 42;
const HOLDOUT_DAYS = 14;
const RIDGE_LAMBDA = 1.0;

/** Consecutive-day check on local dates; returns the usable run ending at the last date. */
function longestConsecutiveRun(dates: string[]): { run: string[]; coverageDays: number } {
  const sorted = Array.from(new Set(dates)).sort();
  let best: string[] = [];
  let cur: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    if (i === 0) {
      cur = [sorted[i]];
      continue;
    }
    const prev = new Date(sorted[i - 1] + "T00:00:00Z").getTime();
    const day = new Date(sorted[i] + "T00:00:00Z").getTime();
    if (day - prev === 86_400_000) cur.push(sorted[i]);
    else cur = [sorted[i]];
    if (cur.length > best.length) best = [...cur];
  }
  return { run: best, coverageDays: best.length };
}

function weekdayIndex(date: string): number {
  return new Date(date + "T00:00:00Z").getUTCDay(); // 0=Sun
}

function addDays(date: string, delta: number): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/** One-hot weekday (6 of 7, Monday-referenced), linear trend, lag1, lag7, MA7. */
function featureRow(date: string, salesByDate: Map<string, number>, originIndex: number): number[] | null {
  const dow = weekdayIndex(date);
  const oneHot = [dow === 1 ? 0 : 1, dow === 2 ? 1 : 0, dow === 3 ? 1 : 0, dow === 4 ? 1 : 0, dow === 5 ? 1 : 0, dow === 6 ? 1 : 0, dow === 0 ? 1 : 0];
  const lag1 = salesByDate.get(addDays(date, -1));
  const lag7 = salesByDate.get(addDays(date, -7));
  let ma7Sum = 0;
  for (let i = 1; i <= 7; i++) {
    const v = salesByDate.get(addDays(date, -i));
    if (v === undefined) return null;
    ma7Sum += v;
  }
  if (lag1 === undefined || lag7 === undefined) return null;
  return [1, ...oneHot, originIndex, lag1, lag7, ma7Sum / 7];
}

/** Solve (XᵀX + λI) w = Xᵀy with Gaussian elimination; intercept unregularized. */
function ridgeSolve(X: number[][], y: number[], lambda: number): number[] | null {
  const cols = X[0].length;
  const A: number[][] = Array.from({ length: cols }, () => new Array(cols).fill(0));
  const b: number[] = new Array(cols).fill(0);
  for (let r = 0; r < X.length; r++) {
    for (let i = 0; i < cols; i++) {
      b[i] += X[r][i] * y[r];
      for (let j = 0; j < cols; j++) A[i][j] += X[r][i] * X[r][j];
    }
  }
  for (let i = 1; i < cols; i++) A[i][i] += lambda; // intercept unregularized
  // Gaussian elimination with partial pivoting.
  for (let col = 0; col < cols; col++) {
    let piv = col;
    for (let r = col + 1; r < cols; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
    if (Math.abs(A[piv][col]) < 1e-9) return null;
    [A[col], A[piv]] = [A[piv], A[col]];
    [b[col], b[piv]] = [b[piv], b[col]];
    for (let r = col + 1; r < cols; r++) {
      const f = A[r][col] / A[col][col];
      if (f === 0) continue;
      for (let j = col; j < cols; j++) A[r][j] -= f * A[col][j];
      b[r] -= f * b[col];
    }
  }
  const w = new Array(cols).fill(0);
  for (let r = cols - 1; r >= 0; r--) {
    let s = b[r];
    for (let j = r + 1; j < cols; j++) s -= A[r][j] * w[j];
    w[r] = s / A[r][r];
  }
  return w;
}

function metrics(predictions: ForecastCandidate["predictions"]): { maeRupees: number; wapePct: number | null } {
  return backtestMetrics(predictions);
}

/**
 * MAE in rupees + WAPE = MAE / mean(|actual|). Exported so the plan's
 * acceptance numbers can be verified directly on given predictions.
 */
export function backtestMetrics(predictions: ForecastCandidate["predictions"]): { maeRupees: number; wapePct: number | null } {
  if (predictions.length === 0) return { maeRupees: 0, wapePct: null };
  const totalAbs = predictions.reduce((s, p) => s + Math.abs(p.actualRupees), 0);
  const mae = predictions.reduce((s, p) => s + Math.abs(p.predictedRupees - p.actualRupees), 0) / predictions.length;
  const meanActual = totalAbs / predictions.length;
  const wape = meanActual > 0 ? (mae / meanActual) * 100 : null;
  return { maeRupees: Math.round(mae * 100) / 100, wapePct: wape === null ? null : Math.round(wape * 100) / 100 };
}

export function forecastTomorrow(days: DailySales[], todayLocal: string): TomorrowForecast {
  const byDate = new Map(days.map((d) => [d.date, d.netPaise]));
  const sortedDates = days.map((d) => d.date).sort();
  const { run, coverageDays } = longestConsecutiveRun(sortedDates);
  const reason = (r: string, target = addDays(run.at(-1) ?? todayLocal, 1)): TomorrowForecast => ({
    usable: false, reason: r, tomorrowDate: target, selectedModel: null, predictedRupees: null,
    baseline: null, ridge: null, trainingDays: run.length, lastTrainingDate: run.at(-1) ?? null, coverageDays,
    explanation: [],
  });

  if (coverageDays < GATE_DAYS) {
    return reason(
      `Needs at least ${GATE_DAYS} consecutive trading days with recorded sales (found ${coverageDays} in the longest unbroken run). Import or record more history for a forecast.`,
    );
  }

  // Target day: tomorrow when today has sales; otherwise the next expected
  // trading day after the last recorded one (a statement exported Oct 31 and
  // imported Nov 6 leaves Nov 1-5 unknown - never filled as zeros).
  const hasToday = run.includes(todayLocal);
  const tomorrowDate = hasToday ? addDays(todayLocal, 1) : addDays(run.at(-1)!, 1);
  const gapNote = hasToday
    ? null
    : `History runs through ${run.at(-1)} — the forecast covers the next expected trading day (${tomorrowDate}), based on recorded days only.`;

  // Walk-forward holdout: the last HOLDOUT_DAYS days of the run. At every
  // origin, both models fit only on earlier observations.
  const holdout = run.slice(-HOLDOUT_DAYS);
  const trainRun = run.slice(0, run.length - HOLDOUT_DAYS);
  if (trainRun.length < GATE_DAYS - HOLDOUT_DAYS) {
    return reason("Not enough training rows before the holdout window to fit either model.");
  }

  const salesPaise = run.map((d) => byDate.get(d) ?? 0);
  const salesRupees = salesPaise.map((p) => p / 100);
  const salesByDateRupees = new Map(run.map((d, i) => [d, salesRupees[i]]));

  // Seasonal naive: same weekday one week earlier.
  const naivePredictions = holdout.map((date) => {
    const base = salesByDateRupees.get(addDays(date, -7));
    return { date, predictedRupees: Math.round((base ?? 0) * 100) / 100, actualRupees: Math.round((salesByDateRupees.get(date) ?? 0) * 100) / 100 };
  });
  const baseline: ForecastCandidate = { model: "seasonal-naive", ...metrics(naivePredictions), predictions: naivePredictions };

  // Ridge: walk-forward refit at every origin (preprocessing included).
  const ridgePredictions: ForecastCandidate["predictions"] = [];
  for (const date of holdout) {
    const originIndex = run.indexOf(date);
    const X: number[][] = [];
    const y: number[] = [];
    for (let i = 0; i < originIndex; i++) {
      const d = run[i];
      const feats = featureRow(d, salesByDateRupees, i);
      if (feats) {
        X.push(feats);
        y.push(salesRupees[i]);
      }
    }
    if (X.length < 21) {
      return reason("Not enough usable rows after lagging to fit the ridge model.");
    }
    const w = ridgeSolve(X, y, RIDGE_LAMBDA);
    if (!w) return reason("The ridge fit was numerically unstable on this history.");
    const feats = featureRow(date, salesByDateRupees, originIndex);
    if (!feats) return reason("A lag needed for tomorrow's ridge features is missing from the history.");
    const pred = feats.reduce((s, f, j) => s + f * w[j], 0);
    ridgePredictions.push({
      date,
      predictedRupees: Math.round(Math.max(pred, 0) * 100) / 100,
      actualRupees: Math.round((salesByDateRupees.get(date) ?? 0) * 100) / 100,
    });
  }
  const ridge: ForecastCandidate = { model: "ridge", ...metrics(ridgePredictions), predictions: ridgePredictions };

  // Selection: the simpler seasonal baseline wins ties or losses.
  const selectedModel = ridge.maeRupees < baseline.maeRupees ? "ridge" : "seasonal-naive";

  // Tomorrow's prediction refits the selected model on the FULL run.
  let predictedRupees: number;
  if (selectedModel === "seasonal-naive") {
    predictedRupees = Math.round((salesByDateRupees.get(addDays(tomorrowDate, -7)) ?? 0) * 100) / 100;
  } else {
    const X: number[][] = [];
    const y: number[] = [];
    run.forEach((d, i) => {
      const feats = featureRow(d, salesByDateRupees, i);
      if (feats) {
        X.push(feats);
        y.push(salesRupees[i]);
      }
    });
    const w = ridgeSolve(X, y, RIDGE_LAMBDA);
    if (!w) return reason("The ridge fit was numerically unstable on this history.");
    const tomorrowIndex = run.length;
    const feats = featureRow(tomorrowDate, salesByDateRupees, tomorrowIndex);
    if (!feats) return reason("A lag needed for tomorrow's ridge features is missing from the history.");
    predictedRupees = Math.round(Math.max(feats.reduce((s, f, j) => s + f * w[j], 0), 0) * 100) / 100;
  }

  const winner = selectedModel === "ridge" ? ridge : baseline;
  const explanation = [
    selectedModel === "seasonal-naive"
      ? "The simple baseline (same weekday, one week earlier) matched or beat the regression on the 14-day selection backtest, so the simpler model ships."
      : `The ridge model beat the same-weekday baseline on the 14-day selection backtest (MAE ₹${ridge.maeRupees} vs ₹${baseline.maeRupees}).`,
    "Every figure comes from your recorded or imported history only - this is an estimate, not observed sales.",
    ...(gapNote ? [gapNote] : []),
  ];

  return {
    usable: true,
    reason: null,
    tomorrowDate,
    selectedModel,
    predictedRupees,
    baseline,
    ridge,
    trainingDays: trainRun.length,
    lastTrainingDate: run.at(-1) ?? null,
    coverageDays,
    explanation,
  };
}
