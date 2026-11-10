"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiClientError, type DemoStateDto, type ResetResponseDto } from "@/lib/client";
import { formatDelta, formatINR, formatDateTime } from "@/lib/format";
import { Alert, Badge, Card } from "@/components/ui";
import OpportunityCard from "@/components/opportunity-card";
import { CountUp, DayBars, DonutChart, FunnelStrip, GroupedBars, type FunnelStep } from "@/components/charts";
import { useSaathi } from "@/components/saathi-provider";
import type { DemoInsightsDto, OpportunitiesDto } from "@/lib/client";
import { soundKit } from "@/lib/sound";

export default function MerchantDashboard() {
  const [state, setState] = useState<DemoStateDto | null>(null);
  const [opps, setOpps] = useState<OpportunitiesDto | null>(null);
  const [insights, setInsights] = useState<DemoInsightsDto | null>(null);
  const [metric, setMetric] = useState<"orders" | "sales" | "aov">("orders");
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
          setInsights(await api<DemoInsightsDto>("/api/demo/insights"));
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
        setInsights(null);
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

          {/* Story charts - one glance: big metric + day pattern */}
          {state.kpis && insights ? (
            <Card data-tour="window-charts" className="ms-rise p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs font-bold uppercase tracking-widest text-slate-500">
                  The afternoon story, in one glance
                </p>
                <div className="flex gap-1 rounded-xl bg-slate-100 p-1">
                  {(
                    [
                      ["orders", "Orders"],
                      ["sales", "Net sales"],
                      ["aov", "Avg order"],
                    ] as const
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => {
                        setMetric(key);
                        soundKit.play("tap");
                      }}
                      className={`rounded-lg px-3 py-1 text-xs font-bold transition ${
                        metric === key ? "bg-white text-brand shadow-sm" : "text-slate-500 hover:text-brand"
                      }`}
                      aria-pressed={metric === key}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="mt-4 grid gap-6 md:grid-cols-2">
                <StoryChart
                  metric={metric}
                  kpis={state.kpis}
                  windowLabels={{ previous: insights.windowLabels.previous, current: insights.windowLabels.current }}
                />
                <div>
                  <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">
                    Day by day (3-6 p.m., hover for numbers)
                  </p>
                  <DayBars
                    ariaLabel={"Per-day completed 3-6 p.m. orders for " + insights.windowLabels.previous + " vs " + insights.windowLabels.current}
                    days={insights.days.previous.map((d, i) => ({
                      dayLabel: d.dayLabel,
                      previous: { orders: d.orders, netSalesPaise: d.netSalesPaise },
                      current: { orders: insights.days.current[i]?.orders ?? 0, netSalesPaise: insights.days.current[i]?.netSalesPaise ?? 0 },
                    }))}
                  />
                </div>
              </div>
            </Card>
          ) : null}

          {/* Campaign funnel - appears once a campaign is queued */}
          {insights?.funnel?.queued ? (
            <Card data-tour="funnel" className="ms-pop p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-bold uppercase tracking-widest text-slate-500">
                  {insights.merchantName.split("(")[0].trim()} - campaign funnel
                </p>
                <Badge tone="gray">Simulated campaign outcomes</Badge>
              </div>
              <div className="mt-4">
                <FunnelStrip
                  ariaLabel="Campaign funnel from customers to contribution"
                  steps={
                    [
                      { label: "customers", value: insights.funnel.customers, valueLabel: String(insights.funnel.customers), tone: "navy" },
                      { label: "with consent", value: insights.funnel.eligible, valueLabel: String(insights.funnel.eligible), tone: "accent" },
                      { label: "simulated outbox", value: insights.funnel.queued ?? 0, valueLabel: String(insights.funnel.queued ?? 0), tone: "accent" },
                      ...(insights.funnel.redemptions !== null
                        ? [
                            {
                              label: "redemptions",
                              value: insights.funnel.redemptions ?? 0,
                              valueLabel: String(insights.funnel.redemptions ?? 0),
                              tone: "good" as const,
                            },
                          ]
                        : []),
                      ...(insights.funnel.contributionPaise !== null
                        ? [
                            {
                              label: "contribution",
                              value: insights.funnel.contributionPaise ?? 0,
                              valueLabel: formatINR(insights.funnel.contributionPaise ?? 0),
                              tone: "good" as const,
                            },
                          ]
                        : []),
                    ] as FunnelStep[]
                  }
                />
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


const METRIC_FORMAT: Record<string, (v: number) => string> = {
  orders: (v) => String(Math.round(v)),
  sales: (v) => formatINR(Math.round(v)),
  aov: (v) => formatINR(Math.round(v)),
};

/** One metric across the two windows, with the delta called out big. */
function StoryChart({
  metric,
  kpis,
  windowLabels,
}: {
  metric: "orders" | "sales" | "aov";
  kpis: NonNullable<DemoStateDto["kpis"]>;
  windowLabels: { previous: string; current: string };
}) {
  const values =
    metric === "orders"
      ? { prev: kpis.previous.orders, curr: kpis.current.orders, delta: kpis.ordersDeltaPct }
      : metric === "sales"
        ? { prev: kpis.previous.netSalesPaise, curr: kpis.current.netSalesPaise, delta: kpis.salesDeltaPct }
        : { prev: kpis.previous.aovPaise ?? 0, curr: kpis.current.aovPaise ?? 0, delta: null };
  const format = METRIC_FORMAT[metric];
  const title = metric === "orders" ? "Completed 3-6 p.m. orders" : metric === "sales" ? "Net afternoon sales" : "Average order value";
  const insight =
    metric === "aov"
      ? "Flat average order value - the decline is in how many orders arrive, not how big they are."
      : title + " moved " + format(values.prev) + " -> " + format(values.curr) + " (" + (values.delta === null ? "n/a" : formatDelta(values.delta)) + "). Two complete Mon-Fri windows - an observation, not a cause.";
  return (
    <div>
      <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">{title}</p>
      <GroupedBars
        ariaLabel={title + ": " + format(values.prev) + " in " + windowLabels.previous + ", " + format(values.curr) + " in " + windowLabels.current}
        height={150}
        groups={[
          {
            label: windowLabels.previous,
            bars: [
              { value: values.prev, label: "before", valueLabel: format(values.prev), color: "#0a2e5c" },
              { value: values.curr, label: "now", valueLabel: format(values.curr), color: "#00b9f1" },
            ],
          },
        ]}
      />
      <p className="mt-3 rounded-xl bg-brand-light px-3 py-2 text-xs font-semibold leading-relaxed text-navy">{insight}</p>
    </div>
  );
}
