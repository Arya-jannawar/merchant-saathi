"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Hand-rolled SVG/CSS charts. No charting dependency: every value rendered
 * here comes straight from a server-computed DTO (the data-honesty rule),
 * and all motion is CSS transitions/keyframes.
 */

const EASE = "cubic-bezier(0.22, 1, 0.36, 1)";

/** Animate a number from 0 (or previous) to `value` with an ease-out curve. */
export function CountUp({
  value,
  format,
  durationMs = 900,
  className = "",
}: {
  value: number;
  format: (v: number) => string;
  durationMs?: number;
  className?: string;
}) {
  const [display, setDisplay] = useState(0);
  const fromRef = useRef(0);
  useEffect(() => {
    const from = fromRef.current;
    const start = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min((t - start) / durationMs, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(from + (value - from) * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
      else fromRef.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, durationMs]);
  return <span className={className}>{format(display)}</span>;
}

export interface BarSpec {
  value: number;
  label: string;
  valueLabel: string;
  color: string;
}

export interface BarGroup {
  label: string;
  bars: BarSpec[];
}

/** Vertical grouped bars with a grow-in animation and value labels. */
export function GroupedBars({
  groups,
  height = 180,
  ariaLabel,
}: {
  groups: BarGroup[];
  height?: number;
  ariaLabel: string;
}) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShown(true), 60);
    return () => clearTimeout(t);
  }, []);
  const max = Math.max(...groups.flatMap((g) => g.bars.map((b) => b.value)), 1);
  return (
    <div role="img" aria-label={ariaLabel}>
      <div className="flex items-end justify-around gap-6" style={{ height }}>
        {groups.map((g, gi) => (
          <div key={g.label} className="flex h-full flex-1 flex-col justify-end">
            <div className="flex h-full items-end justify-center gap-3">
              {g.bars.map((b, bi) => (
                <div key={b.label} className="flex h-full w-12 max-w-16 flex-col items-center justify-end sm:w-16">
                  <span
                    className="mb-1 text-xs font-bold text-navy transition-opacity duration-500"
                    style={{ opacity: shown ? 1 : 0, transitionDelay: `${400 + bi * 120}ms` }}
                  >
                    {b.valueLabel}
                  </span>
                  <div
                    className="w-full rounded-t-xl"
                    style={{
                      height: shown ? `${Math.max((b.value / max) * 100, 3)}%` : "2%",
                      background: b.color,
                      transition: `height 800ms ${EASE} ${gi * 120 + bi * 80}ms`,
                    }}
                  />
                  <span className="mt-1.5 h-4 text-[11px] font-semibold text-slate-500">{bi === 0 ? g.label : ""}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Horizontal meter with an optional threshold marker. */
export function Meter({
  value,
  max,
  tone = "brand",
  markerPct = null,
  markerLabel = null,
  label,
  valueLabel,
  ariaLabel,
}: {
  value: number;
  max: number;
  tone?: "brand" | "good" | "bad" | "warn";
  markerPct?: number | null;
  markerLabel?: string | null;
  label: string;
  valueLabel: string;
  ariaLabel: string;
}) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShown(true), 80);
    return () => clearTimeout(t);
  }, []);
  const pct = Math.max(Math.min((value / Math.max(max, 1)) * 100, 100), 0);
  const tones: Record<string, string> = {
    brand: "bg-accent",
    good: "bg-emerald-500",
    bad: "bg-rose-500",
    warn: "bg-amber-500",
  };
  return (
    <div role="img" aria-label={ariaLabel}>
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-semibold text-navy">{label}</span>
        <span className="font-bold text-navy">{valueLabel}</span>
      </div>
      <div className="relative mt-1.5 h-4 overflow-hidden rounded-full bg-slate-100">
        <div
          className={`h-full rounded-full ${tones[tone]}`}
          style={{ width: shown ? `${pct}%` : "0%", transition: `width 900ms ${EASE}` }}
        />
        {markerPct !== null ? (
          <div
            className="absolute inset-y-0 w-0.5 bg-navy/70"
            style={{ left: `${Math.min(markerPct, 100)}%` }}
            title={markerLabel ?? undefined}
          />
        ) : null}
      </div>
      {markerLabel ? <p className="mt-1 text-[11px] text-slate-400">{markerLabel}</p> : null}
    </div>
  );
}

export interface DonutSegment {
  value: number;
  label: string;
  color: string;
}

/** Donut chart with animated arcs and a center label. */
export function DonutChart({
  segments,
  centerValue,
  centerLabel,
  size = 150,
  ariaLabel,
}: {
  segments: DonutSegment[];
  centerValue: string;
  centerLabel: string;
  size?: number;
  ariaLabel: string;
}) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShown(true), 80);
    return () => clearTimeout(t);
  }, []);
  const total = Math.max(segments.reduce((s, seg) => s + seg.value, 0), 1);
  const stroke = 20;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div role="img" aria-label={ariaLabel} className="flex items-center gap-5">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0 -rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#f1f5f9" strokeWidth={stroke} />
        {segments.map((seg) => {
          const frac = seg.value / total;
          const dash = frac * c;
          const el = (
            <circle
              key={seg.label}
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={seg.color}
              strokeWidth={stroke}
              strokeLinecap="butt"
              strokeDasharray={`${shown ? dash : 0} ${c - (shown ? dash : 0)}`}
              strokeDashoffset={-offset}
              style={{ transition: `stroke-dasharray 900ms ${EASE}` }}
            />
          );
          offset += dash;
          return el;
        })}
      </svg>
      <div className="min-w-0">
        <p className="text-2xl font-extrabold text-navy">{centerValue}</p>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{centerLabel}</p>
        <ul className="mt-2 space-y-1">
          {segments.map((seg) => (
            <li key={seg.label} className="flex items-center gap-2 text-sm text-slate-600">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: seg.color }} />
              {seg.label}
              <span className="font-semibold text-navy">{seg.value}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export interface WaterfallStep {
  label: string;
  /** Absolute rupee position where this step's bar starts. */
  fromRupees: number;
  /** Absolute rupee position where it ends. */
  toRupees: number;
  valueLabel: string;
  tone: "brand" | "bad" | "good";
}

/**
 * Horizontal waterfall for the money story (e.g. ₹700 revenue, −₹400 cost,
 * = ₹300 contribution). Bars animate from the left edge to their positions.
 */
export function WaterfallChart({ steps, ariaLabel }: { steps: WaterfallStep[]; ariaLabel: string }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShown(true), 80);
    return () => clearTimeout(t);
  }, []);
  const maxEnd = Math.max(...steps.map((s) => Math.max(s.fromRupees, s.toRupees)), 1);
  const tones: Record<string, string> = {
    brand: "bg-accent",
    bad: "bg-rose-500",
    good: "bg-emerald-500",
  };
  return (
    <div role="img" aria-label={ariaLabel} className="space-y-4">
      {steps.map((s, i) => {
        const leftPct = (Math.min(s.fromRupees, s.toRupees) / maxEnd) * 100;
        const widthPct = (Math.abs(s.toRupees - s.fromRupees) / maxEnd) * 100;
        return (
          <div key={s.label}>
            <div className="flex items-baseline justify-between text-sm">
              <span className="font-semibold text-navy">{s.label}</span>
              <span className={`font-bold ${s.tone === "bad" ? "text-rose-600" : s.tone === "good" ? "text-emerald-600" : "text-navy"}`}>
                {s.valueLabel}
              </span>
            </div>
            <div className="mt-1.5 h-7 rounded-lg bg-slate-100">
              <div
                className={`relative h-full rounded-lg ${tones[s.tone]}`}
                style={{
                  marginLeft: shown ? `${leftPct}%` : "0%",
                  width: shown ? `${Math.max(widthPct, 1.5)}%` : "0%",
                  transition: `margin-left 800ms ${EASE} ${i * 140}ms, width 800ms ${EASE} ${i * 140}ms`,
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Tiny line (used for the flat-AOV story). */
export function MiniLine({
  points,
  color = "#00b9f1",
  width = 220,
  height = 64,
  ariaLabel,
  valueLabels,
}: {
  points: number[];
  color?: string;
  width?: number;
  height?: number;
  ariaLabel: string;
  valueLabels?: string[];
}) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShown(true), 80);
    return () => clearTimeout(t);
  }, []);
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = Math.max(max - min, 1);
  const pad = 10;
  const xs = points.map((_, i) => pad + (i / Math.max(points.length - 1, 1)) * (width - pad * 2));
  const ys = points.map((p) => height - pad - ((p - min) / span) * (height - pad * 2));
  const path = xs.map((x, i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${ys[i].toFixed(1)}`).join(" ");
  return (
    <div role="img" aria-label={ariaLabel} className="inline-block">
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        <path
          d={path}
          fill="none"
          stroke={color}
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray="600"
          strokeDashoffset={shown ? 0 : 600}
          style={{ transition: `stroke-dashoffset 1100ms ${EASE}` }}
        />
        {xs.map((x, i) => (
          <g key={i} style={{ opacity: shown ? 1 : 0, transition: `opacity 400ms ${500 + i * 150}ms` }}>
            <circle cx={x} cy={ys[i]} r="4.5" fill="#fff" stroke={color} strokeWidth="2.5" />
            {valueLabels?.[i] ? (
              <text x={x} y={ys[i] - 10} textAnchor="middle" fontSize="11" fontWeight="700" fill="#0a2e5c">
                {valueLabels[i]}
              </text>
            ) : null}
          </g>
        ))}
      </svg>
    </div>
  );
}
