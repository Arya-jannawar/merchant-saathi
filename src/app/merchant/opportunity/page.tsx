"use client";

import { useEffect, useState } from "react";
import { api, ApiClientError, type OpportunitiesDto } from "@/lib/client";
import { formatDelta, formatINR } from "@/lib/format";
import { Alert, Badge, Card } from "@/components/ui";
import EvidenceDrawer from "@/components/evidence-drawer";
import { useSaathi } from "@/components/saathi-provider";

export default function OpportunityPage() {
  const [data, setData] = useState<OpportunitiesDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const saathi = useSaathi();

  useEffect(() => {
    api<OpportunitiesDto>("/api/opportunities")
      .then(setData)
      .catch((err) => {
        setError(err instanceof ApiClientError ? err.message : "Could not load opportunities.");
        saathi.react("sad", "error");
      });
  }, [saathi]);

  if (error) return <Alert tone="error" title={error} />;
  if (!data) return <p className="py-16 text-center text-sm text-slate-500">Loading opportunity...</p>;

  const item = data.items[0];

  return (
    <div className="space-y-6">
      <div className="ms-rise">
        <p className="text-xs font-bold uppercase tracking-widest text-slate-500">Opportunity details</p>
        <h1 className="mt-1 text-2xl font-extrabold text-navy">Afternoon decline, in plain language</h1>
        <div className="mt-2 flex flex-wrap gap-2">
          <Badge tone="blue">Fixture {data.fixtureVersion}</Badge>
          <Badge tone="gray">
            Windows compared: {data.windowLabels.previous} vs {data.windowLabels.current}
          </Badge>
          <Badge tone="gray">Both windows complete Mon-Fri, 3-6 p.m. IST</Badge>
        </div>
      </div>

      {!item ? (
        <div className="ms-pop">
          <Alert
            tone="warn"
            title="Insufficient evidence for a recommendation"
          >
            <p>{data.lowDataReason}</p>
            <p className="mt-2 text-xs">
              Eligibility requires both windows complete with at least {data.eligibility.minOrdersRequired} completed
              afternoon orders and a decline of {data.eligibility.declineThresholdPct}% or more. This is a demo heuristic,
              not a statistical test.
            </p>
          </Alert>
        </div>
      ) : (
        <>
          <Card className="ms-rise p-5">
            <p className="text-sm leading-relaxed text-slate-700">{item.observation}</p>
            <p className="mt-3 text-xs leading-relaxed text-slate-500">
              Sample: {data.eligibility.previousOrders} completed afternoon orders in the earlier window vs{" "}
              {data.eligibility.currentOrders} in the recent one ({formatDelta(data.eligibility.declinePct)}). Two
              five-day windows support a testable suggestion - they do not prove why orders changed.
            </p>
          </Card>

          {/* Comparison chart - derived from records */}
          <Card data-tour="comparison" className="ms-rise p-5">
            <p className="text-xs font-bold uppercase tracking-widest text-slate-500">Completed 3-6 p.m. orders per window</p>
            <div className="mt-4 space-y-4">
              {[
                { label: item.windows.previous.label, orders: item.windows.previous.orders, net: item.windows.previous.netSalesPaise, dark: true },
                { label: item.windows.current.label, orders: item.windows.current.orders, net: item.windows.current.netSalesPaise, dark: false },
              ].map((row, i) => (
                <div key={row.label}>
                  <div className="mb-1 flex items-baseline justify-between text-sm">
                    <span className="font-semibold text-navy">{row.label}</span>
                    <span className="text-slate-600">
                      {row.orders} orders - {formatINR(row.net)} net
                    </span>
                  </div>
                  <div className="h-9 overflow-hidden rounded-lg bg-slate-100">
                    <div
                      className={`h-full rounded-lg transition-all duration-700 ${row.dark ? "bg-navy" : "bg-accent"}`}
                      style={{
                        width: `${Math.max((row.orders / Math.max(item.windows.previous.orders, item.windows.current.orders, 1)) * 100, 2)}%`,
                        transitionDelay: `${i * 160}ms`,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <div data-tour="evidence-button" className="ms-rise">
            <EvidenceDrawer evidence={item.evidence} />
          </div>

          <Card className="ms-rise p-5">
            <p className="text-xs font-bold uppercase tracking-widest text-slate-500">What this evidence does NOT say</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-600">
              {item.limitations.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          </Card>

          <div data-tour="cta-offer" className="ms-rise flex justify-end">
            <a href="/merchant/offer" className="btn-primary !px-6 !py-3 text-base">
              Build an offer for this opportunity
            </a>
          </div>
        </>
      )}
    </div>
  );
}

