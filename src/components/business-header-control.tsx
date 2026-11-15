"use client";

/**
 * Active-business control for the shared header: shows the current business,
 * switches between owned businesses with a dropdown, and carries the labeled
 * "+ Add business" action (the registration wizard). Replaces the old
 * bottom-left floating strip so the control is visible on every screen before
 * scrolling, including at 360 px where it sits in the first header row.
 *
 * Switching/add-selecting reloads the page after a short announcement delay so
 * every screen refetches with the new business scope and no stale numbers or
 * old campaign data flash through.
 */

import { useEffect, useRef, useState } from "react";
import { api, getActiveMerchantId, setActiveMerchantId, type MerchantDto } from "@/lib/client";
import { soundKit } from "@/lib/sound";
import { RegisterBusinessModal } from "@/components/register-business";
import { useSaathi } from "@/components/saathi-provider";

export default function BusinessHeaderControl() {
  const saathi = useSaathi();
  const [merchants, setMerchants] = useState<MerchantDto[]>([]);
  const [active, setActive] = useState<string | null>(getActiveMerchantId());
  const [open, setOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const current = merchants.find((m) => m.id === active) ?? null;

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      api<{ merchants: MerchantDto[] }>("/api/merchants")
        .then((res) => {
          if (cancelled) return;
          setMerchants(res.merchants);
          const stored = getActiveMerchantId();
          const valid = res.merchants.some((m) => m.id === stored);
          if (!valid) {
            setActiveMerchantId(res.merchants[0]?.id ?? null);
            setActive(res.merchants[0]?.id ?? null);
          }
        })
        .catch(() => undefined);
    };
    refresh();
    // "Load sample data" / "Thin-data demo" create the first business for a
    // fresh session without a navigation - listen for that and refetch so the
    // strip appears immediately instead of after the next page change.
    window.addEventListener("ms-merchants-changed", refresh);
    return () => {
      cancelled = true;
      window.removeEventListener("ms-merchants-changed", refresh);
    };
  }, []);

  // Close the dropdown on outside click or Escape (keyboard + pointer parity).
  useEffect(() => {
    if (!open) return;
    const onOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onOutside);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onOutside);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (merchants.length === 0) return null;

  async function switchTo(m: MerchantDto) {
    if (m.id === active) {
      setOpen(false);
      return;
    }
    const prevName = current?.name ?? null;
    setActiveMerchantId(m.id);
    setActive(m.id);
    setOpen(false);
    soundKit.play("switch");
    saathi.say(`Now viewing ${m.name}${prevName ? ` (was ${prevName})` : ""} - every number on screen is ${m.name}'s.`, {
      mood: "curious",
    });
    // Reload so every screen refetches with the new merchant scope.
    setTimeout(() => window.location.reload(), 550);
  }

  async function remove(m: MerchantDto) {
    if (!window.confirm(`Remove ${m.name}? All of its demo rows are deleted for good.`)) return;
    setBusy(true);
    try {
      await api(`/api/merchants/${m.id}`, { method: "DELETE" });
      const rest = merchants.filter((x) => x.id !== m.id);
      setMerchants(rest);
      soundKit.play("removeBusiness");
      saathi.say(`${m.name} is gone - their rows were deleted for good.`, { mood: "sad" });
      if (m.id === active) {
        setActiveMerchantId(rest[0]?.id ?? null);
        setActive(rest[0]?.id ?? null);
        setTimeout(() => window.location.reload(), 550);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div ref={containerRef} className="relative" data-tour="merchant-strip">
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => {
            setOpen((v) => !v);
            soundKit.play(open ? "close" : "open");
          }}
          className="ms-pop flex min-w-0 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold text-navy shadow-card transition hover:border-brand"
          aria-expanded={open}
          aria-haspopup="true"
          aria-label={`Active business: ${current ? current.name : "Businesses"}. Switch business`}
        >
          <span aria-hidden>🏪</span>
          <span className="max-w-[110px] truncate sm:max-w-[180px]">{current ? current.name : "Businesses"}</span>
          <span aria-hidden className="text-slate-400">
            {open ? "▴" : "▾"}
          </span>
        </button>
        <button
          type="button"
          data-testid="add-business"
          onClick={() => {
            setWizardOpen(true);
            soundKit.play("open");
          }}
          disabled={busy}
          className="ms-pop inline-flex shrink-0 items-center gap-1 rounded-full border border-dashed border-brand/50 px-2.5 py-1.5 text-xs font-bold text-brand transition hover:bg-brand-light"
          aria-label="Add business"
          title="Add business"
        >
          <span aria-hidden>+</span> Add business
        </button>
      </div>
      {open ? (
        <div className="ms-pop absolute left-0 top-10 w-72 rounded-2xl border border-slate-200 bg-white p-2 shadow-card">
          <ul className="space-y-0.5">
            {merchants.map((m) => (
              <li key={m.id} className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => void switchTo(m)}
                  disabled={busy}
                  className={`flex-1 truncate rounded-xl px-3 py-2 text-left text-sm font-semibold transition ${
                    m.id === active ? "bg-accent-soft text-brand" : "text-slate-600 hover:bg-brand-light hover:text-brand"
                  }`}
                >
                  <span aria-hidden className="mr-1">
                    {m.domain.emoji}
                  </span>
                  {m.name}
                  <span className="ml-1.5 text-[10px] font-normal text-slate-400">{m.domain.label}</span>
                </button>
                <button
                  type="button"
                  onClick={() => void remove(m)}
                  disabled={busy}
                  className="rounded-lg px-1.5 py-1 text-xs text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                  aria-label={`Remove ${m.name}`}
                  title={`Remove ${m.name}`}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => {
              setWizardOpen(true);
              soundKit.play("open");
            }}
            disabled={busy}
            className="mt-1 w-full rounded-xl border border-dashed border-brand/40 px-3 py-2 text-xs font-bold text-brand transition hover:bg-brand-light"
          >
            + Add business
          </button>
          <p className="mt-1.5 px-1 text-[10px] leading-snug text-slate-400">
            Each business gets its own seeded numbers, offer and campaigns. Data stays in this browser session.
          </p>
        </div>
      ) : null}
      <RegisterBusinessModal
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        onRegistered={(m) => {
          setMerchants((list) => [...list, m]);
          setActiveMerchantId(m.id);
          setActive(m.id);
          soundKit.play("addBusiness");
          saathi.say(`${m.name} joined the shelf! Their numbers are seeded and ready - take a look around.`, {
            mood: "enthusiastic",
          });
          // Refresh the current view under the new business scope so nothing
          // stale flashes through; the announcement lands before the reload.
          setTimeout(() => window.location.reload(), 550);
        }}
      />
    </div>
  );
}
