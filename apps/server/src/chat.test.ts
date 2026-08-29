import { afterEach, describe, expect, it } from "vitest";
import type { ChatMessageView, ChatReactionView, RoomJoined } from "@deckxi/shared";
import { TokenBucket } from "./rateLimit.js";
import { startTestServer, type TestClient, type TestServer } from "./testkit.js";

let server: TestServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

async function chatRoom(limits?: Parameters<typeof startTestServer>[0]["limits"]): Promise<{
  s: TestServer;
  host: TestClient;
  guest: TestClient;
  joined: RoomJoined;
}> {
  server = await startTestServer({ limits });
  const s = server;
  const host = s.client();
  await host.connected();
  const joined = await host.call<RoomJoined>("room:create", { name: "Host" });
  const guest = s.client();
  await guest.connected();
  await guest.call("room:join", { code: joined.room.code, name: "Guest" });
  return { s, host, guest, joined };
}

describe("token bucket", () => {
  it("enforces burst then refills over time", () => {
    const bucket = new TokenBucket(2, 1, 0);
    expect(bucket.tryTake(0)).toBe(true);
    expect(bucket.tryTake(0)).toBe(true);
    expect(bucket.tryTake(0)).toBe(false);
    expect(bucket.tryTake(1000)).toBe(true);
    expect(bucket.tryTake(1001)).toBe(false);
  });
});

describe("chat and reactions", () => {
  it("delivers chat to everyone in the room, sender included", async () => {
    const { host, guest } = await chatRoom();
    const toHost = host.next<ChatMessageView>("chat:message");
    const toGuest = guest.next<ChatMessageView>("chat:message");
    await guest.call("chat:send", { text: "howzat!" });
    const [a, b] = await Promise.all([toHost, toGuest]);
    expect(a).toMatchObject({ from: { name: "Guest" }, text: "howzat!" });
    expect(b.at).toBeGreaterThan(0);
  });

  it("delivers emote reactions and rejects unknown emotes", async () => {
    const { host, guest } = await chatRoom();
    const seen = guest.collect<ChatReactionView>("chat:reaction");
    await host.call("chat:react", { emote: "🔥" });
    await expect.poll(() => seen.at(-1)?.emote).toBe("🔥");
    expect(await host.callRaw("chat:react", { emote: "💣" })).toMatchObject({
      ok: false,
      code: "bad-request",
    });
  });

  it("lets spectators chat too", async () => {
    const { s, host, joined } = await chatRoom();
    const spec = s.client();
    await spec.connected();
    await spec.call("room:join", { code: joined.room.code, name: "Watcher", spectator: true });
    const toHost = host.next<ChatMessageView>("chat:message");
    await spec.call("chat:send", { text: "nice shot" });
    expect(await toHost).toMatchObject({ from: { name: "Watcher" } });
  });

  it("requires being in a room", async () => {
    server = await startTestServer();
    const lonely = server.client();
    await lonely.connected();
    expect(await lonely.callRaw("chat:send", { text: "hello?" })).toMatchObject({
      ok: false,
      code: "not-in-room",
    });
  });

  it("rate-limits chat per sender without touching others", async () => {
    const { host, guest } = await chatRoom({ chat: { capacity: 2, refillPerSec: 0.01 } });
    await guest.call("chat:send", { text: "one" });
    await guest.call("chat:send", { text: "two" });
    expect(await guest.callRaw("chat:send", { text: "three" })).toMatchObject({
      ok: false,
      code: "rate-limited",
    });
    // The other player's budget is untouched.
    await host.call("chat:send", { text: "still fine" });
  });

  it("applies a global inbound ceiling across message types", async () => {
    const { guest } = await chatRoom({ global: { capacity: 3, refillPerSec: 0.01 } });
    // room:join already spent one token; a burst of readies exhausts the rest.
    const results = [];
    for (let i = 0; i < 5; i++) results.push(await guest.callRaw("room:ready", { ready: true }));
    expect(results.some((r) => r.ok === false && r.code === "rate-limited")).toBe(true);
  });
});
