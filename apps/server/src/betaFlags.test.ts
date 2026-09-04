/**
 * The switches a young deployment wants off (beta defaults).
 *
 * Each of these is a feature that carries operational risk out of proportion
 * to what it gives a small, invited group of players: an edge worker in front
 * of the whole site, matchmaking with strangers, and abuse ceilings tuned for
 * one household per address. They are configuration, not deletions, so
 * turning one on later is a variable rather than a revert.
 */
import { describe, expect, it } from "vitest";
import { parseEnv } from "./env.js";
import { DEFAULT_QUOTAS, Quotas } from "./quota.js";

const base = { APP_ENV: "development" } as NodeJS.ProcessEnv;

describe("quota overrides", () => {
  it("changes nothing when nothing is set", () => {
    expect(parseEnv(base).quotas).toEqual({});
    // Which means the shipped defaults are what a room manager gets.
    expect(new Quotas({ ...DEFAULT_QUOTAS, ...parseEnv(base).quotas }).config).toEqual(
      DEFAULT_QUOTAS,
    );
  });

  it("raises only the ceiling an operator names", () => {
    const env = parseEnv({ ...base, QUOTA_ROOMS_PER_HOUR: "200" });
    const config = new Quotas({ ...DEFAULT_QUOTAS, ...env.quotas }).config;
    expect(config.createRooms.limit).toBe(200);
    // Raising one ceiling must not quietly widen the code-sweeping one too.
    expect(config.failedJoins).toEqual(DEFAULT_QUOTAS.failedJoins);
    expect(config.connectionsPerIp).toBe(DEFAULT_QUOTAS.connectionsPerIp);
  });

  it("takes every ceiling at once", () => {
    const env = parseEnv({
      ...base,
      QUOTA_CONNECTIONS_PER_IP: "64",
      QUOTA_ROOMS_PER_HOUR: "300",
      QUOTA_FAILED_JOINS: "100",
      QUOTA_AUTH_REQUESTS: "60",
    });
    const config = new Quotas({ ...DEFAULT_QUOTAS, ...env.quotas }).config;
    expect(config.connectionsPerIp).toBe(64);
    expect(config.createRooms.limit).toBe(300);
    expect(config.failedJoins.limit).toBe(100);
    expect(config.authRequests.limit).toBe(60);
  });

  it("refuses a value that is not a number, rather than falling back silently", () => {
    expect(() => parseEnv({ ...base, QUOTA_ROOMS_PER_HOUR: "lots" })).toThrow();
  });
});

describe("optional infrastructure stays optional", () => {
  it("has no Redis, no CAPTCHA and no TURN unless configured", () => {
    const env = parseEnv(base);
    expect(env.redisUrl).toBeUndefined();
    expect(env.captchaSecret).toBeUndefined();
    expect(env.turn).toBeNull();
  });

  it("needs both a URL list and a secret before TURN is considered configured", () => {
    expect(parseEnv({ ...base, TURN_URLS: "turn:t:3478" }).turn).toBeNull();
    expect(parseEnv({ ...base, TURN_SECRET: "supersecret" }).turn).toBeNull();
    expect(
      parseEnv({ ...base, TURN_URLS: "turn:t:3478", TURN_SECRET: "supersecret" }).turn,
    ).toEqual({ urls: ["turn:t:3478"], secret: "supersecret" });
  });
});
