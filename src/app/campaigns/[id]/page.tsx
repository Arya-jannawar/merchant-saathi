"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api, ApiClientError, type CampaignResultsDto, type RedeemResponseDto } from "@/lib/client";
import { formatDateTime, formatINR } from "@/lib/format";
import { Alert, Badge, Card, Stat } from "@/components/ui";
import { CountUp, Meter, WaterfallChart } from "@/components/charts";
import { useSaathi } from "@/components/saathi-provider";

export default function CampaignPage() {
  const params = useParams<{ id: string }>();
  const campaignId = params?.id;

  const [results, setResults] = useState<CampaignResultsDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "info" | "warn" | "error"; text: string } | null>(null);
  const saathi = useSaathi();

  const load = useCallback(async () => {
    if (!campaignId) return;
    try {
      setResults(await api<CampaignResultsDto>(`/api/campaigns/${campaignId}/results`));
    } catch (err) {
      setNotice({ tone: "error", text: err instanceof ApiClientError ? err.message : "Could not load campaign." });
      saathi.react("sad", "error");
    }
  }, [campaignId, saathi]);

  useEffect(() => {
    void load();
  }, [load]);

  async function redeem(eventId: string) {
    if (!campaignId) return;
    setBusy(true);
    setNotice(null);
    try {
      const res = await api<RedeemResponseDto>(`/api/demo/campaigns/${campaignId}/redeem`, {
        method: "POST",
        body: JSON.stringify({ eventId }),
      });
      if (res.redemption.duplicate) {
        setNotice({ tone: "warn", text: `Event ${eventId} was already recorded - replaying it changed nothing (idempotent).` });
        saathi.say(`See that? ${eventId} replayed and changed nothing. Idempotency, verified live. 🛡️`, { mood: "happy", sound: "reply" });
      } else {
        setNotice({ tone: "info", text: `Recorded ${eventId}: ${res.redemption.quantity} bundle(s) at ${formatINR(res.redemption.amountPaise)} (simulated).` });
        saathi.react("happy", "tap");
      }
      await load();
    } catch (err) {
      setNotice({
        tone: "error",
        text: err instanceof ApiClientError ? `${err.message} (${err.code})` : "Redemption failed.",
      });
      saathi.react("sad", "error");
    } finally {
      setBusy(false);
    }
  }

  async function redeemAll() {
    if (!results) return;
    setBusy(true);
    setNotice(null);
    let applied = 0;
    let lastError: string | null = null;
    for (const ev of results.availableEvents) {
      try {
        const res = await api<RedeemResponseDto>(`/api/demo/campaigns/${campaignId}/redeem`, {
          method: "POST",
          body: JSON.stringify({ eventId: ev.eventId }),
        });
        if (!res.redemption.duplicate) applied += 1;
      } catch (err) {
        lastError = err instanceof ApiClientError ? err.message : "failed";
        break;
      }
    }
    setNotice({
      tone: lastError ? "warn" : "info",
      text: lastError
        ? `Applied ${applied} event(s), then stopped: ${lastError}`
        : `Applied ${applied} new simulated redemption event(s).`,
    });
    setBusy(false);
    if (!lastError && applied > 0) {
      saathi.say("All events applied - check the waterfall below: bundle sales minus ingredients & packaging, all simulated and labeled. The loop is complete! 🎉", {
        mood: "excited",
        sound: "celebrate",
      });
    }
    await load();
  }

  function downloadSummary() {
    if (!results) return;
    const r = results.redemptions;
    const lines = [
      "MERCHANT SAATHI - CAMPAIGN SUMMARY (SIMULATED DEMO)",
      "===================================================",
      `Campaign: ${results.campaign.id} v${results.campaign.version}`,
      `Status: ${results.campaign.status}`,
      `Offer: ${results.campaign.offer.bundleName} at ${formatINR(results.campaign.offer.pricePaise)} (usual ${formatINR(
        results.campaign.offer.normalPricePaise
      )}), cap ${results.campaign.offer.cap}/day`,
      `Validity: until ${formatDateTime(results.campaign.expiresAt)} IST`,
      `Audience: ${results.campaign.audienceCount} consented (simulated outbox: ${results.outbox.queued})`,
      `AI mode: ${results.campaign.aiMode}`,
      "",
      "SIMULATED CAMPAIGN OUTCOMES",
      `Unique redemptions: ${r.redemptions} (cap ${r.cap})`,
      `Bundle sales: ${formatINR(r.revenuePaise)}`,
      `Ingredients & packaging: -${formatINR(r.variableCostPaise)}`,
      `Contribution toward fixed costs: ${formatINR(r.contributionPaise)}`,
      `Discount given: ${formatINR(r.discountPaise)}`,
      "",
      "CAVEATS",
      ...results.caveats.map((c) => `- ${c}`),
    ].join("\n");
    const blob = new Blob([lines], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `campaign-${results.campaign.id}-summary.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (!results) {
    if (notice) {
      return (
        <div className="mx-auto max-w-lg py-10">
          <Card className="p-6 text-center">
            <p className="text-xs font-bold uppercase tracking-widest text-slate-500">Campaign activity</p>
            <h1 className="mt-1 text-lg font-extrabold text-navy">
              {notice.tone === "error" && /not found/i.test(notice.text)
                ? "Campaign not found in this session"
                : "Could not load the campaign"}
            </h1>
            <div className="mt-3">
              <Alert tone={notice.tone} title={notice.text} />
            </div>
            <p className="mt-3 text-xs leading-relaxed text-slate-500">
              Campaigns are scoped to this browser session. The campaign may belong to another session, or the demo
              data was reset. Queuing a campaign again from the offer workspace creates a fresh, trackable activity page.
            </p>
            <div className="mt-4 flex justify-center gap-2">
              <button type="button" onClick={() => void load()} className="btn-secondary">
                Retry
              </button>
              <a href="/merchant" className="btn-primary">
                Back to dashboard
              </a>
            </div>
          </Card>
        </div>
      );
    }
    return <p className="py-16 text-center text-sm text-slate-500">Loading campaign...</p>;
  }

  const r = results.redemptions;
  const statusTone = results.campaign.status === "queued" ? "green" : results.campaign.status === "approved" ? "cyan" : "gray";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-slate-500">Campaign activity</p>
          <h1 className="mt-1 font-mono text-xl font-extrabold text-navy">
            {results.campaign.id} · v{results.campaign.version}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={statusTone}>status: {results.campaign.status}</Badge>
          <Badge tone={results.campaign.aiMode === "live" ? "green" : "cyan"}>AI: {results.campaign.aiMode}</Badge>
          <Badge tone="gray">valid until {formatDateTime(results.campaign.expiresAt)} IST</Badge>
        </div>
      </div>

      {notice ? <Alert tone={notice.tone} title={notice.text} /> : null}

      {/* Offer terms */}
      <Card className="p-5">
        <h2 className="text-base font-bold text-navy">Approved terms</h2>
        <div className="mt-2 divide-y divide-slate-100">
          <Stat label="Offer">{`${results.campaign.offer.bundleName} at ${formatINR(results.campaign.offer.pricePaise)} (usual ${formatINR(
            results.campaign.offer.normalPricePaise
          )})`}</Stat>
          <Stat label="Cap / max exposure">{`${results.campaign.offer.cap}/day / ${formatINR(results.campaign.offer.maxDiscountExposurePaise)}`}</Stat>
          <Stat label="Customer message">
            &quot;{results.campaign.copy.body}&quot;
          </Stat>
          <Stat label="Approved at">{results.campaign.approvedAt ? formatDateTime(results.campaign.approvedAt) : "not approved"}</Stat>
        </div>
      </Card>

      {/* Simulated outbox */}
      <Card data-tour="outbox" className="ms-rise p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-bold text-navy">Simulated outbox</h2>
          <Badge tone="gray">{results.outbox.queued} recipients - simulated, never sent</Badge>
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-400">
                <th className="py-2 pr-4">Customer</th>
                <th className="hidden py-2 pr-4 sm:table-cell">Demo address (non-deliverable)</th>
                <th className="py-2 pr-4">Channel</th>
                <th className="py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {results.outbox.sample.map((row) => (
                <tr key={row.customerId} className="border-b border-slate-100">
                  <td className="py-2 pr-4 font-medium text-navy">
                    {row.label} <span className="text-xs text-slate-400">({row.customerId})</span>
                  </td>
                  <td className="hidden py-2 pr-4 font-mono text-xs text-slate-500 sm:table-cell">{row.demoChannelId}</td>
                  <td className="py-2 pr-4">{row.channel}</td>
                  <td className="py-2">{row.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {results.outbox.queued > results.outbox.sample.length ? (
            <p className="mt-2 text-xs text-slate-400">+ {results.outbox.queued - results.outbox.sample.length} more recipients</p>
          ) : null}
        </div>
      </Card>

      {/* Redemption simulator + results */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card data-tour="events" className="ms-rise p-5">
          <h2 className="text-base font-bold text-navy">Apply simulated redemption events</h2>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">
            Fixed fixture events for the next weekday afternoon (3-6 p.m.). Repeat events are idempotent; the cap is
            enforced atomically.
          </p>
          <div className="mt-3">
            <Meter
              ariaLabel={`${r.redemptions} of a maximum ${r.cap} redemptions used`}
              label="Cap utilization"
              valueLabel={`${r.redemptions} / ${r.cap}`}
              value={r.redemptions}
              max={Math.max(r.cap, 1)}
              tone={r.redemptions >= r.cap ? "warn" : "good"}
            />
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={redeemAll} disabled={busy} data-testid="apply-all" className="btn-primary">
              {busy ? "Applying..." : "Apply all 10 events"}
            </button>
            <button type="button" onClick={() => redeem("R-003")} disabled={busy} data-testid="reapply-dup" className="btn-secondary">
              Re-apply R-003 (duplicate demo)
            </button>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {results.availableEvents.map((ev) => {
              const used = r.events.some((e) => e.eventId === ev.eventId);
              return (
                <button
                  key={ev.eventId}
                  type="button"
                  onClick={() => redeem(ev.eventId)}
                  disabled={busy || used}
                  className={`rounded-lg border px-2 py-1 text-xs font-semibold transition ${
                    used ? "border-emerald-200 bg-emerald-50 text-emerald-600" : "border-slate-200 text-slate-600 hover:bg-brand-light"
                  }`}
                  title={`Customer ${ev.customerId}`}
                >
                  {ev.eventId} {used ? "\u2713" : ""}
                </button>
              );
            })}
          </div>
        </Card>

        <Card data-tour="money" className="ms-pop border-brand bg-brand-light p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-navy">Results</h2>
            <Badge tone="navy">Simulated campaign outcomes</Badge>
          </div>
          <div className="mt-4 grid grid-cols-3 items-end gap-2 text-center">
            <div>
              <p className="text-3xl font-extrabold text-navy">
                <CountUp value={r.revenuePaise} format={(v) => formatINR(Math.round(v))} />
              </p>
              <p className="mt-1 text-xs text-slate-600">Bundle sales</p>
            </div>
            <div>
              <p className="text-3xl font-extrabold text-navy">
                -<CountUp value={r.variableCostPaise} format={(v) => formatINR(Math.round(v))} />
              </p>
              <p className="mt-1 text-xs text-slate-600">Ingredients &amp; packaging</p>
            </div>
            <div>
              <p className="text-3xl font-extrabold text-accent">
                <CountUp value={r.contributionPaise} format={(v) => formatINR(Math.round(v))} />
              </p>
              <p className="mt-1 text-xs text-slate-600">Contribution toward fixed costs</p>
            </div>
          </div>
          {r.revenuePaise > 0 ? (
            <div className="mt-4 rounded-2xl bg-white/70 p-4">
              <p className="mb-3 text-xs font-bold uppercase tracking-widest text-slate-500">Where the money went</p>
              <WaterfallChart
                ariaLabel={`Bundle sales ${formatINR(r.revenuePaise)}, variable cost ${formatINR(r.variableCostPaise)}, contribution ${formatINR(r.contributionPaise)}`}
                steps={[
                  { label: "Bundle sales", fromRupees: 0, toRupees: r.revenuePaise / 100, valueLabel: formatINR(r.revenuePaise), tone: "brand" },
                  {
                    label: "Ingredients & packaging",
                    fromRupees: r.revenuePaise / 100,
                    toRupees: (r.revenuePaise - r.variableCostPaise) / 100,
                    valueLabel: `-${formatINR(r.variableCostPaise)}`,
                    tone: "bad",
                  },
                  {
                    label: "= Contribution",
                    fromRupees: 0,
                    toRupees: r.contributionPaise / 100,
                    valueLabel: formatINR(r.contributionPaise),
                    tone: "good",
                  },
                ]}
              />
            </div>
          ) : null}
          <div className="mt-4 divide-y divide-slate-200/60">
            <Stat label="Unique redemptions">{`${r.redemptions} of cap ${r.cap}`}</Stat>
            <Stat label="Discount given">{formatINR(r.discountPaise)}</Stat>
          </div>
          <button type="button" onClick={downloadSummary} className="btn-secondary mt-4 w-full">
            Download summary (.txt)
          </button>
        </Card>
      </div>

      {/* Caveats + audit */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="text-base font-bold text-navy">Read before quoting these numbers</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-relaxed text-slate-600">
            {results.caveats.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </Card>
        <Card className="p-5">
          <h2 className="text-base font-bold text-navy">Audit trail</h2>
          <ul className="mt-2 space-y-1.5 text-xs text-slate-600">
            {results.auditTrail.map((a, i) => (
              <li key={`${a.entityId}-${a.action}-${i}`} className="flex flex-wrap gap-2">
                <span className="font-mono text-slate-400">{formatDateTime(a.timestamp)}</span>
                <span className="font-semibold text-navy">{a.action}</span>
                <span className="font-mono text-slate-500">{a.entityId}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
