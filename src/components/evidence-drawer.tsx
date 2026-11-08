"use client";

import { useState } from "react";
import type { EvidenceEntryDto } from "@/lib/client";

/** Evidence drawer: every number links to its metric definition, window and source. */
export default function EvidenceDrawer({ evidence }: { evidence: EvidenceEntryDto[] }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-xl border border-slate-200">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
        aria-expanded={open}
      >
        <span className="text-sm font-semibold text-navy">
          Evidence ({evidence.length} checks) - where every number comes from
        </span>
        <span className="text-slate-500">{open ? "\u25B4" : "\u25BE"}</span>
      </button>
      {open ? (
        <ul className="divide-y divide-slate-100 border-t border-slate-100">
          {evidence.map((e) => (
            <li key={e.id} className="px-4 py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm font-semibold text-navy">{e.label}</p>
                <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">{e.id}</code>
              </div>
              <p className="mt-1 text-sm font-bold text-brand">{e.valueLabel}</p>
              <p className="mt-1 text-xs leading-relaxed text-slate-600">{e.definition}</p>
              <p className="mt-1 text-xs text-slate-400">
                {e.period} - source: {e.source}
              </p>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
