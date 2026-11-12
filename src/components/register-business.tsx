"use client";

import { useEffect, useState } from "react";
import { MascotById } from "@/components/mascot";
import { MASCOTS, getMascot, type MascotId } from "@/lib/mascots-config";
import { api, ApiClientError, setActiveMerchantId, type MerchantDto } from "@/lib/client";
import { soundKit } from "@/lib/sound";

/**
 * The registration wizard - how a merchant joins the platform.
 * Step 1: name the business and pick its domain (kirana, cafe, salon, ...).
 * Step 2: pick a buddy. Registering seeds a domain-shaped tenant with the
 * platform's verified economics and switches the session to it.
 */

export interface DomainOption {
  id: string;
  label: string;
  emoji: string;
  pitch: string;
  bundleName: string;
  fixtureVersion: string;
}

export function RegisterBusinessModal({
  open,
  onClose,
  onRegistered,
}: {
  open: boolean;
  onClose: () => void;
  onRegistered: (merchant: MerchantDto) => void;
}) {
  const [domains, setDomains] = useState<DomainOption[]>([]);
  const [step, setStep] = useState<1 | 2>(1);
  const [name, setName] = useState("");
  const [domain, setDomain] = useState<DomainOption | null>(null);
  const [buddy, setBuddy] = useState<MascotId>("mithu");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setStep(1);
      setName("");
      setDomain(null);
      setError(null);
      api<{ domains: DomainOption[] }>("/api/domains")
        .then((res) => setDomains(res.domains))
        .catch(() => setDomains([]));
    }
  }, [open]);

  if (!open) return null;

  async function register() {
    if (!domain) return;
    setBusy(true);
    setError(null);
    try {
      const created = await api<MerchantDto>("/api/merchants", {
        method: "POST",
        body: JSON.stringify({ name: name.trim() || undefined, domain: domain.fixtureVersion }),
      });
      setActiveMerchantId(created.id);
      window.localStorage.setItem("ms_mascot", buddy);
      soundKit.play("addBusiness");
      onRegistered(created);
      onClose();
      setTimeout(() => window.location.reload(), 550);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Registration failed. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-navy-deep/60 p-4" role="dialog" aria-modal="true" aria-label="Register your business">
      <div className="ms-pop flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl bg-white shadow-card">
        {/* gradient header */}
        <div className="relative overflow-hidden bg-gradient-to-br from-navy via-brand to-[#06203f] px-6 py-5">
          <div className="pointer-events-none absolute -right-10 -top-10 opacity-40">
            <MascotById id={buddy} mood="excited" size={120} />
          </div>
          <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-accent">Merchant Saathi platform</p>
          <h2 className="mt-1 text-xl font-extrabold text-white">
            {step === 1 ? "Register your business 🚀" : "Pick your buddy 🎭"}
          </h2>
          <p className="mt-0.5 max-w-md text-xs leading-relaxed text-brand-mid">
            {step === 1
              ? "The AI growth partner for every Paytm merchant - any domain, same verified math."
              : `Your buddy greets customers, guides the tour and reacts to ${domain?.label ?? "your"} numbers.`}
          </p>
          <div className="mt-3 flex items-center gap-1.5">
            <span className={`h-1.5 rounded-full transition-all ${step === 1 ? "w-6 bg-accent" : "w-3 bg-white/40"}`} />
            <span className={`h-1.5 rounded-full transition-all ${step === 2 ? "w-6 bg-accent" : "w-3 bg-white/40"}`} />
          </div>
          <button type="button" onClick={onClose} className="absolute right-4 top-4 rounded-lg px-2 py-1 text-white/70 transition hover:bg-white/10 hover:text-white" aria-label="Close registration">
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {step === 1 ? (
            <div className="space-y-4">
              <label className="block">
                <span className="text-xs font-bold uppercase tracking-widest text-slate-500">Business name</span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Sharma Kirana Store, Bling Studio…"
                  maxLength={60}
                  className="mt-1 w-full"
                  aria-label="Business name"
                />
                <span className="mt-1 block text-[11px] text-slate-400">Optional - we generate one from your domain if you skip it.</span>
              </label>

              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-slate-500">Choose your domain</p>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {domains.map((d) => (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => {
                        setDomain(d);
                        soundKit.play("tap");
                      }}
                      className={`rounded-2xl border-2 p-3 text-left transition hover:scale-[1.02] ${
                        domain?.id === d.id ? "border-accent bg-accent-soft shadow-card" : "border-slate-200 hover:border-brand/50"
                      }`}
                      aria-pressed={domain?.id === d.id}
                    >
                      <p className="flex items-center gap-2 text-sm font-extrabold text-navy">
                        <span className="text-xl" aria-hidden>{d.emoji}</span>
                        {d.label}
                      </p>
                      <p className="mt-0.5 text-[11px] leading-snug text-slate-500">{d.pitch}</p>
                      <p className="mt-1 text-[10px] font-semibold text-brand">Sample offer: {d.bundleName}</p>
                    </button>
                  ))}
                  {domains.length === 0 ? (
                    <p className="text-sm text-slate-400">Loading domains…</p>
                  ) : null}
                </div>
              </div>
            </div>
          ) : (
            <div>
              <p className="rounded-xl bg-brand-light px-3 py-2 text-xs font-semibold text-navy">
                {domain?.emoji} <strong>{name.trim() || "Your business"}</strong> · {domain?.label} · suggested offer:
                “{domain?.bundleName}”
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {MASCOTS.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => {
                      setBuddy(m.id);
                      soundKit.playMascot(m.id, m.signature[0]);
                    }}
                    onMouseEnter={() => soundKit.play("hover")}
                    className={`rounded-2xl border-2 p-2 text-center transition hover:scale-[1.03] ${
                      buddy === m.id ? "border-accent bg-accent-soft shadow-card" : "border-slate-200 hover:border-brand/40"
                    }`}
                    aria-pressed={buddy === m.id}
                  >
                    <MascotById id={m.id} mood={buddy === m.id ? "happy" : "idle"} size={56} className="mx-auto" />
                    <p className="mt-1 text-xs font-extrabold text-navy">{m.name}</p>
                  </button>
                ))}
              </div>
              <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
                {getMascot(buddy).name} greets you on every screen, runs the guided tour, reacts to approvals and
                rejections, and sleeps when you step away. You can switch buddies anytime with 🎭.
              </p>
            </div>
          )}
          {error ? <p className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-6 py-3">
          <button
            type="button"
            onClick={onClose}
            className="text-xs font-semibold text-slate-400 underline hover:text-slate-600"
          >
            Cancel
          </button>
          <div className="flex gap-2">
            {step === 2 ? (
              <button type="button" onClick={() => setStep(1)} className="btn-secondary">
                Back
              </button>
            ) : null}
            {step === 1 ? (
              <button
                type="button"
                onClick={() => {
                  setStep(2);
                  soundKit.play("open");
                }}
                disabled={!domain}
                className="btn-primary"
              >
                Continue →
              </button>
            ) : (
              <button type="button" onClick={() => void register()} disabled={busy} className="btn-primary !px-5">
                {busy ? "Registering…" : `Register ${domain?.emoji ?? ""}`}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
