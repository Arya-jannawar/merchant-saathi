/**
 * Business services directory: provider, what the public source establishes,
 * the date checked and the current public destination for each entry. Public
 * information supports the link even when an application API is unavailable -
 * no rates, terms or partnerships are invented. Enquiries are a distinct
 * outcome from applications and disbursals.
 */

export interface ServiceCatalogueEntry {
  id: string;
  title: string;
  category: "payments" | "lending" | "insurance" | "devices" | "collections";
  summary: string;
  merchantJob: string;
  paytmHypothesis: string;
  sourceUrl: string;
  sourceEstablishes: string;
  checkedOn: string;
  verification: "public page verified" | "category guide";
}

const CHECKED = "2026-11-06";

export const SERVICE_CATALOGUE: ServiceCatalogueEntry[] = [
  {
    id: "payment-links",
    title: "Payment Links (advance-order deposits)",
    category: "payments",
    summary: "Request a specific amount against a specific order and reconcile the deposit to that order.",
    merchantJob: "Customers reserve cakes and repairs by phone - the owner wants the order confirmed before spending on stock.",
    paytmHypothesis: "Merchants completing a first verified Payment Link collection return for a second within 30 days.",
    sourceUrl: "https://business.paytm.com/payment-link",
    sourceEstablishes: "Payment Links exist for merchants to request payments via a shareable link; amount and description are merchant-set.",
    checkedOn: CHECKED,
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
    checkedOn: CHECKED,
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
    checkedOn: CHECKED,
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
    checkedOn: CHECKED,
    verification: "category guide",
  },
  {
    id: "merchant-report-downloads",
    title: "Merchant transaction report downloads",
    category: "payments",
    summary: "Download transaction histories from the Paytm dashboard and import them here for planning.",
    merchantJob: "Bring existing Paytm records into the same planning ledger as cash and UPI sales.",
    paytmHypothesis: "Imports deepen merchant engagement with Paytm records as the planning data source.",
    sourceUrl: "https://business.paytm.com/support/can-i-download-all-my-transactions-details-",
    sourceEstablishes: "The merchant dashboard supports transaction history downloads; formats and limitations are documented there.",
    checkedOn: CHECKED,
    verification: "public page verified",
  },
];
