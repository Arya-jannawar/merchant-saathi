"use client";

import { useEffect, useState } from "react";
import { api, ApiClientError, type AssistantSettingsDto } from "@/lib/client";
import { soundKit } from "@/lib/sound";

/**
 * "Give Mithu a brain" dialog. Takes a provider API key and model id and hands
 * them to POST /api/assistant/settings. The key is kept in server memory only;
 * the browser never sees it again (just a masked preview).
 */

export function BrainModal({
  open,
  status,
  onClose,
  onSaved,
}: {
  open: boolean;
  status: AssistantSettingsDto | null;
  onClose: () => void;
  onSaved: (status: AssistantSettingsDto) => void;
}) {
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setModel(status?.model ?? "");
      setBaseUrl(status?.baseUrl ?? "");
      setApiKey("");
      setError(null);
    }
  }, [open, status]);

  if (!open) return null;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await api<AssistantSettingsDto>("/api/assistant/settings", {
        method: "POST",
        body: JSON.stringify({ apiKey, model, baseUrl: baseUrl || undefined }),
      });
      soundKit.play("success");
      onSaved(res);
      onClose();
    } catch (err) {
      soundKit.play("error");
      setError(err instanceof ApiClientError ? `${err.message}${err.fieldErrors ? ` (${Object.values(err.fieldErrors).join("; ")})` : ""}` : "Could not save the key.");
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    setBusy(true);
    try {
      const res = await api<AssistantSettingsDto>("/api/assistant/settings", { method: "DELETE" });
      soundKit.play("toggle");
      onSaved(res);
      onClose();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not clear the key.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-navy-deep/50 p-4" role="dialog" aria-modal="true" aria-label="Assistant brain settings">
      <div className="ms-pop w-full max-w-md rounded-3xl bg-white p-6 shadow-card">
        <div className="flex items-center gap-2">
          <span className="text-2xl">🧠</span>
          <div>
            <h2 className="text-lg font-extrabold text-navy">Give Mithu a live brain</h2>
            <p className="text-xs text-slate-500">Optional - the built-in fact book works without any key.</p>
          </div>
        </div>

        {status?.configured ? (
          <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            Live brain is on: model <strong>{status.model}</strong>, key <strong>{status.maskedKey}</strong> (
            {status.baseUrl}).
          </div>
        ) : (
          <div className="mt-4 rounded-xl border border-sky-200 bg-accent-soft px-3 py-2 text-sm text-sky-900">
            Without a key, Mithu answers from the fact book - the same verified numbers, deterministic replies.
          </div>
        )}

        <div className="mt-4 space-y-3">
          <label className="block text-sm font-semibold text-slate-700">
            API key
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Paste your provider API key"
              autoComplete="off"
              className="mt-1 w-full"
            />
          </label>
          <label className="block text-sm font-semibold text-slate-700">
            Model id
            <input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="e.g. glm-4.6"
              autoComplete="off"
              className="mt-1 w-full"
            />
          </label>
          <label className="block text-sm font-semibold text-slate-700">
            Endpoint <span className="font-normal text-slate-400">(optional, public https only)</span>
            <input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.z.ai/api/paas/v4"
              autoComplete="off"
              className="mt-1 w-full"
            />
          </label>
        </div>

        <p className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-slate-500">
          The key is validated and kept in this server&apos;s memory only - never written to disk, never sent back to the
          browser. A server restart clears it. Live answers are still checked: any rupee amount that is not in the
          computed facts makes the reply fall back to the fact book.
        </p>

        {error ? <p className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}

        <div className="mt-5 flex items-center justify-between gap-2">
          {status?.configured ? (
            <button type="button" onClick={() => void clear()} disabled={busy} className="btn-danger-soft">
              Remove key
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="btn-secondary">
              Cancel
            </button>
            <button type="button" onClick={() => void save()} disabled={busy || apiKey.trim().length < 8 || model.trim().length < 1} className="btn-primary">
              {busy ? "Saving…" : "Save key"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
