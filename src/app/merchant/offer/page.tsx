"use client";

import { useEffect, useState } from "react";
import {
  api,
  ApiClientError,
  type ApproveResponseDto,
  type DraftResponseDto,
  type ExecuteResponseDto,
} from "@/lib/client";
import { formatDateTime, formatINR, formatPct } from "@/lib/format";
import { Alert, Badge, Card, Stat } from "@/components/ui";
import EvidenceDrawer from "@/components/evidence-drawer";

const OPPORTUNITY_ID = "afternoon-decline-v1";

export default function OfferWorkspacePage() {
  const [priceInput, setPriceInput] = useState("70");
  const [capInput, setCapInput] = useState("20");
  const [copyTitle, setCopyTitle] = useState("");
  const [copyBody, setCopyBody] = useState("");

  const [draft, setDraft] = useState<DraftResponseDto | null>(null);
  const [approved, setApproved] = useState<ApproveResponseDto | null>(null);
  const [executed, setExecuted] = useState<ExecuteResponseDto | null>(null);

  const [busy, setBusy] = useState<"" | "draft" | "approve" | "execute">("");
  const [error, setError] = useState<string | null>(null);

  const pricePaise = parseRupees(priceInput);
  const cap = Number.parseInt(capInput, 10);
  const termsDirty =
    draft !== null && (pricePaise === null || cap === null || pricePaise !== draft.offer.pricePaise || cap !== draft.offer.cap);
  const copyDirtyExact = draft !== null && (copyTitle !== draft.copy.title || copyBody !== draft.copy.body);

  useEffect(() => {
    if (draft) {
      setCopyTitle(draft.copy.title);
      setCopyBody(draft.copy.body);
    }
  }, [draft]);

  async function prepareDraft(saveCopy = false) {
    if (pricePaise === null) {
      setError("Enter a valid price in rupees, e.g. 70.");
      return;
    }
    if (!Number.isInteger(cap) || cap < 0) {
      setError("Enter a valid whole-number redemption cap.");
      return;
    }
    setBusy("draft");
    setError(null);
    try {
      const result = await api<DraftResponseDto>("/api/campaigns/draft", {
        method: "POST",
        body: JSON.stringify({
          campaignId: draft?.campaignId,
          opportunityId: OPPORTUNITY_ID,
          offer: { pricePaise, cap },
          locale: "en",
          ...(saveCopy ? { copyOverride: { title: copyTitle, body: copyBody } } : {}),
        }),
      });
      setDraft(result);
      setApproved(null);
      setExecuted(null);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Draft failed.");
    } finally {
      setBusy("");
    }
  }

  async function approve() {
    if (!draft) return;
    setBusy("approve");
    setError(null);
    try {
      const result = await api<ApproveResponseDto>(`/api/campaigns/${draft.campaignId}/approve`, {
        method: "POST",
        body: JSON.stringify({ version: draft.version, previewHash: draft.previewHash }),
      });
      setApproved(result);
    } catch (err) {
      setError(err instanceof ApiClientError ? `${err.message} (${err.code})` : "Approval failed.");
    } finally {
      setBusy("");
    }
  }

  async function execute() {
    if (!draft) return;
    setBusy("execute");
    setError(null);
    try {
      const result = await api<ExecuteResponseDto>(`/api/campaigns/${draft.campaignId}/execute`, {
        method: "POST",
        body: JSON.stringify({ version: draft.version }),
      });
      setExecuted(result);
    } catch (err) {
      setError(err instanceof ApiClientError ? `${err.message} (${err.code})` : "Queueing failed.");
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-bold uppercase tracking-widest text-slate-500">Offer workspace</p>
        <h1 className="mt-1 text-2xl font-extrabold text-navy">Design the offer, see the math live</h1>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-600">
          Every suggestion ships with the numbers behind it. Change a term and the check updates before anything is
          queued. Try an unsafe price (e.g. <button type="button" className="font-semibold text-brand underline" onClick={() => setPriceInput("50")}>₹50</button>) to see the margin floor reject it.
        </p>
      </div>

      {error ? <Alert tone="error" title={error} /> : null}

      <div className="grid gap-6 lg:grid-cols-5">
        {/* Inputs + live check */}
        <Card className="p-5 lg:col-span-2">
          <h2 className="text-base font-bold text-navy">Terms</h2>
          <div className="mt-4 space-y-4">
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Bundle (fixed in this demo)</span>
              <input value="Two samosas + one tea (2 x ₹35 + 1 x ₹20)" disabled readOnly className="mt-1 w-full" />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Offer price (₹)</span>
                <input
                  value={priceInput}
                  onChange={(e) => setPriceInput(e.target.value)}
                  inputMode="decimal"
                  className="mt-1 w-full"
                  aria-label="Offer price in rupees"
                />
              </label>
              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Redemption cap / day</span>
                <input value={capInput} onChange={(e) => setCapInput(e.target.value)} inputMode="numeric" className="mt-1 w-full" aria-label="Redemption cap" />
              </label>
            </div>
            <button type="button" onClick={() => prepareDraft(false)} disabled={busy !== ""} className="btn-primary w-full">
              {busy === "draft" ? "Computing..." : draft ? "Update draft (new version)" : "Prepare offer draft"}
            </button>
            <p className="text-xs leading-relaxed text-slate-400">
              Server-side code computes margin, stock capacity and exposure. The AI only drafts explanations and copy -
              it can never set prices or caps.
            </p>
          </div>

          {draft ? (
            <div className="mt-5 border-t border-slate-100 pt-4">
              <h3 className="text-sm font-bold text-navy">Live check - v{draft.version}</h3>
              <div className="mt-1 divide-y divide-slate-100">
                <Stat label="Usual combined price">{formatINR(draft.offer.normalPricePaise)}</Stat>
                <Stat label="Variable cost / bundle">{draft.computed.bundleCostPaise !== null ? formatINR(draft.computed.bundleCostPaise) : "cannot calculate"}</Stat>
                <Stat label="Contribution / bundle">
                  {draft.computed.contributionPaise !== null ? formatINR(draft.computed.contributionPaise) : "-"}
                </Stat>
                <Stat label="Contribution margin">
                  {draft.computed.marginPct !== null ? formatPct(draft.computed.marginPct) : "-"}{" "}
                  <span className="text-slate-400">(floor {draft.computed.floorPct}%)</span>
                </Stat>
                <Stat label="Discount">{formatINR(draft.offer.discountPaise)} ({formatPct(draft.offer.discountPct)})</Stat>
                <Stat label="Stock capacity">{draft.computed.capacity} bundles</Stat>
                <Stat label="Max discount exposure">
                  {formatINR(draft.computed.maxDiscountExposurePaise)}{" "}
                  <span className="text-slate-400">({draft.computed.atCap?.bundles ?? 0} bundles at cap)</span>
                </Stat>
                <Stat label="At cap: revenue - cost = contribution">
                  {draft.computed.atCap
                    ? `${formatINR(draft.computed.atCap.revenuePaise)} - ${formatINR(draft.computed.atCap.variableCostPaise)} = ${formatINR(
                        draft.computed.atCap.contributionPaise
                      )}`
                    : "-"}
                </Stat>
              </div>

              {draft.computed.passes ? (
                <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-semibold text-emerald-700">
                  Passes the {draft.computed.floorPct}% margin floor and stock checks.
                </div>
              ) : (
                <div className="mt-3 space-y-1 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm text-rose-700">
                  {draft.computed.violations.map((v) => (
                    <p key={v} className="font-semibold">
                      {v}
                    </p>
                  ))}
                </div>
              )}
            </div>
          ) : null}
        </Card>

        {/* AI draft + approval */}
        <div className="space-y-6 lg:col-span-3">
          {draft ? (
            <>
              <Card className="p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-base font-bold text-navy">AI draft - explanation &amp; customer message</h2>
                  <div className="flex gap-2">
                    <Badge tone={draft.aiMode === "live" ? "green" : draft.aiMode === "fallback" ? "amber" : "cyan"}>
                      AI mode: {draft.aiMode === "live" ? "live model" : draft.aiMode === "fallback" ? "fallback (labeled)" : "fixture"}
                    </Badge>
                    <Badge tone="gray">copy: {draft.copySource}</Badge>
                  </div>
                </div>
                {draft.aiNote ? (
                  <div className="mt-3">
                    <Alert tone="warn" title="Honest fallback">
                      <p className="text-xs">{draft.aiNote}</p>
                    </Alert>
                  </div>
                ) : null}
                <h3 className="mt-4 text-sm font-bold text-navy">{draft.headline}</h3>
                <p className="mt-1 text-sm leading-relaxed text-slate-700">{draft.explanation}</p>
                <div className="mt-4 space-y-3">
                  <label className="block">
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Copy title (editable)</span>
                    <input value={copyTitle} onChange={(e) => setCopyTitle(e.target.value)} className="mt-1 w-full" />
                  </label>
                  <label className="block">
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Copy body (editable)</span>
                    <textarea value={copyBody} onChange={(e) => setCopyBody(e.target.value)} rows={3} className="mt-1 w-full" />
                  </label>
                  {copyDirtyExact ? (
                    <button type="button" onClick={() => prepareDraft(true)} disabled={busy !== ""} className="btn-secondary">
                      Save copy into a new draft version
                    </button>
                  ) : (
                    <p className="text-xs text-slate-400">
                      Copy matches the approved draft. Monetary terms always render from computed fields - model or owner
                      text cannot change prices, caps or dates.
                    </p>
                  )}
                </div>
                <div className="mt-4">
                  <p className="text-xs font-bold uppercase tracking-widest text-slate-500">Assumptions the AI must state</p>
                  <ul className="mt-1 list-disc pl-5 text-xs leading-relaxed text-slate-600">
                    {draft.assumptions.map((a) => (
                      <li key={a}>{a}</li>
                    ))}
                  </ul>
                </div>
                <div className="mt-4">
                  <EvidenceDrawer evidence={draft.evidence} />
                </div>
              </Card>

              {/* Approval preview */}
              <Card className="p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-base font-bold text-navy">Approval preview - exact version</h2>
                  <Badge tone={approved ? "green" : "gray"}>
                    {approved ? `approved (${formatDateTime(approved.approvedAt)})` : "awaiting approval"}
                  </Badge>
                </div>
                <div className="mt-2 divide-y divide-slate-100">
                  <Stat label="Offer">{`${draft.offer.bundleName} at ${formatINR(draft.offer.pricePaise)} (usual ${formatINR(
                    draft.offer.normalPricePaise
                  )})`}</Stat>
                  <Stat label="Validity">{`${draft.validityLabel} (until ${formatDateTime(draft.expiresAt)} IST)`}</Stat>
                  <Stat label="Redemption cap">{`${draft.offer.cap} / day`}</Stat>
                  <Stat label="Max discount exposure">{formatINR(draft.offer.maxDiscountExposurePaise)}</Stat>
                  <Stat label="Audience">{`${draft.audience.eligibleCount} eligible (${draft.audience.channel} consent) - ${draft.audience.excludedCount} excluded`}</Stat>
                  <Stat label="Execution mode">Simulated outbox only - nothing is ever really sent</Stat>
                  <Stat label="Preview hash">
                    <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px]">{draft.previewHash.slice(0, 16)}...</code>
                  </Stat>
                </div>

                {termsDirty ? (
                  <div className="mt-3">
                    <Alert tone="warn" title="Terms changed since this draft">
                      <p className="text-xs">Update the draft to bind a fresh preview before approving.</p>
                    </Alert>
                  </div>
                ) : null}

                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={approve}
                    disabled={busy !== "" || termsDirty || !draft.computed.passes || Boolean(executed)}
                    className="btn-secondary"
                  >
                    {busy === "approve" ? "Approving..." : "Approve this exact version"}
                  </button>
                  <button
                    type="button"
                    onClick={execute}
                    disabled={busy !== "" || !approved || termsDirty}
                    className="btn-primary"
                  >
                    {busy === "execute" ? "Queueing..." : "Queue simulated campaign"}
                  </button>
                  {executed ? (
                    <a href={`/campaigns/${draft.campaignId}`} className="btn-primary">
                      View campaign activity ({executed.count} recipients)
                    </a>
                  ) : null}
                </div>
                {!draft.computed.passes ? (
                  <p className="mt-2 text-xs text-rose-600">Fix the violations above - unprofitable offers cannot be approved or queued.</p>
                ) : null}
                <p className="mt-2 text-xs text-slate-400">
                  The button says &quot;Queue simulated campaign&quot; - never &quot;send&quot;. Any change to price, audience,
                  stock or terms invalidates this preview (409 on approve).
                </p>
              </Card>
            </>
          ) : (
            <Card className="flex min-h-64 items-center justify-center p-8 text-center">
              <p className="max-w-sm text-sm text-slate-500">
                Prepare a draft to see the grounded AI explanation, the exact offer math, and the approval preview.
              </p>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function parseRupees(input: string): number | null {
  const raw = input.trim().replace(/[,\u20B9\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) return null;
  return Math.round(parseFloat(raw) * 100);
}
