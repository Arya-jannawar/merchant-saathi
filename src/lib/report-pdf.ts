/**
 * Campaign summary PDF renderer (pdfkit + embedded Noto fonts).
 *
 * One report model feeds both the TXT download (client) and this PDF (server
 * route), so the two formats can never disagree. English text renders in
 * Noto Sans (covers the rupee sign); a Hindi customer message renders in
 * Noto Sans Devanagari (covers Devanagari + the rupee sign + digits).
 */

import PDFDocument from "pdfkit";
import { readFileSync } from "node:fs";
import path from "node:path";
import { formatDateTime, formatINR } from "@/lib/format";

export interface CampaignSummaryReport {
  businessName: string;
  campaignId: string;
  version: number;
  status: string;
  offer: {
    bundleName: string;
    pricePaise: number;
    normalPricePaise: number;
    cap: number;
    maxDiscountExposurePaise: number;
  };
  expiresAtIso: string;
  approvedAtIso: string | null;
  audienceCount: number;
  aiMode: string;
  customerMessage: string;
  customerMessageIsHindi: boolean;
  redemptions: {
    redemptions: number;
    cap: number;
    revenuePaise: number;
    variableCostPaise: number;
    contributionPaise: number;
    discountPaise: number;
  };
  caveats: string[];
  generatedAtIso: string;
}

let notoSans: Buffer | null = null;
let notoSansBold: Buffer | null = null;
let notoDevanagari: Buffer | null = null;

function fontBuffer(name: "sans" | "sansBold" | "devanagari"): Buffer {
  const cache = { sans: notoSans, sansBold: notoSansBold, devanagari: notoDevanagari };
  if (cache[name]) return cache[name];
  const file = {
    sans: "NotoSans-Regular.ttf",
    sansBold: "NotoSans-Bold.ttf",
    devanagari: "NotoSansDevanagari-Regular.ttf",
  }[name];
  const bytes = readFileSync(path.join(process.cwd(), "assets", "fonts", file));
  if (name === "sans") notoSans = bytes;
  else if (name === "sansBold") notoSansBold = bytes;
  else notoDevanagari = bytes;
  return bytes;
}

const NAVY = "#0B2447";
const SLATE = "#475569";
const MUTED = "#94A3B8";
const BRAND = "#00B9F1";
const ROSE = "#B91C1C";

export async function renderCampaignSummaryPdf(report: CampaignSummaryReport): Promise<Buffer> {
  const doc = new PDFDocument({
    size: "A4",
    margins: { top: 56, bottom: 56, left: 54, right: 54 },
    info: {
      Title: `Merchant Saathi - campaign summary (${report.campaignId} v${report.version})`,
      Author: "Merchant Saathi (simulated demo)",
      CreationDate: new Date(report.generatedAtIso),
    },
  });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const r = report.redemptions;
  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const bottom = doc.page.height - doc.page.margins.bottom;

  const ensure = (needed: number) => {
    if (doc.y + needed > bottom) doc.addPage();
  };
  const row = (label: string, value: string, opts?: { valueFont?: "sans" | "devanagari" }) => {
    ensure(20);
    doc.font(fontBuffer("sans")).fontSize(9.5).fillColor(MUTED).text(label.toUpperCase(), left, doc.y + 2, { continued: false, lineBreak: false });
    doc
      .font(opts?.valueFont === "devanagari" ? fontBuffer("devanagari") : fontBuffer("sans"))
      .fontSize(10)
      .fillColor(NAVY)
      .text(value, left + 190, doc.y - 12, { lineBreak: false });
  };
  const sectionTitle = (text: string) => {
    ensure(34);
    doc.moveDown(0.8);
    doc.font(fontBuffer("sansBold")).fontSize(11).fillColor(NAVY).text(text.toUpperCase(), left, doc.y);
    doc.moveTo(left, doc.y + 2).lineTo(right, doc.y + 2).lineWidth(0.75).strokeColor("#E2E8F0").stroke();
    doc.moveDown(0.4);
  };

  // Header
  doc.font(fontBuffer("sansBold")).fontSize(9).fillColor(BRAND).text("MERCHANT SAATHI", left, 56);
  doc.font(fontBuffer("sansBold")).fontSize(18).fillColor(NAVY).text("Campaign summary", left, 72);
  doc.font(fontBuffer("sans")).fontSize(9).fillColor(SLATE).text("Simulated demo - nothing was sent", left, 96);
  doc.font(fontBuffer("sans")).fontSize(9).fillColor(MUTED).text(`Generated ${formatDateTime(report.generatedAtIso)} IST`, left, 110);
  doc.moveTo(left, 128).lineTo(right, 128).lineWidth(1.5).strokeColor(BRAND).stroke();
  doc.y = 140;

  // Meta
  sectionTitle("Campaign details");
  row("Business", report.businessName);
  row("Campaign", `${report.campaignId} · v${report.version}`);
  row("Status", report.status);
  row("AI mode", report.aiMode);
  row("Offer", `${report.offer.bundleName} at ${formatINR(report.offer.pricePaise)} (usual ${formatINR(report.offer.normalPricePaise)}), cap ${report.offer.cap}/day`);
  row("Max discount exposure", formatINR(report.offer.maxDiscountExposurePaise));
  row("Validity", `until ${formatDateTime(report.expiresAtIso)} IST`);
  row("Approved at", report.approvedAtIso ? formatDateTime(report.approvedAtIso) : "not approved");
  row("Audience", `${report.audienceCount} consented demo customers`);

  // Money
  sectionTitle("Simulated campaign outcomes");
  row("Unique redemptions", `${r.redemptions} of cap ${r.cap}`);
  row("Bundle sales", formatINR(r.revenuePaise));
  row("Ingredients & packaging", `- ${formatINR(r.variableCostPaise)}`);
  row("Contribution toward fixed costs", formatINR(r.contributionPaise));
  row("Discount given", formatINR(r.discountPaise));
  if (r.redemptions === 0) {
    doc.font(fontBuffer("sans")).fontSize(9).fillColor(SLATE);
    ensure(30);
    doc.text("No simulated redemption events have been applied yet - the amounts above show zeros until events are applied.", left, doc.y + 2, { width: right - left });
  }

  // Customer message
  sectionTitle("Customer message (never sent)");
  doc.font(report.customerMessageIsHindi ? fontBuffer("devanagari") : fontBuffer("sans"));
  doc.fontSize(10).fillColor(NAVY);
  ensure(40);
  doc.text(`"${report.customerMessage}"`, left, doc.y + 2, { width: right - left });

  // Caveats
  sectionTitle("Read before quoting these numbers");
  doc.font(fontBuffer("sans")).fontSize(9).fillColor(SLATE);
  for (const caveat of report.caveats) {
    ensure(28);
    doc.text(`- ${caveat}`, left, doc.y + 2, { width: right - left });
  }

  // Footer
  ensure(40);
  doc.moveDown(1);
  doc.font(fontBuffer("sans")).fontSize(8).fillColor(MUTED).text(
    "Merchant Saathi prototype - Paytm AI Hackathon (Track 1). All data is synthetic; campaigns are simulated; no real messages are sent.",
    left,
    doc.y,
    { width: right - left }
  );

  doc.end();
  return done;
}
