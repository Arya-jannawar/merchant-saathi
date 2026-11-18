import { z } from "zod";
import { getDb } from "@/lib/db";
import { getDemoSessionId, getRequestedMerchantId } from "@/lib/session";
import { routeHandler, ok, parseBody } from "@/lib/http";
import { resolveTenant } from "@/services/demo";
import {
  buildAssistantFacts,
  answerFromFactBook,
  answerAssistantLive,
  type AssistantFacts,
} from "@/lib/saathi-brain";
import { getAssistantKeyConfig } from "@/lib/assistant-settings";
import { getAiMode } from "@/adapters/ai";

export const dynamic = "force-dynamic";

const ChatBodySchema = z.object({
  question: z.string().trim().min(2).max(500),
});

function fallback(question: string, facts: AssistantFacts, err: unknown, intent: string | null) {
  const fb = answerFromFactBook(question, facts);
  return ok({
    ...fb,
    intent,
    mode: "fallback" as const,
    note: `Live brain unavailable - answered from the built-in fact book instead. Reason: ${
      err instanceof Error ? err.message : "unknown error"
    }`,
  });
}

/**
 * POST /api/assistant/chat - Mithu's answers.
 *
 * Mode precedence: a browser-set key (server memory, validated at save and
 * re-checked at use) enables the live model through answerAssistantLive in the
 * brain library - the route never handles model endpoints or reads env values
 * itself. Without a saved key the fact book answers, honestly labeled. Live
 * answers are schema-validated and their rupee amounts are checked against
 * the computed facts; any failure falls back with an honest note.
 */
export const POST = routeHandler(async (request: Request) => {
  const { question } = parseBody(ChatBodySchema, await request.json().catch(() => null));
  const db = await getDb();
  const sessionId = getDemoSessionId();
  const { merchantId, fixture } = await resolveTenant(db, sessionId, getRequestedMerchantId(request));
  const facts: AssistantFacts = await buildAssistantFacts(db, merchantId, fixture);

  const keyConfig = getAssistantKeyConfig();
  if (keyConfig) {
    try {
      // Server-memory key path: the endpoint was public-host-validated when
      // the key was saved, and answerAssistantLive re-checks it.
      const parsed = await answerAssistantLive(question, facts, keyConfig);
      return ok({ ...parsed, mode: "live" as const, note: null, intent: null });
    } catch (err) {
      return fallback(question, facts, err, null);
    }
  }

  // No env-based live path: model credentials reach the server only through the
  // memory-key dialog above (validated at save, re-checked at use). Anything
  // else answers from the fact book - honestly labeled.

  const fb = answerFromFactBook(question, facts);
  return ok({
    ...fb,
    mode: "fixture" as const,
    note: null,
  });
});
