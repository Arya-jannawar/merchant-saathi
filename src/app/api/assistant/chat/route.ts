import { z } from "zod";
import { getDb } from "@/lib/db";
import { getDemoSessionId, getRequestedMerchantId } from "@/lib/session";
import { routeHandler, ok, parseBody } from "@/lib/http";
import { resolveTenant } from "@/services/demo";
import { buildAssistantFacts, answerFromFactBook, buildAssistantPrompts, parseAssistantAnswer, callAssistantModel } from "@/lib/saathi-brain";
import { getAssistantKeyConfig } from "@/lib/assistant-settings";
import { getAiMode } from "@/adapters/ai";

export const dynamic = "force-dynamic";

const ChatBodySchema = z.object({
  question: z.string().trim().min(2).max(500),
});

/**
 * POST /api/assistant/chat - Mithu's answers.
 *
 * Mode precedence: a browser-set key (server memory) wins, then AI_MODE=live
 * with env credentials, then the fact book. Live answers are schema-validated
 * and their rupee amounts are checked against the computed facts; any failure
 * falls back to the fact book with an honest note.
 */
export const POST = routeHandler(async (request: Request) => {
  const { question } = parseBody(ChatBodySchema, await request.json().catch(() => null));
  const db = getDb();
  const sessionId = getDemoSessionId();
  const { merchantId, fixture } = resolveTenant(db, sessionId, getRequestedMerchantId(request));
  const facts = buildAssistantFacts(db, merchantId, fixture);

  const keyConfig = getAssistantKeyConfig();
  if (keyConfig) {
    try {
      const content = await callAssistantModel(buildAssistantPrompts(question, facts), keyConfig);
      const parsed = parseAssistantAnswer(content, facts);
      return ok({
        ...parsed,
        mode: "live" as const,
        note: null,
        intent: null,
      });
    } catch (err) {
      const fb = answerFromFactBook(question, facts);
      return ok({
        ...fb,
        intent: fb.intent,
        mode: "fallback" as const,
        note: `Live brain unavailable - answered from the built-in fact book instead. Reason: ${
          err instanceof Error ? err.message : "unknown error"
        }`,
      });
    }
  }

  if (getAiMode() === "live" && process.env.LLM_API_KEY?.trim() && process.env.LLM_MODEL?.trim()) {
    try {
      const content = await callAssistantModel(buildAssistantPrompts(question, facts), {
        apiKey: process.env.LLM_API_KEY.trim(),
        model: process.env.LLM_MODEL.trim(),
        baseUrl: process.env.LLM_BASE_URL?.trim() ?? "",
      });
      const parsed = parseAssistantAnswer(content, facts);
      return ok({ ...parsed, mode: "live" as const, note: null, intent: null });
    } catch (err) {
      const fb = answerFromFactBook(question, facts);
      return ok({
        ...fb,
        intent: fb.intent,
        mode: "fallback" as const,
        note: `Live brain unavailable - answered from the built-in fact book instead. Reason: ${
          err instanceof Error ? err.message : "unknown error"
        }`,
      });
    }
  }

  const fb = answerFromFactBook(question, facts);
  return ok({
    ...fb,
    mode: "fixture" as const,
    note: null,
  });
});
