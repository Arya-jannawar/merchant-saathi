"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiClientError, type DemoStateDto, type ResetResponseDto } from "@/lib/client";
import { formatDelta, formatINR, formatDateTime } from "@/lib/format";
import { Alert, Badge, Card } from "@/components/ui";
import OpportunityCard from "@/components/opportunity-card";
import type { OpportunitiesDto } from "@/lib/client";

export default function MerchantDashboard() {
  const [state, setState] = useState<DemoStateDto | null>(null);
  const [opps, setOpps] = useState<OpportunitiesDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const s = await api<DemoStateDto>("/api/demo/state");
      setState(s);
      if (s.seeded) {
        setOpps(await api<OpportunitiesDto>("/api/opportunities"));
      }
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not reach the demo API.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function loadSampleData() {
    setBusy(true);
    try {
      await api<ResetResponseDto>("/api/demo/reset", { method: "POST" });
      await load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Reset failed.");
    } finally {
      setBusy(false);
    }
  }

  if (!state) {
    return (
      <div className="py-16 text-center text-sm text-slate-500">
        {error ? <Alert tone="error" title={error} /> : "Loading demo state..."}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* status strip */}
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="blue">Synthetic demo data ({state.merchant?.fixtureVersion ?? "bakery-v1"})</Badge>
        <Badge tone="cyan">
          AI mode: {state.aiMode === "live" ? "live model" : "fixture (labeled, no credentials)"}
        </Badge>
        <Badge tone="gray">
          Clock: {formatDateTime(state.nowIso)} IST {state.clockInjected ? "(injected)" : "(wall clock)"}
        </Badge>
        {state.seeded ? (
          <button type="button" onClick={loadSampleData} disabled={busy} className="btn-secondary ml-auto !py-1.5 text-xs">
            {busy ? "Resetting..." : "Reset demo"}
          </button>
        ) : null}
      </div>

      {error ? <Alert tone="error" title={error} /> : null}

      {!state.seeded ? (
        <Card className="p-8 text-center">
          <h1 className="text-2xl font-extrabold text-navy">Merchant Saathi</h1>
          <p className="mx-auto mt-2 max-w-xl text-sm leading-relaxed text-slate-600">
            {state.hint ?? "Load the sample data to explore the demo bakery."} This prototype loads one transparent
            synthetic bakery dataset (fixture <strong>bakery-v1</strong>) so every number on screen can be traced and
            reconciled. No real customer or payment data is used.
          </p>
          <button type="button" onClick={loadSampleData} disabled={busy} className="btn-primary mx-auto mt-6 !px-6 !py-3 text-base">
            {busy ? "Loading sample data..." : "Load sample data"}
          </button>
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h1 className="text-2xl font-extrabold text-navy">{state.merchant?.name}</h1>
            <p className="text-xs text-slate-500">Session {state.sessionId.slice(0, 8)} - isolated per browser</p>
          </div>

          {/* KPI cards */}
          {state.kpis ? (
            <div className="grid gap-4 sm:grid-cols-3">
              <KpiCard
                label="Completed 3-6 p.m. orders"
                prev={String(state.kpis.previous.orders)}
                curr={String(state.kpis.current.orders)}
                delta={state.kpis.ordersDeltaPct}
                period={`${state.kpis.previous.label} \u2192 ${state.kpis.current.label}`}
              />
              <KpiCard
                label="Net afternoon sales"
                prev={formatINR(state.kpis.previous.netSalesPaise)}
                curr={formatINR(state.kpis.current.netSalesPaise)}
                delta={state.kpis.salesDeltaPct}
                period={`${state.kpis.previous.label} \u2192 ${state.kpis.current.label}`}
              />
              <KpiCard
                label="Average order value"
                prev={formatINR(state.kpis.previous.aovPaise ?? 0)}
                curr={formatINR(state.kpis.current.aovPaise ?? 0)}
                delta={
                  state.kpis.previous.aovPaise && state.kpis.current.aovPaise
                    ? Math.round(((state.kpis.current.aovPaise - state.kpis.previous.aovPaise) / state.kpis.previous.aovPaise) * 1000) / 10
                    : null
                }
                period="Flat AOV - the decline is in order count"
              />
            </div>
          ) : null}

          {/* Opportunity */}
          {opps && opps.items.length > 0 ? (
            <OpportunityCard item={opps.items[0]} />
          ) : (
            <Card className="p-5">
              <p className="text-sm text-slate-600">{opps?.lowDataReason ?? "No qualifying opportunity right now."}</p>
            </Card>
          )}

          {/* Audience + next step */}
          <div className="grid gap-4 md:grid-cols-2">
            <Card className="p-5">
              <p className="text-xs font-bold uppercase tracking-widest text-slate-500">Consented audience (demo CRM)</p>
              <p className="mt-2 text-2xl font-extrabold text-navy">
                {state.audience?.eligible ?? 0} eligible
                <span className="ml-2 text-sm font-semibold text-slate-500">
                  / {(state.audience?.excluded ?? 0)} excluded
                </span>
              </p>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">
                Only customers with an active {state.audience?.channel ?? "sms"} demo consent are eligible. Revoked or
                missing consents are excluded automatically, and these are non-deliverable demo IDs - nothing is ever
                really sent.
              </p>
            </Card>
            <Card className="p-5">
              <p className="text-xs font-bold uppercase tracking-widest text-slate-500">Owner control loop</p>
              <ol className="mt-3 space-y-2 text-sm text-slate-600">
                <li>
                  <strong className="text-navy">1. Inspect</strong> - see the decline and the records behind it.
                </li>
                <li>
                  <strong className="text-navy">2. Edit terms</strong> - price, cap and copy, with live margin checks.
                </li>
                <li>
                  <strong className="text-navy">3. Approve</strong> - queue a simulated campaign only after you approve the exact preview.
                </li>
              </ol>
              <a href="/merchant/offer" className="btn-primary mt-4 inline-block">
                Open offer workspace
              </a>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function KpiCard({
  label,
  prev,
  curr,
  delta,
  period,
}: {
  label: string;
  prev: string;
  curr: string;
  delta: number | null;
  period: string;
}) {
  const bad = delta !== null && delta < 0;
  return (
    <Card className="p-5">
      <p className="text-xs font-bold uppercase tracking-widest text-slate-500">{label}</p>
      <p className="mt-2 flex items-baseline gap-2">
        <span className="text-2xl font-extrabold text-navy">{curr}</span>
        <span className="text-sm text-slate-400 line-through">{prev}</span>
        {delta !== null ? (
          <span className={`text-sm font-bold ${bad ? "text-rose-600" : "text-emerald-600"}`}>{formatDelta(delta)}</span>
        ) : null}
      </p>
      <p className="mt-1 text-xs text-slate-400">{period}</p>
    </Card>
  );
}
