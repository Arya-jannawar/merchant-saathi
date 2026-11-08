"use client";

import type { OpportunityItemDto } from "@/components/types";
import { formatDelta, formatINR } from "@/lib/format";

/** Comparison chart derived from order records - never hand-drawn values. */
export default function OpportunityCard({ item }: { item: OpportunityItemDto }) {
  const max = Math.max(item.windows.previous.orders, item.windows.current.orders, 1);
  const deltaPct =
    item.windows.previous.orders === 0
      ? null
      : Math.round(((item.windows.current.orders - item.windows.previous.orders) / item.windows.previous.orders) * 1000) / 10;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-slate-500">Top opportunity</p>
          <h3 className="mt-1 text-lg font-bold text-navy">
            Afternoon orders down {formatDelta(deltaPct)} ({item.windows.previous.label} &rarr; {item.windows.current.label})
          </h3>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-600">{item.observation}</p>
        </div>
        <div className="flex gap-2">
          <a
            href="/merchant/opportunity"
            className="rounded-xl border border-brand px-4 py-2 text-sm font-semibold text-brand hover:bg-brand-light"
          >
            Inspect evidence
          </a>
          <a
            href="/merchant/offer"
            className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white shadow-sm hover:brightness-105"
          >
            Build offer
          </a>
        </div>
      </div>

      <div className="mt-5 space-y-3">
        {[
          { label: item.windows.previous.label, orders: item.windows.previous.orders, dark: true },
          { label: item.windows.current.label, orders: item.windows.current.orders, dark: false },
        ].map((row) => (
          <div key={row.label} className="flex items-center gap-3">
            <span className="w-28 shrink-0 text-right text-xs font-semibold text-slate-600">{row.label}</span>
            <div className="h-8 flex-1 overflow-hidden rounded-md bg-slate-100">
              <div
                className={`h-full rounded-md ${row.dark ? "bg-navy" : "bg-accent"}`}
                style={{ width: `${Math.max((row.orders / max) * 100, 2)}%` }}
              />
            </div>
            <span className="w-24 text-sm font-bold text-navy">{row.orders} orders</span>
          </div>
        ))}
      </div>

      <div className="mt-4 grid gap-2 text-sm text-slate-600 sm:grid-cols-2">
        <p>
          Net sales: {formatINR(item.windows.previous.netSalesPaise)} &rarr; {formatINR(item.windows.current.netSalesPaise)}
        </p>
        <p>
          Avg order: {formatINR(item.windows.previous.aovPaise ?? 0)} &rarr; {formatINR(item.windows.current.aovPaise ?? 0)}
        </p>
      </div>
    </div>
  );
}
