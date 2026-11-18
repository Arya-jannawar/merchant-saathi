// Vitest global setup: hosted test database, injected demo clock, fixture AI mode.
import fs from "node:fs";

process.env.DEMO_MODE = "true";
delete process.env.DEMO_NOW;
delete process.env.AI_MODE;
delete process.env.LLM_API_KEY;
delete process.env.LLM_MODEL;
delete process.env.LLM_BASE_URL;
if (!process.env.DATABASE_URL) {
  try {
    // .env.local is git-ignored; load just the connection string for the suites.
    const envFile = fs.readFileSync(".env.local", "utf8");
    const match = envFile.match(/^DATABASE_URL=(.*)$/m);
    if (match) {
      process.env.DATABASE_URL = match[1].trim().replace(/^"/, "").replace(/"$/, "");
    }
  } catch {
    // .env.local may not exist in CI - the suites surface a clear
    // DATABASE_URL error in that case.
  }
}
