/**
 * Error envelope: { error: { code, message, fieldErrors?, retryable? } }.
 * Never leaks other tenants' record existence or internal stack traces.
 */

export type ErrorCode =
  | "invalid_input" // 400
  | "missing_session" // 401
  | "disallowed" // 403
  | "not_found" // 404
  | "stale_preview" // 409
  | "stale_version" // 409
  | "conflict" // 409
  | "business_rule" // 422
  | "stale_inventory" // 422
  | "stale_consent" // 422
  | "expired" // 422
  | "cap_reached" // 422
  | "rate_limited" // 429
  | "ai_unavailable"; // 503

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  invalid_input: 400,
  missing_session: 401,
  disallowed: 403,
  not_found: 404,
  stale_preview: 409,
  stale_version: 409,
  conflict: 409,
  business_rule: 422,
  stale_inventory: 422,
  stale_consent: 422,
  expired: 422,
  cap_reached: 422,
  rate_limited: 429,
  ai_unavailable: 503,
};

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly fieldErrors?: Record<string, string>;
  readonly retryable?: boolean;

  constructor(code: ErrorCode, message: string, opts?: { fieldErrors?: Record<string, string>; retryable?: boolean }) {
    super(message);
    this.code = code;
    this.fieldErrors = opts?.fieldErrors;
    this.retryable = opts?.retryable;
  }

  get status(): number {
    return STATUS_BY_CODE[this.code];
  }

  toEnvelope(): { error: { code: ErrorCode; message: string; fieldErrors?: Record<string, string>; retryable?: boolean } } {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.fieldErrors ? { fieldErrors: this.fieldErrors } : {}),
        ...(this.retryable !== undefined ? { retryable: this.retryable } : {}),
      },
    };
  }
}
