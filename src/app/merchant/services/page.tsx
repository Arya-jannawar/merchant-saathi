"use client";

import { formatINR } from "@/lib/format";
import { Badge, Card } from "@/components/ui";

const SERVICES = [
  {
    id: "payment-links",
    title: "Payment Links (advance-order deposits)",
    category: "payments",
    summary: "Request a specific amount against a specific order and reconcile the deposit to that order.",
    merchantJob: "Customers reserve cakes and repairs by phone - the owner wants the order confirmed before spending on stock.",
    paytmHypothesis: "Merchants completing a first verified Payment Link collection return for a second within 30 days.",
    sourceUrl: "https://business.paytm.com/payment-link",
    sourceEstablishes: "Payment Links exist for merchants to request payments via a shareable link; amount and description are merchant-set.",
    checkedOn: "2026-11-06",
    verification: "public page verified",
  },
  {
    id: "soundbox",
    title: "Soundbox (counter payment alerts)",
    category: "devices",
    summary: "Audio confirmation at the counter the moment a QR payment succeeds.",
    merchantJob: "Staff need to hear that a counter payment succeeded, without checking a phone each time.",
    paytmHypothesis: "Device activations confirmed by the provider; continued use after 30 days where observable.",
    sourceUrl: "https://business.paytm.com/support/what-is-a-soundbox",
    sourceEstablishes: "Soundbox is a Paytm for Business device that announces QR payments aloud; setup is via the merchant dashboard.",
    checkedOn: "2026-11-06",
    verification: "public page verified",
  },
  {
    id: "business-loans",
    title: "Business loans (funding stock or equipment)",
    category: "lending",
    summary: "Explore borrowing options from lending partners; only the lender can make an actual offer.",
    merchantJob: "Fund a specific purchase - stock before a festival, an oven, a second counter.",
    paytmHypothesis: "Acknowledged enquiry, application and disbursal are three distinct events.",
    sourceUrl: "https://paytm.com/loans-credit-cards/business-loan/",
    sourceEstablishes: "Paytm surfaces business-loan offers from lending partners; eligibility and terms are lender decisions.",
    checkedOn: "2026-11-06",
    verification: "category guide",
  },
  {
    id: "insurance",
    title: "Health and shop protection policies",
    category: "insurance",
    summary: "Compare personal/family health cover or protection for shop stock and equipment via the broker.",
    merchantJob: "Protect the family and the shop against health and fire/theft shocks.",
    paytmHypothesis: "Requested comparisons, acknowledged quote requests, confirmed issuances or renewals.",
    sourceUrl: "https://paytminsurance.co.in/our-policies/disclosures/",
    sourceEstablishes: "Paytm Insurance Broking discloses its broker role and policy categories; policy wording comes from insurers.",
    checkedOn: "2026-11-06",
    verification: "category guide",
  },
  {
    id: "report-downloads",
    title: "Merchant transaction report downloads",
    category: "payments",
    summary: "Download transaction histories from the Paytm dashboard and import them here for planning.",
    merchantJob: "Bring existing Paytm records into the same planning ledger as cash and UPI sales.",
    paytmHypothesis: "Imports deepen merchant engagement with Paytm records as the planning data source.",
    sourceUrl: "https://business.paytm.com/support/can-i-download-all-my-transactions-details-",
    sourceEstablishes: "The merchant dashboard supports transaction history downloads; formats and limitations are documented there.",
    checkedOn: "2026-11-06",
    verification: "public page verified",
  },
];

export default function ServicesPage() {
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-bold uppercase tracking-widest text-slate-500">Explore business services</p>
        <h1 className="mt-1 text-2xl font-extrabold text-navy">Paytm services for your next step</h1>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-600">
          A directory, not a sales pitch: each entry lists the provider, what the public source establishes, and the date
          we checked it. No rates, terms or partnerships are invented here - &quot;category guide&quot; means the provider&apos;s own
          process sets the actual terms. A sales decline never triggers a loan suggestion.
        </p>
      </div>
      {SERVICES.map((s) => (
        <Card key={s.id} className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-bold text-navy">{s.title}</h2>
            <Badge tone={s.verification === "public page verified" ? "green" : "amber"}>
              {s.verification} · checked {s.checkedOn}
            </Badge>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-slate-700">{s.summary}</p>
          <dl className="mt-3 space-y-1.5 text-xs leading-relaxed">
            <div>
              <dt className="inline font-bold text-slate-500">Merchant job: </dt>
              <dd className="inline text-slate-600">{s.merchantJob}</dd>
            </div>
            <div>
              <dt className="inline font-bold text-slate-500">What the source establishes: </dt>
              <dd className="inline text-slate-600">{s.sourceEstablishes}</dd>
            </div>
            <div>
              <dt className="inline font-bold text-slate-500">Measured outcome hypothesis: </dt>
              <dd className="inline text-slate-600">{s.paytmHypothesis}</dd>
            </div>
          </dl>
          <p className="mt-2 text-xs">
            <a href={s.sourceUrl} target="_blank" rel="noreferrer" className="font-semibold text-brand underline">
              Open the official source ↗
            </a>{" "}
            <span className="text-slate-400">(outbound link, checked {s.checkedOn})</span>
          </p>
        </Card>
      ))}
      <p className="text-xs text-slate-400">
        Outbound links open the provider&apos;s own page. Merchant Saathi records the outbound visit only - an application,
        policy or disbursal can only be confirmed by the provider.
      </p>
      <p className="text-xs text-slate-400">Total services: {SERVICES.length} · categories: payments, lending, insurance, devices. {formatINR(0)} is charged by this directory - browsing is free.</p>
    </div>
  );
}
