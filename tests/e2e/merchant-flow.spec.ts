import { test, expect } from "@playwright/test";

/**
 * Hero-path browser flow: seeded data -> evidence -> offer -> unsafe-price
 * rejection -> approval -> simulated queue -> simulated redemptions -> results.
 * Requires `npm run build` first (playwright.config.ts starts `next start`).
 */

test("merchant hero path: from decline to simulated contribution", async ({ page }) => {
  // 1. Dashboard: load sample data
  await page.goto("/merchant");
  await page.getByRole("button", { name: /load sample data/i }).click();
  await expect(page.getByText("Completed 3-6 p.m. orders", { exact: false })).toBeVisible();
  await expect(page.getByText("-30.0%").first()).toBeVisible();

  // 2. Offer workspace: prepare the draft
  await page.getByRole("link", { name: /build offer/i }).first().click();
  await expect(page).toHaveURL(/\/merchant\/offer/);
  await page.getByRole("button", { name: /prepare offer draft/i }).click();
  await expect(page.getByText(/passes the 25% margin floor/i)).toBeVisible();
  await expect(page.getByText("AI mode:", { exact: false })).toBeVisible();

  // 3. Unsafe price is rejected before anything can be queued
  await page.getByLabel("Offer price in rupees").fill("50");
  await page.getByRole("button", { name: /update draft/i }).click();
  await expect(page.getByText(/below the 25% floor/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /approve this exact version/i })).toBeDisabled();

  // 4. Restore the safe price, approve the exact preview, queue the simulated campaign
  await page.getByLabel("Offer price in rupees").fill("70");
  await page.getByRole("button", { name: /update draft/i }).click();
  await expect(page.getByText(/passes the 25% margin floor/i)).toBeVisible();
  await page.getByRole("button", { name: /approve this exact version/i }).click();
  await expect(page.getByText(/approved \(/i)).toBeVisible();
  await page.getByRole("button", { name: /queue simulated campaign/i }).click();
  await expect(page.getByRole("link", { name: /view campaign activity/i })).toBeVisible();

  // 5. Campaign activity: 40 simulated recipients, apply all redemptions
  await page.getByRole("link", { name: /view campaign activity/i }).click();
  await expect(page.getByText(/40 recipients - simulated, never sent/i)).toBeVisible();
  await page.getByRole("button", { name: /apply all 10 events/i }).click();
  await expect(page.getByText("\u20B9300")).toBeVisible(); // contribution toward fixed costs

  // 6. Duplicate event replay changes nothing
  await page.getByRole("button", { name: /re-apply R-003/i }).click();
  await expect(page.getByText(/changed nothing \(idempotent\)/i)).toBeVisible();
});
