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
import type { DemoStateDto } from "@/lib/client";
import { Alert, Badge, Card, Stat } from "@/components/ui";
import EvidenceDrawer from "@/components/evidence-drawer";
import { Meter } from "@/components/charts";
import { useSaathi } from "@/components/saathi-provider";

const OPPORTUNITY_ID = "afternoon-decline-v1";

export default function OfferWorkspacePage() {
  const [priceInput, setPriceInput] = useState("70");
  const [capInput, setCapInput] = useState("20");
  const [locale, setLocale] = useState<"en" | "hi">("en");
  const [copyTitle, setCopyTitle] = useState("");
  const [copyBody, setCopyBody] = useState("");

  const [draft, setDraft] = useState<DraftResponseDto | null>(null);
  const [approved, setApproved] = useState<ApproveResponseDto | null>(null);
  const [executed, setExecuted] = useState<ExecuteResponseDto | null>(null);

  const [busy, setBusy] = useState<"" | "draft" | "approve" | "execute">("");
  const [error, setError] = useState<string | null>(null);
  const [bundleHint, setBundleHint] = useState("Loading bundle…");
  const saathi = useSaathi();

  useEffect(() => {
    api<DemoStateDto>("/api/demo/state")
      .then((s) => setBundleHint(`${s.merchant?.domain.emoji ?? "🧁"} ${s.bundleHint}`))
      .catch(() => setBundleHint("Bundle (from your domain fixture)"));
  }, []);

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
          locale,
          ...(saveCopy ? { copyOverride: { title: copyTitle, body: copyBody } } : {}),
        }),
      });
      setDraft(result);
      setApproved(null);
      setExecuted(null);
      if (result.computed.passes) {
        saathi.say(`${formatINR(result.computed.pricePaise)} clears the ${result.computed.floorPct}% floor with ${formatPct(result.computed.marginPct)} margin. Good instinct!`, {
          mood: "happy",
          sound: "success",
        });
      } else {
        saathi.say(
          `Stop! ${formatINR(result.computed.pricePaise)} fails the margin check - the approve button stays locked, by design. The red banner has the details.`,
          { mood: "sad", sound: "warn" }
        );
      }
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Draft failed.");
      saathi.react("sad", "error");
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
      saathi.say(`Approved and hash-bound! v${result.approvedVersion} is locked - any change now invalidates it.`, {
        mood: "excited",
        sound: "success",
      });
    } catch (err) {
      const msg = err instanceof ApiClientError ? `${err.message} (${err.code})` : "Approval failed.";
      setError(msg);
      saathi.say(`The approve was refused: ${msg}. Usually it is a stale preview - press "Update draft" first.`, {
        mood: "sad",
        sound: "warn",
      });
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
      saathi.say(`${result.count} consented demo customers are in the simulated outbox. Nothing real was sent!`, {
        mood: "excited",
        sound: "celebrate",
      });
    } catch (err) {
      const msg = err instanceof ApiClientError ? `${err.message} (${err.code})` : "Queueing failed.";
      setError(msg);
      saathi.say(`Queueing was refused: ${msg}. The control loop did its job.`, { mood: "sad", sound: "warn" });
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
          queued. Try an unsafe price (e.g.{" "}
          <button type="button" data-testid="try-50" className="font-semibold text-brand underline" onClick={() => { setPriceInput("50"); saathi.say("₹50? Bold. Now press 'Update draft' and watch the floor check refuse it. 😱", { mood: "thinking" }); }}>
            ₹50
          </button>
          , then back to{" "}
          <button type="button" data-testid="try-70" className="font-semibold text-brand underline" onClick={() => { setPriceInput("70"); saathi.say("Back to ₹70 - the safe zone. Draft it and watch the math turn green.", { mood: "happy" }); }}>
            ₹70
          </button>
          ) to see the margin floor reject it.
        </p>
      </div>

      {error ? <Alert tone="error" title={error} /> : null}

      <div className="grid gap-6 lg:grid-cols-5">
        {/* Inputs + live check */}
        <Card data-tour="terms" className="p-5 lg:col-span-2">
          <h2 className="text-base font-bold text-navy">Terms</h2>
          <div className="mt-4 space-y-4">
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Bundle (fixed by your domain fixture)</span>
              <input value={bundleHint} disabled readOnly className="mt-1 w-full" />
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
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Customer message language</span>
              <select
                value={locale}
                onChange={(e) => setLocale(e.target.value === "hi" ? "hi" : "en")}
                className="mt-1 w-full"
                aria-label="Customer message language"
              >
                <option value="en">English</option>
                <option value="hi">हिन्दी (Hindi)</option>
              </select>
            </label>
            <button
              type="button"
              onClick={() => prepareDraft(false)}
              disabled={busy !== ""}
              data-testid="prepare-draft"
              className="btn-primary w-full"
            >
              {busy === "draft" ? "Computing..." : draft ? "Update draft (new version)" : "Prepare offer draft"}
            </button>
            <p className="text-xs leading-relaxed text-slate-400">
              Server-side code computes margin, stock capacity and exposure. The AI only drafts explanations and copy -
              it can never set prices or caps. Changing the language requires an update to regenerate the draft copy.
            </p>
          </div>

          {draft ? (
            <div data-tour="economics" className="ms-pop mt-5 border-t border-slate-100 pt-4">
              <h3 className="text-sm font-bold text-navy">Live check - v{draft.version}</h3>
              {draft.computed.marginPct !== null ? (
                <div className="mt-3">
                  <Meter
                    ariaLabel={`Contribution margin ${formatPct(draft.computed.marginPct)} against a ${draft.computed.floorPct}% floor`}
                    label={`Margin ${formatPct(draft.computed.marginPct)}`}
                    valueLabel={draft.computed.passes ? "above floor" : "below floor!"}
                    value={draft.computed.marginPct}
                    max={Math.max(draft.computed.marginPct * 1.25, draft.computed.floorPct * 1.6, 30)}
                    markerPct={(draft.computed.floorPct / Math.max(draft.computed.marginPct * 1.25, draft.computed.floorPct * 1.6, 30)) * 100}
                    markerLabel={`25% margin floor`}
                    tone={draft.computed.passes ? "good" : "bad"}
                  />
                </div>
              ) : null}
              {draft.computed.bundleCostPaise !== null ? (
                <div className="mt-3">
                  <Meter
                    ariaLabel={`Cap ${draft.computed.requestedCap} against stock capacity ${draft.computed.capacity} bundles`}
                    label={`Cap ${draft.computed.requestedCap}/day vs stock capacity ${draft.computed.capacity}`}
                    valueLabel={draft.computed.capWithinCapacity ? "feasible" : "over capacity!"}
                    value={draft.computed.requestedCap}
                    max={Math.max(draft.computed.capacity, draft.computed.requestedCap, 1)}
                    tone={draft.computed.capWithinCapacity ? "brand" : "bad"}
                  />
                </div>
              ) : null}
              <div className="mt-3 divide-y divide-slate-100">
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
                  {draft.copyLocale === "hi" ? (
                    <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                      Hindi copy is a draft translation - have a Hindi speaker review the financial wording before any
                      real use.
                    </p>
                  ) : null}
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
              <Card data-tour="actions" className="p-5">
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
                    data-testid="approve"
                    className="btn-secondary"
                  >
                    {busy === "approve" ? "Approving..." : "Approve this exact version"}
                  </button>
                  <button
                    type="button"
                    onClick={execute}
                    disabled={busy !== "" || !approved || termsDirty}
                    data-testid="queue"
                    className="btn-primary"
                  >
                    {busy === "execute" ? "Queueing..." : "Queue simulated campaign"}
                  </button>
                  {executed ? (
                    <a href={`/campaigns/${draft.campaignId}`} data-testid="view-campaign" className="btn-primary">
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
