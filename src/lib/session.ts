import { cookies } from "next/headers";
import { randomUUID } from "node:crypto";

/**
 * Single-owner demo session. The tenant (merchant row) is bound to a server-side
 * session cookie - never to a caller-supplied merchant ID. Each browser session
 * gets an isolated seeded tenant, so multiple judges do not reset each other.
 */

export const SESSION_COOKIE = "ms_demo_sid";
const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Read (or create) the demo session id. Only valid inside route handlers. */
export function getDemoSessionId(): string {
  const store = cookies();
  const existing = store.get(SESSION_COOKIE)?.value;
  if (existing && SESSION_ID_RE.test(existing)) return existing;
  const fresh = randomUUID();
  // Setting here attaches the cookie to the outgoing route-handler response.
  store.set(SESSION_COOKIE, fresh, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
  return fresh;
}
