// Guards for configuration inputs: database paths and the live model endpoint.
import { describe, expect, it } from "vitest";
import { resolveDatabasePath } from "@/lib/db";
import { validateModelEndpoint } from "@/adapters/ai";

describe("resolveDatabasePath", () => {
  it("accepts the shipped project-relative paths", () => {
    expect(resolveDatabasePath("./data/merchant-saathi.sqlite")).toMatch(/data[\\/]merchant-saathi\.sqlite$/);
    expect(resolveDatabasePath("data/test.sqlite")).toMatch(/data[\\/]test\.sqlite$/);
  });

  it("rejects empty paths, control characters and URL schemes", () => {
    expect(() => resolveDatabasePath("")).toThrow();
    expect(() => resolveDatabasePath("   ")).toThrow();
    expect(() => resolveDatabasePath("data/\0evil.sqlite")).toThrow();
    expect(() => resolveDatabasePath("file:///etc/passwd")).toThrow();
    expect(() => resolveDatabasePath("http://evil/x.sqlite")).toThrow();
  });

  it("rejects paths that escape the project directory", () => {
    expect(() => resolveDatabasePath("../outside.sqlite")).toThrow();
    expect(() => resolveDatabasePath("data/../../outside.sqlite")).toThrow();
  });
});

describe("validateModelEndpoint", () => {
  it("accepts the public Z.ai endpoint and other public https hosts", () => {
    expect(validateModelEndpoint("https://api.z.ai/api/paas/v4").hostname).toBe("api.z.ai");
    expect(validateModelEndpoint("http://api.example.com/v1").protocol).toBe("http:");
  });

  it("refuses non-http(s) schemes", () => {
    expect(() => validateModelEndpoint("ftp://api.z.ai/v4")).toThrow();
    expect(() => validateModelEndpoint("file:///etc/passwd")).toThrow();
  });

  it("refuses localhost-style and reserved-suffix hosts", () => {
    expect(() => validateModelEndpoint("http://localhost:8080/v1")).toThrow();
    expect(() => validateModelEndpoint("http://api.localhost/v1")).toThrow();
    expect(() => validateModelEndpoint("http://printer.local/v1")).toThrow();
    expect(() => validateModelEndpoint("http://db.internal/v1")).toThrow();
  });

  it("refuses loopback, private, link-local and reserved IPv4 literals", () => {
    expect(() => validateModelEndpoint("http://127.0.0.1:11434/v1")).toThrow();
    expect(() => validateModelEndpoint("http://10.1.2.3/v1")).toThrow();
    expect(() => validateModelEndpoint("http://172.16.0.9/v1")).toThrow();
    expect(() => validateModelEndpoint("http://192.168.1.10/v1")).toThrow();
    expect(() => validateModelEndpoint("http://169.254.169.254/v1")).toThrow();
    expect(() => validateModelEndpoint("http://0.0.0.0/v1")).toThrow();
    expect(() => validateModelEndpoint("http://224.0.0.1/v1")).toThrow();
  });

  it("refuses IPv6 loopback, unique-local and link-local literals", () => {
    expect(() => validateModelEndpoint("http://[::1]/v1")).toThrow();
    expect(() => validateModelEndpoint("http://[::]/v1")).toThrow();
    expect(() => validateModelEndpoint("http://[fd00::1]/v1")).toThrow();
    expect(() => validateModelEndpoint("http://[fe80::1]/v1")).toThrow();
  });

  it("applies IPv4 rules to IPv4-mapped IPv6 addresses", () => {
    expect(() => validateModelEndpoint("http://[::ffff:127.0.0.1]/v1")).toThrow();
    expect(() => validateModelEndpoint("http://[::ffff:192.168.0.5]/v1")).toThrow();
  });
});
