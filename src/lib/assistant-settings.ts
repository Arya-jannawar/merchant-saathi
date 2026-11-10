import { validateModelEndpoint } from "@/adapters/ai";
import { ApiError } from "@/lib/errors";

/**
 * In-memory store for the chat assistant's "brain" credentials.
 *
 * The key is set from the browser (POST /api/assistant/settings) and kept in
 * process memory only - never on disk, never in the DB, never sent back to the
 * client (only a masked preview). A server restart clears it by design; the
 * env-based ZAI_API_KEY path is untouched. This mirrors the repo rule that
 * model credentials stay server-side.
 */

export interface AssistantKeyConfig {
  apiKey: string;
  model: string;
  baseUrl: string;
  setAtIso: string;
}

interface Store {
  config: AssistantKeyConfig | null;
}

const storeHolder = globalThis as unknown as { __msAssistantKeys?: Store };
const store: Store = (storeHolder.__msAssistantKeys ??= { config: null });

export const DEFAULT_ASSISTANT_BASE_URL = "https://api.z.ai/api/paas/v4";

export interface SetAssistantKeyInput {
  apiKey: string;
  model: string;
  baseUrl?: string;
}

export function setAssistantKeyConfig(input: SetAssistantKeyInput): AssistantKeyConfig {
  const apiKey = input.apiKey.trim();
  const model = input.model.trim();
  const baseUrl = (input.baseUrl?.trim() || DEFAULT_ASSISTANT_BASE_URL).replace(/\/$/, "");
  if (apiKey.length < 8 || apiKey.length > 512) {
    throw new ApiError("invalid_input", "API key looks wrong: expected 8-512 characters.", {
      fieldErrors: { apiKey: "Must be 8-512 characters." },
    });
  }
  if (model.length < 1 || model.length > 120 || !/^[\w.\/:-]+$/.test(model)) {
    throw new ApiError("invalid_input", "Model id looks wrong.", { fieldErrors: { model: "Use the model id from your provider." } });
  }
  // Same host rules as the live draft adapter: public http(s) hosts only.
  try {
    validateModelEndpoint(baseUrl);
  } catch (err) {
    throw new ApiError("invalid_input", `Endpoint refused: ${err instanceof Error ? err.message : "invalid URL"}`, {
      fieldErrors: { baseUrl: "Public http(s) endpoint required (no localhost/private IPs)." },
    });
  }
  store.config = { apiKey, model, baseUrl, setAtIso: new Date().toISOString() };
  return store.config;
}

export function getAssistantKeyConfig(): AssistantKeyConfig | null {
  return store.config;
}

export function clearAssistantKeyConfig(): void {
  store.config = null;
}

/** Client-safe projection: the raw key never leaves the server. */
export interface AssistantKeyStatus {
  configured: boolean;
  maskedKey: string | null;
  model: string | null;
  baseUrl: string | null;
  setAtIso: string | null;
}

export function assistantKeyStatus(): AssistantKeyStatus {
  const cfg = store.config;
  if (!cfg) return { configured: false, maskedKey: null, model: null, baseUrl: null, setAtIso: null };
  const tail = cfg.apiKey.slice(-4);
  return {
    configured: true,
    maskedKey: `\u2022\u2022\u2022\u2022${tail}`,
    model: cfg.model,
    baseUrl: cfg.baseUrl,
    setAtIso: cfg.setAtIso,
  };
}
