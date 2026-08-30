import { describe, expect, it } from "vitest";
import { originMatcher, parseOrigins } from "./origins.js";
import { parseEnv } from "./env.js";

const DEPLOYED = {
  APP_ENV: "production",
  DATABASE_URL: "postgres://user:pw@db.example/deckxi",
  BETTER_AUTH_SECRET: "a-secret-that-is-long-enough",
  BETTER_AUTH_URL: "https://api.deckxi.rishikeshs.dev",
  CORS_ORIGINS: "https://deckxi.rishikeshs.dev",
};

describe("origin allowlist", () => {
  it("splits and trims patterns", () => {
    expect(parseOrigins(" https://a.example , https://b.example ,")).toEqual([
      "https://a.example",
      "https://b.example",
    ]);
  });

  it("matches exact origins only, scheme and port included", () => {
    const allow = originMatcher(["https://deckxi.rishikeshs.dev"]);
    expect(allow("https://deckxi.rishikeshs.dev")).toBe(true);
    expect(allow("http://deckxi.rishikeshs.dev")).toBe(false);
    expect(allow("https://deckxi.rishikeshs.dev:8443")).toBe(false);
    expect(allow("https://evil.example")).toBe(false);
  });

  it("allows a wildcard label for preview deploys", () => {
    const allow = originMatcher(["https://*.deckxi-web.pages.dev"]);
    expect(allow("https://pr-12.deckxi-web.pages.dev")).toBe(true);
    expect(allow("https://deckxi-web.pages.dev")).toBe(false);
    expect(allow("https://a.b.deckxi-web.pages.dev")).toBe(false);
    expect(allow("https://evil.example/x.deckxi-web.pages.dev")).toBe(false);
  });

  it("allows requests with no Origin header (health checks, curl)", () => {
    expect(originMatcher(["https://deckxi.rishikeshs.dev"])(undefined)).toBe(true);
  });
});

describe("deployment env guardrails", () => {
  it("keeps dev defaults when APP_ENV is development", () => {
    const env = parseEnv({});
    expect(env.appEnv).toBe("development");
    expect(env.corsOrigins).toEqual(["http://localhost:5173"]);
    expect(env.databaseUrl).toBeUndefined();
  });

  it("accepts a fully configured deployment", () => {
    const env = parseEnv({ ...DEPLOYED });
    expect(env.appEnv).toBe("production");
    expect(env.corsOrigins).toEqual(["https://deckxi.rishikeshs.dev"]);
  });

  it.each(["DATABASE_URL", "BETTER_AUTH_SECRET", "BETTER_AUTH_URL", "CORS_ORIGINS"])(
    "refuses to boot a deployment without %s",
    (key) => {
      const source: Record<string, string> = { ...DEPLOYED };
      delete source[key];
      expect(() => parseEnv(source)).toThrow(key);
    },
  );
});
