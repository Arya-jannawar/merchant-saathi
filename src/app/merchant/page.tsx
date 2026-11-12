"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiClientError, type DemoStateDto, type ResetResponseDto } from "@/lib/client";
import { formatDelta, formatINR, formatDateTime } from "@/lib/format";
import { Alert, Badge, Card } from "@/components/ui";
import OpportunityCard from "@/components/opportunity-card";
import { CountUp, DayBars, DonutChart, FunnelStrip, GroupedBars, type FunnelStep } from "@/components/charts";
import { useSaathi } from "@/components/saathi-provider";
import type { DemoInsightsDto, DomainOptionDto, OpportunitiesDto } from "@/lib/client";
import { soundKit } from "@/lib/sound";
import { RegisterBusinessModal } from "@/components/register-business";

export default function MerchantDashboard() {
  const [state, setState] = useState<DemoStateDto | null>(null);
  const [opps, setOpps] = useState<OpportunitiesDto | null>(null);
  const [insights, setInsights] = useState<DemoInsightsDto | null>(null);
  const [metric, setMetric] = useState<"orders" | "sales" | "aov">("orders");
  const [domains, setDomains] = useState<DomainOptionDto[]>([]);
  const [registerOpen, setRegisterOpen] = useState(false);
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
      if (!s.seeded) {
        api<{ domains: DomainOptionDto[] }>("/api/domains")
          .then((res) => setDomains(res.domains))
          .catch(() => undefined);
      }
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
        <Badge tone="blue">
          {state.merchant?.domain.emoji} {state.merchant?.domain.label ?? "Bakery & Sweets"} · synthetic demo data
        </Badge>
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
        <div className="space-y-5">
          <Card className="ms-pop overflow-hidden">
            <div className="relative overflow-hidden bg-gradient-to-br from-navy via-brand to-[#06203f] px-8 pb-8 pt-8 text-center">
              <div className="pointer-events-none absolute -right-8 -top-6 opacity-30 text-[120px] leading-none" aria-hidden>🧁☕🛒💈📱🥤🔧📚</div>
              <p className="text-[11px] font-bold uppercase tracking-[0.25em] text-accent">Merchant Saathi platform</p>
              <h1 className="mt-2 text-3xl font-extrabold text-white">The AI growth partner for every Paytm merchant</h1>
              <p className="mx-auto mt-3 max-w-2xl text-sm leading-relaxed text-brand-mid">
                Register once, pick your domain, and get an evidence-backed growth loop for your shop: the afternoon
                story with receipts, a margin-safe offer computed in code, a hash-bound approval, and a campaign that
                reports honestly. All numbers on this platform are synthetic and simulated - every screen says so.
              </p>
              <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setRegisterOpen(true);
                    soundKit.play("open");
                  }}
                  className="rounded-xl bg-accent px-6 py-3 text-base font-bold text-white shadow-card transition hover:scale-[1.03] hover:brightness-110"
                >
                  Register your business →
                </button>
                <button
                  type="button"
                  onClick={() => void loadSampleData("bakery-v1")}
                  disabled={busy}
                  className="rounded-xl border border-white/40 px-5 py-3 text-sm font-bold text-white transition hover:bg-white/10"
                >
                  {busy ? "Loading sample data..." : "Load sample data"}
                </button>
              </div>
              <p className="mt-3 text-xs text-slate-400">
                or explore the{" "}
                <button
                  type="button"
                  onClick={() => void loadSampleData("bakery-thin-v1")}
                  disabled={busy}
                  className="font-semibold text-accent underline"
                >
                  thin-data demo
                </button>{" "}
                to see the platform refuse to guess when evidence is too small.
              </p>
            </div>
            <div className="grid gap-2 px-6 py-5 sm:grid-cols-4">
              {domains.slice(0, 8).map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => {
                    setRegisterOpen(true);
                    soundKit.play("open");
                  }}
                  className="rounded-2xl border border-slate-200 p-3 text-left transition hover:scale-[1.03] hover:border-accent hover:shadow-card"
                >
                  <p className="flex items-center gap-2 text-sm font-extrabold text-navy">
                    <span className="text-lg" aria-hidden>{d.emoji}</span>
                    {d.label}
                  </p>
                  <p className="mt-0.5 text-[10px] leading-snug text-slate-500">{d.pitch}</p>
                </button>
              ))}
            </div>
          </Card>
          <RegisterBusinessModal
            open={registerOpen}
            onClose={() => setRegisterOpen(false)}
            onRegistered={() => undefined}
          />
        </div>
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
  // Suffix keeps this heading distinct from the KPI card labels (the e2e uses
  // strict text locators - two identical strings break the flow).
  const title =
    metric === "orders"
      ? "Completed 3-6 p.m. orders - both windows"
      : metric === "sales"
        ? "Net afternoon sales - both windows"
        : "Average order value - both windows";
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
