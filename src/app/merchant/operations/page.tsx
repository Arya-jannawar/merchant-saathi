"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiClientError, type DemoStateDto, type OperationsDto } from "@/lib/client";
import { formatINR } from "@/lib/format";
import { Alert, Badge, Card } from "@/components/ui";
import { CountUp, DonutChart } from "@/components/charts";
import { useSaathi } from "@/components/saathi-provider";

const STATUS_STYLE: Record<string, { chip: string; label: string }> = {
  out: { chip: "bg-slate-200 text-slate-600", label: "Out of stock" },
  critical: { chip: "bg-rose-100 text-rose-700 border border-rose-200", label: "Critical" },
  low: { chip: "bg-amber-100 text-amber-800 border border-amber-200", label: "Low" },
  healthy: { chip: "bg-emerald-50 text-emerald-700 border border-emerald-200", label: "Healthy" },
};

export default function OperationsPage() {
  const [ops, setOps] = useState<OperationsDto | null>(null);
  const [state, setState] = useState<DemoStateDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const saathi = useSaathi();

  const load = useCallback(async () => {
    try {
      const [o, s] = await Promise.all([api<OperationsDto>("/api/operations"), api<DemoStateDto>("/api/demo/state")]);
      setOps(o);
      setState(s);
      const low = o.lines.filter((l) => l.status !== "healthy").length;
      saathi.say(
        low === 0
          ? "Stock looks healthy across the board - nothing needs restocking before the weekend. 🧰"
          : `${low} SKU${low === 1 ? "" : "s"} need attention before the weekend. The restock plan below has the numbers.`,
        { mood: low === 0 ? "happy" : "thinking" }
      );
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not reach the operations API.");
      saathi.react("sad", "error");
    }
  }, [saathi]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) {
    return (
      <div className="space-y-4">
        <Alert tone="error" title={error} />
        <button type="button" onClick={() => void load()} className="btn-secondary">
          Retry
        </button>
      </div>
    );
  }
  if (!ops || !state) return <p className="py-16 text-center text-sm text-slate-500">Reading the stockroom…</p>;

  const lowCount = ops.lines.filter((l) => l.status !== "healthy").length;

  return (
    <div className="space-y-6">
      <div className="ms-rise">
        <p className="text-xs font-bold uppercase tracking-widest text-slate-500">Operations copilot</p>
        <h1 className="mt-1 text-2xl font-extrabold text-navy">
          Manage the stockroom, not just the sales 🧰
        </h1>
        <div className="mt-2 flex flex-wrap gap-2">
          <Badge tone="blue">
            {state.merchant?.domain.emoji} {state.merchant?.domain.label}
          </Badge>
          <Badge tone="gray">Run-rate window: {ops.windowLabel}</Badge>
          <Badge tone="gray">Target cover: {ops.targetCoverDays} days</Badge>
          <Badge tone="cyan">Advisory only - nothing is ordered automatically</Badge>
        </div>
      </div>

      {/* copilot briefing */}
      <Card className="ms-rise p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-bold uppercase tracking-widest text-slate-500">Copilot briefing</p>
          <Badge tone="cyan">computed from real rows · AI narrates, never invents</Badge>
        </div>
        <ul className="mt-3 space-y-2">
          {ops.briefing.map((line, i) => (
            <li key={i} className="ms-stagger flex gap-2 text-sm leading-relaxed text-slate-700">
              <span aria-hidden className="text-accent">▸</span>
              {line}
            </li>
          ))}
        </ul>
        {ops.restockTotalUnits > 0 ? (
          <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
            <p className="text-sm font-bold text-amber-900">
              Suggested restock plan: <CountUp value={ops.restockTotalUnits} format={(v) => `${Math.round(v)} units`} /> ·{" "}
              estimated cost{" "}
              <CountUp value={ops.restockTotalCostPaise} format={(v) => formatINR(Math.round(v))} />
            </p>
            <p className="mt-1 text-[11px] text-amber-800">
              Estimated at current unit costs from the inventory table. Review with your supplier - the copilot
              advises, you decide.
            </p>
          </div>
        ) : null}
      </Card>

      {/* stock health */}
      <Card className="ms-rise p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-bold uppercase tracking-widest text-slate-500">Stock health by SKU</p>
          {lowCount > 0 ? <Badge tone="red">{lowCount} to watch</Badge> : <Badge tone="green">All healthy</Badge>}
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-400">
                <th className="py-2 pr-4">SKU</th>
                <th className="py-2 pr-4">Stock</th>
                <th className="py-2 pr-4">Sold/day</th>
                <th className="py-2 pr-4">Days of cover</th>
                <th className="py-2 pr-4">Campaign draw</th>
                <th className="py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {ops.lines.map((l) => (
                <tr key={l.skuId} className="border-b border-slate-100">
                  <td className="py-2.5 pr-4 font-semibold text-navy">{l.skuName}</td>
                  <td className="py-2.5 pr-4 font-bold text-navy">{l.stock}</td>
                  <td className="py-2.5 pr-4 text-slate-600">{l.dailyRate ?? "—"}</td>
                  <td className="py-2.5 pr-4 text-slate-600">
                    {l.daysOfCover ?? "no recent sales"}
                    {l.daysOfCover !== null ? " d" : ""}
                  </td>
                  <td className="py-2.5 pr-4 text-slate-600">
                    {l.campaignDrawDown > 0 ? `-${l.campaignDrawDown} queued` : "—"}
                  </td>
                  <td className="py-2.5">
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${STATUS_STYLE[l.status].chip}`}>
                      {STATUS_STYLE[l.status].label}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-slate-400">
          Days of cover = current stock ÷ units sold per day in {ops.windowLabel}. The queued campaign can still draw
          bundle components - the projected column already accounts for it.
        </p>
      </Card>

      {/* restock plan */}
      {ops.lines.some((l) => l.restockUnits > 0) ? (
        <Card className="ms-pop border-amber-200 p-5">
          <p className="text-xs font-bold uppercase tracking-widest text-slate-500">Suggested restock plan</p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-400">
                  <th className="py-2 pr-4">SKU</th>
                  <th className="py-2 pr-4">Restock units</th>
                  <th className="py-2">Estimated cost</th>
                </tr>
              </thead>
              <tbody>
                {ops.lines
                  .filter((l) => l.restockUnits > 0)
                  .map((l) => (
                    <tr key={l.skuId} className="border-b border-slate-100">
                      <td className="py-2.5 pr-4 font-semibold text-navy">{l.skuName}</td>
                      <td className="py-2.5 pr-4 font-bold text-navy">+{l.restockUnits}</td>
                      <td className="py-2.5 font-semibold text-slate-700">{formatINR(l.restockCostPaise)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      {/* serve pillar */}
      <div className="ms-stagger grid gap-4 md:grid-cols-2">
        <Card className="p-5">
          <p className="text-xs font-bold uppercase tracking-widest text-slate-500">Serve customers better · consent health</p>
          <div className="mt-4">
            <DonutChart
              ariaLabel={`${ops.serve.consents.active} active consents, ${ops.serve.consents.revoked} revoked, ${ops.serve.consents.none} never captured`}
              segments={[
                { value: ops.serve.consents.active, label: "Active consent", color: "#00b9f1" },
                { value: ops.serve.consents.revoked, label: "Revoked", color: "#f43f5e" },
                { value: ops.serve.consents.none, label: "Never captured", color: "#cbd5e1" },
              ]}
              centerValue={`${ops.serve.consents.active}`}
              centerLabel="reachable"
            />
          </div>
          <p className="mt-3 text-sm leading-relaxed text-slate-600">
            Campaigns reach only customers with an active {ops.serve.consents.channel} consent. Revoked or missing
            consent is respected automatically - serving customers better starts with serving them only what they
            agreed to.
          </p>
        </Card>
        <Card className="p-5">
          <p className="text-xs font-bold uppercase tracking-widest text-slate-500">Serve customers better · redemption champions</p>
          {ops.serve.champions.length > 0 ? (
            <ul className="mt-3 space-y-2">
              {ops.serve.champions.map((c) => (
                <li key={c.demoChannelId} className="flex items-center justify-between rounded-xl bg-brand-light px-3 py-2">
                  <div>
                    <p className="text-sm font-bold text-navy">{c.label}</p>
                    <p className="text-[11px] text-slate-500">{c.demoChannelId} (non-deliverable demo id)</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-extrabold text-accent">{c.units}×</p>
                    <p className="text-[11px] text-slate-500">{formatINR(c.spendPaise)}</p>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-slate-600">
              No simulated redemptions recorded yet - queue a campaign and apply events to see which customers love the
              offer most.
            </p>
          )}
          <p className="mt-3 text-[11px] leading-relaxed text-slate-400">
            Simulated demo customers - the pattern is what matters: consent-first targeting, then rewarding the
            regulars who actually show up.
          </p>
        </Card>
      </div>
    </div>
  );
}
