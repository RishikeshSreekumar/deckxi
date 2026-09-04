/**
 * Abuse quotas (#87). Two layers of test: the counters on their own (where
 * time can be moved by hand), and the socket layer end to end, where the
 * question is whether a script gets stopped and a player does not.
 */
import { afterEach, describe, expect, it } from "vitest";
import type { Ack, RoomJoined } from "@deckxi/shared";
import {
  clientIp,
  ConnectionCounter,
  isLoopback,
  QuotaCounter,
  Quotas,
  quotaKeys,
} from "./quota.js";
import { startTestServer, type TestServer } from "./testkit.js";

describe("QuotaCounter", () => {
  it("allows a limit's worth and refuses the rest", () => {
    const counter = new QuotaCounter({ limit: 3, windowMs: 1000 });
    expect([1, 2, 3].map(() => counter.take("a", 0))).toEqual([true, true, true]);
    expect(counter.take("a", 0)).toBe(false);
    // Another key has its own budget.
    expect(counter.take("b", 0)).toBe(true);
  });

  it("starts a fresh window once the old one expires", () => {
    const counter = new QuotaCounter({ limit: 1, windowMs: 1000 });
    expect(counter.take("a", 0)).toBe(true);
    expect(counter.take("a", 500)).toBe(false);
    expect(counter.take("a", 1000)).toBe(true);
  });

  it("prunes expired windows so idle keys cannot leak", () => {
    const counter = new QuotaCounter({ limit: 5, windowMs: 1000 });
    counter.take("a", 0);
    counter.take("b", 0);
    expect(counter.size).toBe(2);
    counter.prune(2000);
    expect(counter.size).toBe(0);
  });
});

describe("ConnectionCounter", () => {
  it("caps concurrent sockets per address and releases on close", () => {
    const counter = new ConnectionCounter(2);
    expect(counter.add("9.9.9.9")).toBe(true);
    expect(counter.add("9.9.9.9")).toBe(true);
    expect(counter.add("9.9.9.9")).toBe(false);
    counter.remove("9.9.9.9");
    expect(counter.add("9.9.9.9")).toBe(true);
  });

  it("never counts loopback — that is us, not a client", () => {
    const counter = new ConnectionCounter(1);
    expect(counter.add("127.0.0.1")).toBe(true);
    expect(counter.add("127.0.0.1")).toBe(true);
    expect(isLoopback("::1")).toBe(true);
  });
});

describe("source keys", () => {
  it("charges both the account and the address when signed in", () => {
    expect(quotaKeys("user-1", "9.9.9.9")).toEqual(["user:user-1", "ip:9.9.9.9"]);
    expect(quotaKeys(null, "9.9.9.9")).toEqual(["ip:9.9.9.9"]);
  });

  it("takes the first forwarded address and never the rest of the chain", () => {
    expect(clientIp({ "x-forwarded-for": "1.1.1.1, 2.2.2.2" }, "10.0.0.1")).toBe("1.1.1.1");
    expect(clientIp({}, "10.0.0.1")).toBe("10.0.0.1");
    expect(clientIp({}, undefined)).toBe("unknown");
  });
});

describe("abuse signal", () => {
  it("flags a source once it is halfway through the failed-join budget", () => {
    const quotas = new Quotas({
      connectionsPerIp: 10,
      createRooms: { limit: 10, windowMs: 1000 },
      failedJoins: { limit: 4, windowMs: 1000 },
      authRequests: { limit: 10, windowMs: 1000 },
    });
    expect(quotas.suspicious("ip:9.9.9.9")).toBe(false);
    quotas.failedJoins.take("ip:9.9.9.9");
    quotas.failedJoins.take("ip:9.9.9.9");
    expect(quotas.suspicious("ip:9.9.9.9")).toBe(true);
  });
});

describe("over the wire", () => {
  let server: TestServer | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it("refuses to open more rooms than the quota allows", async () => {
    server = await startTestServer({
      quotas: { createRooms: { limit: 2, windowMs: 60_000 } },
    });

    for (let i = 0; i < 2; i++) {
      const client = server.client();
      await client.connected();
      await client.call<RoomJoined>("room:create", { name: `Host ${i}` });
    }

    const extra = server.client();
    await extra.connected();
    const reply = await extra.callRaw<RoomJoined>("room:create", { name: "One too many" });
    expect(reply.ok).toBe(false);
    if (!reply.ok) expect(reply.code).toBe("quota-exceeded");
  });

  it("stops a client sweeping join codes, and lets a real code through first", async () => {
    server = await startTestServer({
      quotas: { failedJoins: { limit: 3, windowMs: 60_000 } },
    });
    const host = server.client();
    await host.connected();
    const joined = await host.call<RoomJoined>("room:create", { name: "Host" });
    const code = joined.room.code;

    const sweeper = server.client();
    await sweeper.connected();
    const codes = ["AAAAAA", "BBBBBB", "CCCCCC", "DDDDDD"];
    const replies: Ack<RoomJoined>[] = [];
    for (const guess of codes) {
      replies.push(await sweeper.callRaw<RoomJoined>("room:join", { code: guess, name: "Bot" }));
    }
    expect(replies.every((r) => !r.ok)).toBe(true);
    expect(replies.slice(0, 3).map((r) => (r.ok ? "ok" : r.code))).toEqual([
      "room-not-found",
      "room-not-found",
      "room-not-found",
    ]);
    expect(replies[3]?.ok === false && replies[3].code).toBe("quota-exceeded");

    // The quota is per source, so someone else's correct code still works.
    const guest = server.client();
    await guest.connected();
    await expect(
      guest.call<RoomJoined>("room:join", { code, name: "Guest" }),
    ).resolves.toBeTruthy();
  });

  it("asks a flagged source for a CAPTCHA when one is configured", async () => {
    const solved = "solved-token";
    server = await startTestServer({
      quotas: { failedJoins: { limit: 4, windowMs: 60_000 } },
      captcha: { verify: (token) => Promise.resolve(token === solved) },
    });
    const host = server.client();
    await host.connected();
    const joined = await host.call<RoomJoined>("room:create", { name: "Host" });

    const sweeper = server.client();
    await sweeper.connected();
    // Two wrong codes is halfway through the budget — enough to be flagged.
    await sweeper.callRaw("room:join", { code: "AAAAAA", name: "Bot" });
    await sweeper.callRaw("room:join", { code: "BBBBBB", name: "Bot" });

    const challenged = await sweeper.callRaw<RoomJoined>("room:join", {
      code: joined.room.code,
      name: "Bot",
    });
    expect(challenged.ok === false && challenged.code).toBe("captcha-required");

    const wrongToken = await sweeper.callRaw<RoomJoined>("room:join", {
      code: joined.room.code,
      name: "Bot",
      captchaToken: "not-solved",
    });
    expect(wrongToken.ok === false && wrongToken.code).toBe("captcha-required");

    // Solved: the same join goes through, because the challenge is about who
    // is asking, not about the request being wrong.
    await expect(
      sweeper.call<RoomJoined>("room:join", {
        code: joined.room.code,
        name: "Bot",
        captchaToken: solved,
      }),
    ).resolves.toBeTruthy();
  });

  it("throttles the auth endpoints, where every request costs an email", async () => {
    server = await startTestServer({
      quotas: { authRequests: { limit: 2, windowMs: 60_000 } },
    });
    const url = `${server.url}/api/auth/sign-in/magic-link`;
    const send = () =>
      fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "someone@example.com" }),
      });

    await send();
    await send();
    const third = await send();
    expect(third.status).toBe(429);
  });
});
