import { routeHandler, ok, parseBody } from "@/lib/http";
import { z } from "zod";
import { assistantKeyStatus, clearAssistantKeyConfig, setAssistantKeyConfig } from "@/lib/assistant-settings";

export const dynamic = "force-dynamic";

const SetKeySchema = z.object({
  apiKey: z.string().min(1).max(512),
  model: z.string().min(1).max(120),
  baseUrl: z.string().max(300).optional(),
});

/** GET /api/assistant/settings - masked status only; the raw key never leaves the server. */
export const GET = routeHandler(async () => {
  return ok(assistantKeyStatus());
});

/** POST /api/assistant/settings - give the chat assistant a live "brain". */
export const POST = routeHandler(async (request: Request) => {
  const body = parseBody(SetKeySchema, await request.json().catch(() => null));
  setAssistantKeyConfig(body); // throws ApiError invalid_input on bad host/key shape
  return ok(assistantKeyStatus(), 201);
});

/** DELETE /api/assistant/settings - drop the in-memory key. */
export const DELETE = routeHandler(async () => {
  clearAssistantKeyConfig();
  return ok(assistantKeyStatus());
});
