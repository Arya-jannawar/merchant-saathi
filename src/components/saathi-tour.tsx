"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { MascotById } from "@/components/mascot";
import { soundKit } from "@/lib/sound";
import type { MascotId } from "@/lib/mascots-config";

/**
 * Mithu's guided tour: per-route steps, a spotlight on the target element and
 * a speech card. Targets are found by [data-tour] attributes on the pages, so
 * the tour never depends on brittle text selectors.
 */

interface TourStep {
  selector: string;
  title: string;
  text: string;
}

const TOURS: Record<string, TourStep[]> = {
  "/merchant": [
    {
      selector: "[data-tour='status-strip']",
      title: "Honest labels first",
      text: "Synthetic data, AI mode, and the demo clock - everything this demo is, is written right here. Nothing hides.",
    },
    {
      selector: "[data-tour='kpis']",
      title: "The decline, at one glance",
      text: "Two complete Mon-Fri windows: completed 3-6 p.m. orders 100 → 70, net sales ₹8,000 → ₹5,600. AOV flat at ₹80 - so it's the order COUNT that dropped.",
    },
    {
      selector: "[data-tour='opportunity']",
      title: "One opportunity, with receipts",
      text: "The app proposes ONE evidence-backed action. Every number links to a metric id and its definition - tap 'View evidence' to see the receipts.",
    },
    {
      selector: "[data-tour='audience']",
      title: "Consent is the gate",
      text: "Only customers with an active demo consent are eligible. Missing or revoked consents are excluded automatically.",
    },
    {
      selector: "[data-tour='next-step']",
      title: "Your move",
      text: "Next stop: the offer workspace, where the math reacts live to every term you touch. Click Next and let's go!",
    },
  ],
  "/merchant/opportunity": [
    {
      selector: "[data-tour='comparison']",
      title: "Both windows, side by side",
      text: "The bars compare the two complete windows. This is the whole evidence for the decline - no mystery, no invented causes.",
    },
    {
      selector: "[data-tour='evidence-button']",
      title: "Open the evidence drawer",
      text: "Every metric carries its definition, period and source. This drawer is the USP: proof, not a black box.",
    },
    {
      selector: "[data-tour='cta-offer']",
      title: "Into the workspace",
      text: "Ready to price it? Next: the offer workspace.",
    },
  ],
  "/merchant/offer": [
    {
      selector: "[data-tour='terms']",
      title: "Touch the terms",
      text: "Price and cap live here. Change anything and the economics recompute instantly - in code, never in AI.",
    },
    {
      selector: "[data-tour='economics']",
      title: "The check that never blinks",
      text: "Margin vs the 25% floor, stock capacity, and maximum discount exposure - all recomputed live. Try ₹50 and watch me panic.",
    },
    {
      selector: "[data-tour='actions']",
      title: "Approve, then queue (simulated)",
      text: "Approving binds the exact preview with a hash. Queueing writes a simulated outbox - nothing is ever really sent.",
    },
  ],
  "/campaigns": [
    {
      selector: "[data-tour='outbox']",
      title: "Simulated outbox",
      text: "40 consented demo recipients, status simulated_queued. This is the honesty part - no real messages exist.",
    },
    {
      selector: "[data-tour='events']",
      title: "Apply the redemption events",
      text: "Ten simulated redemption events. Replaying one changes nothing - idempotency you can test live.",
    },
    {
      selector: "[data-tour='money']",
      title: "The money story",
      text: "₹700 bundle sales − ₹400 ingredients & packaging = ₹300 contribution. The waterfall below shows exactly that.",
    },
  ],
};

export function SaathiTour({ onClose, mascotId = "mithu" }: { onClose: () => void; mascotId?: MascotId }) {
  const pathname = usePathname();
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);

  const steps = useMemo(
    () => TOURS[pathname?.startsWith("/campaigns") ? "/campaigns" : (pathname ?? "")] ?? [],
    [pathname]
  );

  const measure = useCallback(() => {
    if (!steps[index]) return;
    const el = document.querySelector(steps[index].selector);
    if (!el) {
      setRect(null);
      return;
    }
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    window.setTimeout(() => setRect(el.getBoundingClientRect()), 320);
  }, [index, steps]);

  useLayoutEffect(() => {
    if (!steps.length) return;
    measure();
    const t = setTimeout(() => soundKit.play("step"), 60);
    return () => clearTimeout(t);
  }, [index, measure, steps.length]);

  useEffect(() => {
    const onMove = () => measure();
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    return () => {
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
    };
  }, [measure]);

  if (!steps.length) return null;
  const step = steps[index];
  const last = index === steps.length - 1;

  const cardStyle = rect
    ? {
        top: Math.min(rect.bottom + 14, window.innerHeight - 210),
        left: Math.max(Math.min(rect.left, window.innerWidth - 370), 12),
      }
    : { top: 120, left: 24 };

  return (
    <div className="ms-fade fixed inset-0 z-[55]" role="dialog" aria-modal="true" aria-label="Guided tour">
      {rect ? (
        <div
          className="ms-spotlight pointer-events-none fixed rounded-2xl transition-all duration-300"
          style={{ top: rect.top - 6, left: rect.left - 6, width: rect.width + 12, height: rect.height + 12 }}
        />
      ) : null}

      <div className="absolute w-[min(88vw,340px)]" style={cardStyle}>
        <div className="ms-pop flex items-start gap-2 rounded-3xl border-2 border-navy/15 bg-white p-4 shadow-card">
          <div className="shrink-0">
            <MascotById id={mascotId} mood={last ? "excited" : index === 0 ? "wave" : "happy"} size={54} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">
              Step {index + 1} of {steps.length}
            </p>
            <h3 className="mt-0.5 text-sm font-extrabold text-navy">{step.title}</h3>
            <p className="mt-1 text-xs leading-relaxed text-slate-600">{step.text}</p>
            <div className="mt-3 flex items-center justify-between">
              <button
                type="button"
                onClick={onClose}
                className="text-xs font-semibold text-slate-400 underline hover:text-slate-600"
              >
                Skip tour
              </button>
              <div className="flex gap-1.5">
                {index > 0 ? (
                  <button
                    type="button"
                    onClick={() => setIndex((i) => Math.max(i - 1, 0))}
                    className="btn-secondary !px-3 !py-1.5 text-xs"
                  >
                    Back
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => {
                    if (last) {
                      soundKit.play("celebrate");
                      onClose();
                    } else {
                      setIndex((i) => i + 1);
                    }
                  }}
                  className="btn-primary !px-3 !py-1.5 text-xs"
                >
                  {last ? "Finish 🎉" : "Next"}
                </button>
              </div>
            </div>
            <div className="mt-2 flex gap-1">
              {steps.map((_, i) => (
                <span
                  key={i}
                  className={`h-1.5 w-1.5 rounded-full transition ${i === index ? "w-4 bg-accent" : "bg-slate-200"}`}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
