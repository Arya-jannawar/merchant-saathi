"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiClientError, type DemoStateDto, type ResetResponseDto } from "@/lib/client";
import { formatDelta, formatINR, formatDateTime } from "@/lib/format";
import { Alert, Badge, Card } from "@/components/ui";
import OpportunityCard from "@/components/opportunity-card";
import { CountUp, DonutChart, GroupedBars, MiniLine } from "@/components/charts";
import { useSaathi } from "@/components/saathi-provider";
import type { OpportunitiesDto } from "@/lib/client";

export default function MerchantDashboard() {
  const [state, setState] = useState<DemoStateDto | null>(null);
  const [opps, setOpps] = useState<OpportunitiesDto | null>(null);
  const [oppsLoading, setOppsLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saathi = useSaathi();
  const greeted = useRef(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      const s = await api<DemoStateDto>("/api/demo/state");
      setState(s);
      if (s.seeded) {
        setOppsLoading(true);
        try {
          setOpps(await api<OpportunitiesDto>("/api/opportunities"));
        } finally {
          setOppsLoading(false);
        }
        if (!greeted.current) {
          greeted.current = true;
          saathi.say("Welcome back! The afternoon numbers are waiting - tap any chart, or ask me anything.", {
            mood: "wave",
            sound: "jingle",
          });
        }
      } else {
        setOpps(null);
      }
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not reach the demo API.");
      saathi.react("sad", "error");
    } finally {
      setOppsLoading(false);
    }
  }, [saathi]);

  useEffect(() => {
    void load();
  }, [load]);

  async function loadSampleData(fixtureVersion: "bakery-v1" | "bakery-thin-v1" = "bakery-v1") {
    setBusy(true);
    try {
      await api<ResetResponseDto>("/api/demo/reset", {
        method: "POST",
        body: JSON.stringify({ fixtureVersion }),
      });
      saathi.say(
        fixtureVersion === "bakery-thin-v1"
          ? "Thin data loaded - watch the app refuse to guess. That refusal is a feature!"
          : "Fresh bakery data loaded. Follow me: KPIs, then the opportunity, then the offer workspace!",
        { mood: "excited", sound: "celebrate" }
      );
      await load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Reset failed.");
      saathi.react("sad", "error");
    } finally {
      setBusy(false);
    }
  }

  if (!state) {
    return (
      <div className="py-16 text-center text-sm text-slate-500">
        {error ? (
          <div className="mx-auto max-w-md space-y-4">
            <Alert tone="error" title={error} />
            <p className="text-xs text-slate-400">
              Check that the dev server is still running, then retry. Nothing was changed.
            </p>
            <button type="button" onClick={() => void load()} className="btn-secondary mx-auto !px-5">
              Retry
            </button>
          </div>
        ) : (
          "Loading demo state..."
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* status strip */}
      <div data-tour="status-strip" className="ms-rise flex flex-wrap items-center gap-2">
        <Badge tone="blue">Synthetic demo data ({state.merchant?.fixtureVersion ?? "bakery-v1"})</Badge>
        <Badge tone="cyan">
          AI mode: {state.aiMode === "live" ? "live model" : "fixture (labeled, no credentials)"}
        </Badge>
        <Badge tone="gray">
          Clock: {formatDateTime(state.nowIso)} IST {state.clockInjected ? "(injected)" : "(wall clock)"}
        </Badge>
        {state.seeded ? (
          <div className="ml-auto flex gap-2">
            <button
              type="button"
              onClick={() => loadSampleData("bakery-thin-v1")}
              disabled={busy}
              className="btn-secondary !py-1.5 text-xs"
            >
              Thin-data demo
            </button>
            <button
              type="button"
              onClick={() => loadSampleData("bakery-v1")}
              disabled={busy}
              data-testid="reset-demo"
              className="btn-secondary !py-1.5 text-xs"
            >
              {busy ? "Resetting..." : "Reset demo"}
            </button>
          </div>
        ) : null}
      </div>

      {error ? <Alert tone="error" title={error} /> : null}

      {!state.seeded ? (
        <Card className="ms-pop p-8 text-center">
          <h1 className="text-2xl font-extrabold text-navy">Merchant Saathi</h1>
          <p className="mx-auto mt-2 max-w-xl text-sm leading-relaxed text-slate-600">
            {state.hint ?? "Load the sample data to explore the demo bakery."} This prototype loads one transparent
            synthetic bakery dataset (fixture <strong>bakery-v1</strong>) so every number on screen can be traced and
            reconciled. No real customer or payment data is used.
          </p>
          <button type="button" onClick={() => loadSampleData("bakery-v1")} disabled={busy} className="btn-primary mx-auto mt-6 !px-6 !py-3 text-base">
            {busy ? "Loading sample data..." : "Load sample data"}
          </button>
          <p className="mt-3 text-xs text-slate-400">
            or{" "}
            <button
              type="button"
              onClick={() => loadSampleData("bakery-thin-v1")}
              disabled={busy}
              className="font-semibold text-brand underline"
            >
              load the thin-data demo
            </button>{" "}
            to see the app say &quot;insufficient evidence&quot; when windows are too small.
          </p>
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h1 className="text-2xl font-extrabold text-navy">{state.merchant?.name}</h1>
            <p className="text-xs text-slate-500">Session {state.sessionId.slice(0, 8)} - isolated per browser</p>
          </div>

          {/* KPI cards */}
          {state.kpis ? (
            <div data-tour="kpis" className="ms-stagger grid gap-4 sm:grid-cols-3">
              <KpiCard
                label="Completed 3-6 p.m. orders"
                prevValue={state.kpis.previous.orders}
                currValue={state.kpis.current.orders}
                delta={state.kpis.ordersDeltaPct}
                period={`${state.kpis.previous.label} \u2192 ${state.kpis.current.label}`}
                format={(v) => String(Math.round(v))}
              />
              <KpiCard
                label="Net afternoon sales"
                prevValue={state.kpis.previous.netSalesPaise}
                currValue={state.kpis.current.netSalesPaise}
                delta={state.kpis.salesDeltaPct}
                period={`${state.kpis.previous.label} \u2192 ${state.kpis.current.label}`}
                format={(v) => formatINR(Math.round(v))}
              />
              <KpiCard
                label="Average order value"
                prevValue={state.kpis.previous.aovPaise ?? 0}
                currValue={state.kpis.current.aovPaise ?? 0}
                delta={
                  state.kpis.previous.aovPaise && state.kpis.current.aovPaise
                    ? Math.round(((state.kpis.current.aovPaise - state.kpis.previous.aovPaise) / state.kpis.previous.aovPaise) * 1000) / 10
                    : null
                }
                period="Flat AOV - the decline is in order count"
                format={(v) => formatINR(Math.round(v))}
              />
            </div>
          ) : null}

          {/* Window comparison - one-look charts */}
          {state.kpis ? (
            <Card data-tour="window-charts" className="ms-rise p-5">
              <p className="text-xs font-bold uppercase tracking-widest text-slate-500">
                Both windows, side by side (from the same computed totals as the cards above)
              </p>
              <div className="mt-4 grid gap-6 md:grid-cols-3">
                <GroupedBars
                  ariaLabel={`Completed 3-6 p.m. orders: ${state.kpis.previous.orders} before, ${state.kpis.current.orders} now`}
                  height={150}
                  groups={[
                    {
                      label: state.kpis.previous.label,
                      bars: [
                        { value: state.kpis.previous.orders, label: "before", valueLabel: String(state.kpis.previous.orders), color: "#0a2e5c" },
                        { value: state.kpis.current.orders, label: "now", valueLabel: String(state.kpis.current.orders), color: "#00b9f1" },
                      ],
                    },
                  ]}
                />
                <GroupedBars
                  ariaLabel={`Net afternoon sales: ${formatINR(state.kpis.previous.netSalesPaise)} before, ${formatINR(state.kpis.current.netSalesPaise)} now`}
                  height={150}
                  groups={[
                    {
                      label: state.kpis.previous.label,
                      bars: [
                        { value: state.kpis.previous.netSalesPaise, label: "before", valueLabel: formatINR(state.kpis.previous.netSalesPaise), color: "#0a2e5c" },
                        { value: state.kpis.current.netSalesPaise, label: "now", valueLabel: formatINR(state.kpis.current.netSalesPaise), color: "#00b9f1" },
                      ],
                    },
                  ]}
                />
                <div className="flex flex-col items-center justify-center">
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Average order value</p>
                  <MiniLine
                    ariaLabel={`Average order value flat at ${formatINR(state.kpis.current.aovPaise ?? 0)}`}
                    points={[state.kpis.previous.aovPaise ?? 0, state.kpis.current.aovPaise ?? 0]}
                    valueLabels={[formatINR(state.kpis.previous.aovPaise ?? 0), formatINR(state.kpis.current.aovPaise ?? 0)]}
                  />
                  <p className="mt-1 text-[11px] text-slate-400">Flat - so the problem is order count, not basket size.</p>
                </div>
              </div>
            </Card>
          ) : null}

          {/* Opportunity */}
          <div data-tour="opportunity">
            {oppsLoading ? (
              <Card className="p-5">
                <p className="text-sm text-slate-500">Loading opportunity...</p>
              </Card>
            ) : opps && opps.items.length > 0 ? (
              <OpportunityCard item={opps.items[0]} />
            ) : (
              <Card className="p-5">
                <p className="text-sm text-slate-600">{opps?.lowDataReason ?? "No qualifying opportunity right now."}</p>
              </Card>
            )}
          </div>

          {/* Audience + next step */}
          <div className="ms-stagger grid gap-4 md:grid-cols-2">
            <Card data-tour="audience" className="p-5">
              <p className="text-xs font-bold uppercase tracking-widest text-slate-500">Consented audience (demo CRM)</p>
              <div className="mt-4">
                <DonutChart
                  ariaLabel={`${state.audience?.eligible ?? 0} eligible customers, ${state.audience?.excluded ?? 0} excluded`}
                  segments={[
                    { value: state.audience?.eligible ?? 0, label: "Active consent", color: "#00b9f1" },
                    { value: state.audience?.excluded ?? 0, label: "Excluded", color: "#cbd5e1" },
                  ]}
                  centerValue={`${state.audience?.eligible ?? 0}`}
                  centerLabel="eligible"
                />
              </div>
              <p className="mt-3 text-sm leading-relaxed text-slate-600">
                Only customers with an active {state.audience?.channel ?? "sms"} demo consent are eligible. Revoked or
                missing consents are excluded automatically, and these are non-deliverable demo IDs - nothing is ever
                really sent.
              </p>
            </Card>
            <Card data-tour="next-step" className="p-5">
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
  prevValue,
  currValue,
  delta,
  period,
  format,
}: {
  label: string;
  prevValue: number;
  currValue: number;
  delta: number | null;
  period: string;
  format: (v: number) => string;
}) {
  const bad = delta !== null && delta < 0;
  return (
    <Card className="p-5">
      <p className="text-xs font-bold uppercase tracking-widest text-slate-500">{label}</p>
      <p className="mt-2 flex items-baseline gap-2">
        <span className="text-2xl font-extrabold text-navy">
          <CountUp value={currValue} format={format} />
        </span>
        <span className="text-sm text-slate-400 line-through">{format(prevValue)}</span>
        {delta !== null ? (
          <span className={`text-sm font-bold ${bad ? "text-rose-600" : "text-emerald-600"}`}>{formatDelta(delta)}</span>
        ) : null}
      </p>
      <p className="mt-1 text-xs text-slate-400">{period}</p>
    </Card>
  );
}
