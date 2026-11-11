import { NextResponse } from "next/server";
import { ZodError, type ZodTypeAny, type output } from "zod";
import { ApiError } from "./errors";
import { MerchantLimitError, MerchantNotFoundError } from "@/services/demo";

/** Wrap a route handler: converts ApiError/ZodError/unexpected into the error envelope. */
export function routeHandler<Args extends unknown[]>(
  handler: (...args: Args) => Promise<NextResponse>
): (...args: Args) => Promise<NextResponse> {
  return async (...args: Args) => {
    try {
      return await handler(...args);
    } catch (err) {
      if (err instanceof ApiError) {
        return NextResponse.json(err.toEnvelope(), { status: err.status });
      }
      if (err instanceof MerchantNotFoundError) {
        const apiErr = new ApiError("not_found", err.message);
        return NextResponse.json(apiErr.toEnvelope(), { status: apiErr.status });
      }
      if (err instanceof MerchantLimitError) {
        const apiErr = new ApiError("business_rule", err.message);
        return NextResponse.json(apiErr.toEnvelope(), { status: apiErr.status });
      }
      if (err instanceof ZodError) {
        const fieldErrors: Record<string, string> = {};
        for (const issue of err.issues) {
          const key = issue.path.join(".") || "_";
          if (!fieldErrors[key]) fieldErrors[key] = issue.message;
        }
        const apiErr = new ApiError("invalid_input", "Request payload failed validation.", { fieldErrors });
        return NextResponse.json(apiErr.toEnvelope(), { status: apiErr.status });
      }
      // Unexpected: log server-side, return a generic message (no stack traces to clients).
      console.error("[merchant-saathi] unhandled route error:", err);
      return NextResponse.json(
        { error: { code: "internal", message: "Unexpected server error." } },
        { status: 500 }
      );
    }
  };
}

export function parseBody<S extends ZodTypeAny>(schema: S, body: unknown): output<S> {
  const result = schema.safeParse(body);
  if (!result.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const key = issue.path.join(".") || "_";
      if (!fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    throw new ApiError("invalid_input", "Request payload failed validation.", { fieldErrors });
  }
  return result.data;
}

export function ok<T extends object>(data: T, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}
