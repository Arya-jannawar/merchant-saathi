"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  api,
  ApiClientError,
  type DepositRequestDto,
  type FestivalPlanDto,
  type ImportPreviewDto,
  type ImportReceiptDto,
  type TomorrowForecastDto,
  type YearReportDto,
} from "@/lib/client";
import { formatDateTime, formatINR } from "@/lib/format";
import { Alert, Badge, Card, Stat } from "@/components/ui";
import { useSaathi } from "@/components/saathi-provider";

type YearScope = "calendar" | "financial";

export default function PlanningPage() {
  const saathi = useSaathi();

  // Import state
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [importing, setImporting] = useState(false);
  const [preview, setPreview] = useState<ImportPreviewDto | null>(null);
  const [receipt, setReceipt] = useState<ImportReceiptDto | null>(null);
  const [dateOrder, setDateOrder] = useState<"auto" | "dmy" | "mdy" | "ymd">("auto");
  const [importError, setImportError] = useState<string | null>(null);

  // Forecast
  const [forecast, setForecast] = useState<TomorrowForecastDto | null>(null);

  // Year
  const [scope, setScope] = useState<YearScope>("calendar");
  const [year, setYear] = useState<number>(2026);
  const [yearReport, setYearReport] = useState<YearReportDto | null>(null);
  const [yearError, setYearError] = useState<string | null>(null);

  // Festivals
  const [festivals, setFestivals] = useState<FestivalPlanDto | null>(null);
  const [prepDays, setPrepDays] = useState(1);

  // Deposits
  const [deposits, setDeposits] = useState<DepositRequestDto[]>([]);
  const [orderRef, setOrderRef] = useState("");
  const [orderRupees, setOrderRupees] = useState("1000");
  const [depositPct, setDepositPct] = useState(30);
  const [depositBusy, setDepositBusy] = useState(false);

  const loadHistory = useCallback(async () => {
    try {
      const res = await api<{ batches: { id: string; filename: string; rowsImported: number; rowsTotal: number; reversedAt: string | null; createdAt: string }[] }>(
        "/api/planning/imports",
      );
      setHistory(res.batches);
    } catch {
      setHistory([]);
    }
  }, []);
  const [history, setHistory] = useState<{ id: string; filename: string; rowsImported: number; rowsTotal: number; reversedAt: string | null; createdAt: string }[]>([]);

  const loadDeposits = useCallback(async () => {
    try {
      const res = await api<{ deposits: DepositRequestDto[] }>("/api/planning/deposits");
      setDeposits(res.deposits);
    } catch {
      setDeposits([]);
    }
  }, []);

  const loadAll = useCallback(() => {
    api<TomorrowForecastDto>("/api/planning/tomorrow").then(setForecast).catch(() => setForecast(null));
    api<FestivalPlanDto>("/api/planning/festivals?prepDays=1&objective=profit").then(setFestivals).catch(() => setFestivals(null));
    loadDeposits();
    loadHistory();
  }, [loadDeposits, loadHistory]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  useEffect(() => {
    api<YearReportDto>(`/api/planning/year?scope=${scope}&year=${year}`)
      .then((r) => {
        setYearReport(r);
        setYearError(null);
      })
      .catch((err) => {
        setYearReport(null);
        setYearError(err instanceof ApiClientError ? err.message : "Could not compute the year.");
      });
  }, [scope, year]);

  async function handlePreview(file: File) {
    setImporting(true);
    setImportError(null);
    setReceipt(null);
    setPreview(null);
    try {
      const content = await file.text();
      if (content.length > 2_000_000) throw new Error("File is larger than the 2 MB preview limit - split it or export fewer rows.");
      const res = await api<ImportPreviewDto>("/api/planning/import/preview", {
        method: "POST",
        body: JSON.stringify({ filename: file.name, content, dateOrder }),
      });
      setPreview(res);
      saathi.say(
        res.rowsImported > 0
          ? `Preview ready: ${res.rowsImported} of ${res.rowsTotal} rows would be new. Review and confirm.`
          : `Nothing new to import - every row is a duplicate or cancelled.`,
        { mood: res.rowsImported > 0 ? "happy" : "thinking" },
      );
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Could not read the file.");
      saathi.react("sad", "error");
    } finally {
      setImporting(false);
    }
  }

  async function handleConfirm() {
    if (!preview) return;
    setImporting(true);
    setImportError(null);
    try {
      // Re-read the file to confirm against the exact content that was previewed.
      const file = fileRef.current?.files?.[0];
      if (!file) throw new Error("The selected file is gone - choose it again.");
      const content = await file.text();
      const res = await api<ImportReceiptDto>("/api/planning/import/confirm", {
        method: "POST",
        body: JSON.stringify({ filename: file.name, content, dateOrder }),
      });
      setReceipt(res);
      setPreview(null);
      saathi.say(`${res.rowsImported} rows posted (${res.rowsSkipped} skipped). The plan pages now use the new history.`, {
        mood: "excited",
        sound: "success",
      });
      loadAll();
      // Refresh year/forecast after import
      api<YearReportDto>(`/api/planning/year?scope=${scope}&year=${year}`).then(setYearReport).catch(() => undefined);
      api<TomorrowForecastDto>("/api/planning/tomorrow").then(setForecast).catch(() => undefined);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Confirm failed.");
      saathi.react("sad", "error");
    } finally {
      setImporting(false);
    }
  }

  async function revertBatch(id: string) {
    setImporting(true);
    try {
      await api(`/api/planning/imports/${id}/revert`, { method: "POST" });
      setReceipt(null);
      saathi.say("Batch reversed - its rows are gone, records confirmed by other batches stay.", { mood: "thinking" });
      loadHistory();
    } catch (err) {
      setImportError(err instanceof ApiClientError ? err.message : "Revert failed.");
    } finally {
      setImporting(false);
    }
  }

  async function createDeposit() {
    setDepositBusy(true);
    try {
      const created = await api<DepositRequestDto>("/api/planning/deposits", {
        method: "POST",
        body: JSON.stringify({
          orderRef: orderRef || `order-${Date.now()}`,
          description: `Deposit for ${orderRef || "phone order"}`,
          orderPaise: Math.round(parseFloat(orderRupees || "0") * 100),
          depositPct,
        }),
      });
      setDeposits((list) => [created, ...list]);
      saathi.say(`Payment link created for ${formatINR(created.depositPaise)} - ${formatINR(created.remainingPaise)} stays due on the order.`, {
        mood: "happy",
        sound: "success",
      });
    } catch (err) {
      setImportError(err instanceof ApiClientError ? err.message : "Could not create the deposit link.");
    } finally {
      setDepositBusy(false);
    }
  }

  async function collectDeposit(id: string) {
    setDepositBusy(true);
    try {
      const res = await api<{ deposit: DepositRequestDto; duplicate: boolean }>(`/api/planning/deposits/${id}/collect`, { method: "POST" });
      setDeposits((list) => list.map((d) => (d.id === id ? res.deposit : d)));
      saathi.say(
        res.duplicate
          ? "That callback already arrived - the deposit stayed collected once. Idempotent, as designed."
          : `${formatINR(res.deposit.depositPaise)} collected. ${formatINR(res.deposit.remainingPaise)} remains on the order.`,
        { mood: res.duplicate ? "curious" : "excited", sound: res.duplicate ? "reply" : "success" },
      );
    } catch (err) {
      setImportError(err instanceof ApiClientError ? err.message : "Collect failed.");
    } finally {
      setDepositBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-bold uppercase tracking-widest text-slate-500">Plan my next sale</p>
        <h1 className="mt-1 text-2xl font-extrabold text-navy">Import, forecast, then act on the numbers</h1>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-600">
          Import a statement (CSV/TSV/JSON), check what was recorded, preview tomorrow&apos;s expected sales, compare your
          year, and plan the next festival - every figure traces back to the imported rows.
        </p>
      </div>

      {importError ? <Alert tone="error" title={importError} /> : null}

      {/* Import */}
      <Card data-tour="import" className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-bold text-navy">Import transactions</h2>
          <div className="flex gap-2 text-xs">
            <a href="/samples/template-import.csv" download className="font-semibold text-brand hover:underline">
              Template
            </a>
            <a href="/samples/sample-annual-bakery.csv" download className="font-semibold text-brand hover:underline">
              Sample: full year
            </a>
            <a href="/samples/sample-festival-kiosk.csv" download className="font-semibold text-brand hover:underline">
              Sample: festival kiosk
            </a>
          </div>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-slate-500">
          CSV, TSV or JSON (array of rows). Columns are auto-mapped from common statement headers; amounts accept Indian
          grouping and ₹. Preview shows exactly what will post - nothing is recorded before you confirm. Files stay in
          this browser session&apos;s business scope; 2 MB preview limit.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.tsv,.json,text/csv,text/tab-separated-values,application/json"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handlePreview(f);
            }}
            className="text-sm"
            aria-label="Statement file (CSV, TSV or JSON)"
          />
          <label className="text-xs font-semibold text-slate-500">
            Date order
            <select value={dateOrder} onChange={(e) => setDateOrder(e.target.value as typeof dateOrder)} className="ml-1 rounded-lg border-slate-200 py-1 text-xs">
              <option value="auto">Auto</option>
              <option value="dmy">DD/MM/YYYY</option>
              <option value="mdy">MM/DD/YYYY</option>
              <option value="ymd">YYYY-MM-DD</option>
            </select>
          </label>
          {importing ? <Badge tone="cyan">working…</Badge> : null}
        </div>
        {importError ? null : null}

        {preview ? (
          <div className="ms-pop mt-4 border-t border-slate-100 pt-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-bold text-navy">
                Preview: {preview.filename} · {preview.rowsTotal} rows
              </h3>
              <div className="flex flex-wrap gap-1.5 text-xs">
                <Badge tone="green">{preview.rowsImported} new</Badge>
                <Badge tone="amber">{preview.rowsSkipped} skipped</Badge>
                <Badge tone={preview.rowsConflicting ? "red" : "gray"}>{preview.rowsConflicting} conflicts</Badge>
                {preview.alreadyImportedBefore ? <Badge tone="amber">{preview.alreadyImportedBefore} already in ledger</Badge> : null}
              </div>
            </div>
            {preview.periodStart ? (
              <p className="mt-1 text-xs text-slate-500">
                Period: {preview.periodStart.slice(0, 10)} → {preview.periodEnd!.slice(0, 10)}
              </p>
            ) : null}
            <div className="mt-2 max-h-64 overflow-auto rounded-xl border border-slate-100">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-slate-50">
                  <tr className="text-slate-400">
                    <th className="px-2 py-1.5">#</th>
                    <th className="px-2 py-1.5">When</th>
                    <th className="px-2 py-1.5">Type</th>
                    <th className="px-2 py-1.5">Amount</th>
                    <th className="px-2 py-1.5">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.slice(0, 40).map((r) => (
                    <tr key={r.rowNumber} className="border-b border-slate-50">
                      <td className="px-2 py-1.5 text-slate-400">{r.rowNumber}</td>
                      <td className="px-2 py-1.5 text-slate-600">{r.occurredAt.slice(0, 16).replace("T", " ")}</td>
                      <td className="px-2 py-1.5 text-slate-600">{r.eventType}</td>
                      <td className="px-2 py-1.5 font-semibold text-navy">{formatINR(r.amountPaise)}</td>
                      <td className="px-2 py-1.5">
                        {r.status === "import" ? (
                          <span className="text-emerald-600">will import</span>
                        ) : (
                          <span className="text-amber-600">{r.reason}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {preview.rows.length > 40 ? <p className="px-2 py-1 text-[11px] text-slate-400">+ {preview.rows.length - 40} more rows</p> : null}
            </div>
            <div className="mt-3 flex gap-2">
              <button type="button" onClick={() => void handleConfirm()} disabled={importing} className="btn-primary">
                Confirm import
              </button>
              <button
                type="button"
                onClick={() => {
                  setPreview(null);
                  if (fileRef.current) fileRef.current.value = "";
                }}
                className="btn-secondary"
              >
                Cancel
              </button>
            </div>
            <p className="mt-1.5 text-[11px] text-slate-400">Nothing is recorded until you confirm. Confirmed batches can be reversed from the history below.</p>
          </div>
        ) : null}

        {receipt ? (
          <div className="ms-pop mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            <p className="font-bold">Import complete · {receipt.batchId}</p>
            <p className="mt-1 text-xs">
              {receipt.rowsImported} imported · {receipt.rowsSkipped} skipped · {receipt.rowsConflicting} conflicts ·
              period {receipt.periodStart?.slice(0, 10) ?? "?"} → {receipt.periodEnd?.slice(0, 10) ?? "?"}
              {receipt.duplicateBatch ? " · duplicate file: fingerprint already known, nothing double-counted" : ""}
            </p>
          </div>
        ) : null}

        {history.length > 0 ? (
          <div className="mt-4 border-t border-slate-100 pt-3">
            <p className="text-xs font-bold uppercase tracking-widest text-slate-500">Import history</p>
            <ul className="mt-2 space-y-1 text-xs text-slate-600">
              {history.map((b) => (
                <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-1.5">
                  <span className="font-mono text-slate-400">{b.id.slice(0, 12)}</span>
                  <span className="font-semibold text-navy">{b.filename}</span>
                  <span>
                    {b.rowsImported}/{b.rowsTotal} rows
                  </span>
                  <span className="text-slate-400">{formatDateTime(b.createdAt)}</span>
                  {b.reversedAt ? (
                    <Badge tone="gray">reversed</Badge>
                  ) : (
                    <button type="button" onClick={() => void revertBatch(b.id)} className="text-rose-500 hover:underline">
                      Reverse batch
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Card>

      {/* Tomorrow */}
      <Card data-tour="tomorrow" className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-bold text-navy">Tomorrow&apos;s expected sales</h2>
          {forecast ? (
            <Badge tone={forecast.usable ? "green" : "amber"}>
              {forecast.usable ? `model: ${forecast.selectedModel}` : "insufficient history"}
            </Badge>
          ) : null}
        </div>
        {!forecast ? (
          <p className="mt-2 text-sm text-slate-500">Loading the forecast…</p>
        ) : !forecast.usable ? (
          <Alert tone="warn" title="Not enough history yet">
            <p className="text-xs">{forecast.reason}</p>
          </Alert>
        ) : (
          <>
            <div className="mt-3 flex flex-wrap items-end gap-6">
              <div>
                <p className="text-4xl font-extrabold text-navy">{formatINR(forecast.predictedRupees ?? 0)}</p>
                <p className="mt-1 text-xs text-slate-500">expected net sales for {forecast.tomorrowDate} (estimate, not observed)</p>
              </div>
              <Stat label="Selection backtest (14 days)">{`MAE ₹${(forecast.selectedModel === "ridge" ? forecast.ridge?.maeRupees : forecast.baseline?.maeRupees) ?? "?"}`}</Stat>
              <Stat label="Baseline MAE">{`₹${forecast.baseline?.maeRupees ?? "?"} (same weekday)`}</Stat>
              <Stat label="History">{`${forecast.coverageDays} days · trained to ${forecast.lastTrainingDate}`}</Stat>
            </div>
            <ul className="mt-3 list-disc space-y-1 pl-5 text-xs leading-relaxed text-slate-600">
              {forecast.explanation.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </>
        )}
      </Card>

      {/* My year */}
      <Card data-tour="year" className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-bold text-navy">My year</h2>
          <div className="flex items-center gap-2 text-xs">
            <button
              type="button"
              onClick={() => setScope("calendar")}
              className={`rounded-lg px-2 py-1 font-semibold ${scope === "calendar" ? "bg-accent-soft text-brand" : "text-slate-500"}`}
            >
              Calendar
            </button>
            <button
              type="button"
              onClick={() => setScope("financial")}
              className={`rounded-lg px-2 py-1 font-semibold ${scope === "financial" ? "bg-accent-soft text-brand" : "text-slate-500"}`}
            >
              Apr–Mar
            </button>
            <select value={year} onChange={(e) => setYear(Number.parseInt(e.target.value, 10))} className="rounded-lg border-slate-200 py-1" aria-label="Year">
              {[2026, 2025, 2024].map((y) => (
                <option key={y} value={y}>
                  {scope === "financial" ? `FY ${y}-${String(y + 1).slice(2)}` : y}
                </option>
              ))}
            </select>
          </div>
        </div>
        {yearError ? (
          <Alert tone="warn" title="Nothing to summarise yet">
            <p className="text-xs">{yearError}</p>
          </Alert>
        ) : yearReport ? (
          <>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-brand/30 bg-brand-light px-4 py-3">
                <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Highest sales month</p>
                <p className="mt-1 text-lg font-extrabold text-navy">
                  {yearReport.highestSalesMonth ? yearReport.highestSalesMonth.label : "—"}
                </p>
                <p className="text-xs text-slate-600">{formatINR(yearReport.highestSalesMonth?.netSalesPaise ?? 0)} net sales</p>
              </div>
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
                <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Highest gross-profit month</p>
                <p className="mt-1 text-lg font-extrabold text-navy">
                  {yearReport.highestProfitMonth ? yearReport.highestProfitMonth.label : "—"}
                </p>
                <p className="text-xs text-slate-600">{formatINR(yearReport.highestProfitMonth?.grossProfitPaise ?? 0)} gross profit</p>
              </div>
            </div>
            {yearReport.tieNote ? <p className="mt-2 text-xs text-amber-700">{yearReport.tieNote}</p> : null}
            <p className="mt-1 text-xs text-slate-400">{yearReport.coverageNote}</p>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-400">
                    <th className="py-1.5 pr-3">Month</th>
                    <th className="py-1.5 pr-3">Net sales</th>
                    <th className="py-1.5 pr-3">Gross profit</th>
                    <th className="py-1.5 pr-3">Margin</th>
                    <th className="py-1.5">Days</th>
                  </tr>
                </thead>
                <tbody>
                  {yearReport.months.map((m) => (
                    <tr key={m.month} className="border-b border-slate-50">
                      <td className="py-1.5 pr-3 font-semibold text-navy">{m.label}</td>
                      <td className="py-1.5 pr-3">{formatINR(m.netSalesPaise)}</td>
                      <td className="py-1.5 pr-3">{formatINR(m.grossProfitPaise)}</td>
                      <td className="py-1.5 pr-3">{m.grossMarginPct === null ? "costs missing" : `${m.grossMarginPct}%`}</td>
                      <td className="py-1.5 text-slate-400">{m.tradingDays}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[11px] text-slate-400">
              Compact table alternative to the chart: every month is listed above with its figures and trading-day count.
            </p>
          </>
        ) : (
          <p className="mt-2 text-sm text-slate-500">Loading the year…</p>
        )}
      </Card>

      {/* Festivals */}
      <Card data-tour="festivals" className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-bold text-navy">Festival planner</h2>
          <div className="flex items-center gap-2 text-xs">
            <label className="font-semibold text-slate-500">
              Prep days needed
              <input
                type="number"
                min={0}
                value={prepDays}
                onChange={(e) => {
                  const v = Number.parseInt(e.target.value, 10);
                  setPrepDays(Number.isFinite(v) ? v : 1);
                }}
                className="ml-1 w-14 rounded-lg border-slate-200 py-1"
                aria-label="Preparation days needed"
              />
            </label>
          </div>
        </div>
        {!festivals ? (
          <p className="mt-2 text-sm text-slate-500">Loading festivals…</p>
        ) : (
          <div className="mt-3 space-y-3">
            <p className="text-xs text-slate-500">
              Region: {festivals.region} · as of {festivals.asOf} (demo clock). Dates are stored with their source and
              check date; confirm local trading relevance before committing stock.
            </p>
            {festivals.opportunities.map((op) => (
              <div key={op.festival.id} className={`rounded-xl border px-4 py-3 ${op.deadlinePassed ? "border-slate-200 bg-slate-50" : "border-brand/30 bg-brand-light/50"}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-bold text-navy">
                    {op.festival.name} · {op.festival.date}
                  </p>
                  <Badge tone={op.deadlinePassed ? "gray" : "green"}>
                    {op.deadlinePassed ? "deadline passed" : `in ${op.daysAway} day(s)`}
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {op.deadlineLabel} · lead time {op.leadTimeDays} day(s) ·{" "}
                  <a href={op.festival.source} target="_blank" rel="noreferrer" className="text-brand underline">
                    source
                  </a>{" "}
                  ({op.festival.status}, checked {op.festival.checkedOn})
                </p>
                <p className="mt-1.5 text-sm text-slate-700">{op.suggestion}</p>
                {op.historical ? (
                  <p className="mt-1 text-xs text-slate-500">
                    History ({op.historical.confidence}, {op.historical.comparableWeeks} comparable week(s)): sales{" "}
                    {formatINR(op.historical.comparableAvgNetPaise)} → {formatINR(op.historical.festivalWeekNetPaise)}
                    {op.historical.salesChangePct !== null ? ` (${op.historical.salesChangePct > 0 ? "+" : ""}${op.historical.salesChangePct}%)` : ""}; gross
                    profit {formatINR(op.historical.comparableAvgProfitPaise)} → {formatINR(op.historical.festivalWeekProfitPaise)}
                    {op.historical.profitChangePaise !== null ? ` (${op.historical.profitChangePaise >= 0 ? "+" : "-"}${formatINR(Math.abs(op.historical.profitChangePaise))})` : ""}.
                  </p>
                ) : null}
                {op.estimatedContributionPaise !== null ? (
                  <p className="mt-1 text-xs text-emerald-700">
                    Conservative contribution estimate: {formatINR(op.estimatedContributionPaise)} (repeats last comparable
                    result - an assumption, not a promise).
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Deposits */}
      <Card data-tour="deposits" className="p-5">
        <h2 className="text-base font-bold text-navy">Collect a deposit (payment link)</h2>
        <p className="mt-1 text-xs leading-relaxed text-slate-500">
          For orders taken by phone or chat. Create a labeled deposit request, collect the simulated success, and the
          remaining balance stays visible. A repeated callback never double-collects.
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-4">
          <label className="text-xs font-semibold text-slate-500">
            Order ref
            <input value={orderRef} onChange={(e) => setOrderRef(e.target.value)} placeholder="cake-107" className="mt-1 w-full" />
          </label>
          <label className="text-xs font-semibold text-slate-500">
            Order value (₹)
            <input value={orderRupees} onChange={(e) => setOrderRupees(e.target.value)} inputMode="decimal" className="mt-1 w-full" aria-label="Order value in rupees" />
          </label>
          <label className="text-xs font-semibold text-slate-500">
            Deposit %
            <input
              type="number"
              min={1}
              max={100}
              value={depositPct}
              onChange={(e) => setDepositPct(Number.parseInt(e.target.value, 10) || 30)}
              className="mt-1 w-full"
              aria-label="Deposit percentage"
            />
          </label>
          <button type="button" onClick={() => void createDeposit()} disabled={depositBusy} className="btn-primary mt-auto" data-testid="create-deposit">
            Create link
          </button>
        </div>
        {deposits.length > 0 ? (
          <ul className="mt-3 space-y-2">
            {deposits.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-100 px-3 py-2 text-sm">
                <span className="font-semibold text-navy">{d.orderRef}</span>
                <span className="text-xs text-slate-500">
                  order {formatINR(d.orderPaise)} · deposit {formatINR(d.depositPaise)} · due {formatINR(d.remainingPaise)}
                </span>
                <Badge tone={d.status === "collected" ? "green" : "amber"}>{d.status}</Badge>
                {d.status === "pending" ? (
                  <button type="button" onClick={() => void collectDeposit(d.id)} disabled={depositBusy} className="btn-secondary text-xs" data-testid={`collect-${d.id}`}>
                    Simulate payment success
                  </button>
                ) : (
                  <span className="text-xs text-slate-400">{formatDateTime(d.collectedAt ?? d.createdAt)}</span>
                )}
              </li>
            ))}
          </ul>
        ) : null}
      </Card>
    </div>
  );
}
