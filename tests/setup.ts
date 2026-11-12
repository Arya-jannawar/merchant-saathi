// Vitest global setup: isolated test database, injected demo clock, fixture AI mode.
process.env.DATABASE_PATH = "./data/test.sqlite";
process.env.DEMO_MODE = "true";
delete process.env.DEMO_NOW;
delete process.env.AI_MODE;
delete process.env.LLM_API_KEY;
delete process.env.LLM_MODEL;
delete process.env.LLM_BASE_URL;
