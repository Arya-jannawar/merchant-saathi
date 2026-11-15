import type { Metadata } from "next";
import "./globals.css";
import { SaathiProvider } from "@/components/saathi-provider";
import BusinessHeaderControl from "@/components/business-header-control";

export const metadata: Metadata = {
  title: "Merchant Saathi - AI business partner (demo)",
  description:
    "Evidence-backed growth partner for small merchants. Paytm AI Hackathon Pune, Track 1. Team FinovateX. Synthetic demo data only.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50 text-slate-800 antialiased">
        <SaathiProvider>
          <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur">
            <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-3">
              <a href="/merchant" className="ms-rise order-1 flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-navy text-sm font-black text-white">MS</span>
                <span className="text-lg font-extrabold tracking-tight text-navy">Merchant Saathi</span>
              </a>
              <BusinessHeaderControl />
              <nav className="order-3 flex w-full items-center gap-1 text-sm font-semibold text-slate-600 sm:order-2 sm:w-auto">
                <a className="rounded-lg px-3 py-1.5 transition hover:scale-105 hover:bg-brand-light hover:text-brand" href="/merchant">
                  Dashboard
                </a>
                <a className="rounded-lg px-3 py-1.5 transition hover:scale-105 hover:bg-brand-light hover:text-brand" href="/merchant/planning">
                  Planning
                </a>
                <a className="rounded-lg px-3 py-1.5 transition hover:scale-105 hover:bg-brand-light hover:text-brand" href="/merchant/opportunity">
                  Opportunity
                </a>
                <a className="rounded-lg px-3 py-1.5 transition hover:scale-105 hover:bg-brand-light hover:text-brand" href="/merchant/offer">
                  Offer workspace
                </a>
                <a className="rounded-lg px-3 py-1.5 transition hover:scale-105 hover:bg-brand-light hover:text-brand" href="/merchant/operations">
                  Operations
                </a>
              </nav>
            </div>
          </header>
          <main className="mx-auto w-full max-w-5xl px-4 py-6">{children}</main>
          <footer className="mx-auto max-w-5xl px-4 pb-10 pt-2 text-xs leading-relaxed text-slate-400">
            <p className="ms-credits-glow mb-1.5 text-base font-extrabold tracking-wide text-navy">
              Built with <span className="ms-credits-hop" aria-hidden>🧁</span> by{" "}
              <span className="ms-credits-shine">Arya Jannawar · Avani Jannawar · Siddhant Pardeshi</span>
              {" "}— <span className="ms-credits-glow text-brand">Team FinovateX ✦</span>
            </p>
            Prototype for the Paytm AI Hackathon (Track 1 - Merchant Growth AI). All data, people and customers are synthetic;
            campaigns are simulated; no real messages are sent. Not an official Paytm product or endorsement.
          </footer>
        </SaathiProvider>
      </body>
    </html>
  );
}
