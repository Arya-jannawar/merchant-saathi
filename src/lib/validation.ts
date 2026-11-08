import { z } from "zod";

export const draftRequestSchema = z.object({
  campaignId: z
    .string()
    .regex(/^cmp_[a-z0-9]{4,32}$/, "Invalid campaign id format.")
    .optional(),
  opportunityId: z.string().regex(/^[a-z0-9-]{3,64}$/, "Invalid opportunity id."),
  offer: z.object({
    pricePaise: z
      .number()
      .int("Price must be a whole number of paise.")
      .min(0, "Price cannot be negative.")
      .max(10_000_000, "Price is unreasonably large."),
    cap: z
      .number()
      .int("Cap must be a whole number.")
      .min(0, "Cap cannot be negative.")
      .max(10_000, "Cap is unreasonably large."),
  }),
  locale: z.enum(["en", "hi"]).default("en"),
  // Owner-reviewed copy override: owner text is allowed; monetary terms still render from computed fields.
  copyOverride: z
    .object({
      title: z.string().min(3).max(80),
      body: z.string().min(10).max(400),
    })
    .optional(),
});

export const approveRequestSchema = z.object({
  version: z.number().int().min(1),
  previewHash: z.string().regex(/^[a-f0-9]{64}$/, "Invalid preview hash."),
});

export const executeRequestSchema = z.object({
  version: z.number().int().min(1),
  idempotencyKey: z
    .string()
    .min(8, "Idempotency key too short.")
    .max(64, "Idempotency key too long.")
    .regex(/^[A-Za-z0-9_-]+$/, "Idempotency key may contain letters, digits, dashes and underscores only.")
    .optional(),
});

export const redeemRequestSchema = z.object({
  eventId: z.string().regex(/^R-\d{3}$/, "Event id must look like R-001."),
});

export const resetRequestSchema = z.object({
  fixtureVersion: z.enum(["bakery-v1", "bakery-thin-v1"]).optional(),
});
