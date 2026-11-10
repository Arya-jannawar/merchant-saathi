import type { HTMLAttributes, ReactNode } from "react";

export function Card({ children, className = "", ...rest }: { children: ReactNode; className?: string } & HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`rounded-2xl border border-slate-200 bg-white shadow-card ${className}`} {...rest}>
      {children}
    </div>
  );
}

const badgeTones: Record<string, string> = {
  navy: "bg-navy text-white",
  blue: "bg-brand-light text-brand",
  cyan: "bg-accent-soft text-sky-700",
  green: "bg-emerald-50 text-emerald-700 border border-emerald-200",
  red: "bg-rose-50 text-rose-700 border border-rose-200",
  amber: "bg-amber-50 text-amber-800 border border-amber-200",
  gray: "bg-slate-100 text-slate-600",
};

export function Badge({ tone = "blue", children }: { tone?: keyof typeof badgeTones | string; children: ReactNode }) {
  const cls = badgeTones[tone] ?? badgeTones.blue;
  return <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${cls}`}>{children}</span>;
}

export function SectionTitle({ kicker, title }: { kicker?: string; title: string }) {
  return (
    <div className="mb-4">
      {kicker ? <p className="text-xs font-bold uppercase tracking-widest text-slate-500">{kicker}</p> : null}
      <h2 className="text-xl font-bold text-navy">{title}</h2>
    </div>
  );
}

export function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2">
      <span className="text-sm text-slate-600">{label}</span>
      <span className="text-sm font-semibold text-navy">{children}</span>
    </div>
  );
}

export function Alert({ tone, title, children }: { tone: "error" | "warn" | "info"; title: string; children?: ReactNode }) {
  const tones = {
    error: "border-rose-200 bg-rose-50 text-rose-800",
    warn: "border-amber-200 bg-amber-50 text-amber-900",
    info: "border-sky-200 bg-accent-soft text-sky-900",
  };
  return (
    <div className={`rounded-xl border px-4 py-3 text-sm ${tones[tone]}`} role="alert">
      <p className="font-semibold">{title}</p>
      {children ? <div className="mt-1">{children}</div> : null}
    </div>
  );
}
