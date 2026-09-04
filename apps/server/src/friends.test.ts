/**
 * Friends and recent players (#82). The rule worth testing is the one that
 * keeps the list honest: you can only save someone you have actually shared a
 * table with, so nobody can build a directory of strangers by guessing ids.
 */
import { afterEach, describe, expect, it } from "vitest";
import type { RoomJoined } from "@deckxi/shared";
import { InMemoryMatchStore } from "./store.js";
import { startTestServer, type TestServer } from "./testkit.js";

let server: TestServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

async function signIn(url: string): Promise<{ cookie: string; userId: string }> {
  const response = await fetch(`${url}/api/auth/sign-in/anonymous`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  const cookie = (response.headers.getSetCookie() ?? []).map((c) => c.split(";")[0]).join("; ");
  const me = (await (await fetch(`${url}/api/me`, { headers: { cookie } })).json()) as {
    user: { id: string };
  };
  return { cookie, userId: me.user.id };
}

/** Two signed-in accounts finish a game together. */
async function playTogether(s: TestServer, a: string, b: string): Promise<void> {
  const host = s.client({ cookie: a });
  await host.connected();
  const joined = await host.call<RoomJoined>("room:create", {
    name: "A",
    settings: { cardsPerPlayer: 3 },
  });
  const guest = s.client({ cookie: b });
  await guest.connected();
  await guest.call<RoomJoined>("room:join", { code: joined.room.code, name: "B" });
  await guest.call("room:ready", { ready: true });
  await host.call("room:start");
  await guest.call("game:forfeit");
}

describe("recent players", () => {
  it("lists the accounts you shared a table with, and not yourself", async () => {
    server = await startTestServer();
    const s = server;
    const me = await signIn(s.url);
    const them = await signIn(s.url);
    await playTogether(s, me.cookie, them.cookie);

    const body = (await (
      await fetch(`${s.url}/api/me/friends`, { headers: { cookie: me.cookie } })
    ).json()) as { friends: unknown[]; recent: { userId: string; isFriend: boolean }[] };

    expect(body.friends).toEqual([]);
    expect(body.recent.map((p) => p.userId)).toEqual([them.userId]);
    expect(body.recent[0]?.isFriend).toBe(false);
  });

  it("refuses to save someone you have never played with", async () => {
    server = await startTestServer();
    const s = server;
    const me = await signIn(s.url);
    const stranger = await signIn(s.url);

    const response = await fetch(`${s.url}/api/me/friends`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: me.cookie },
      body: JSON.stringify({ userId: stranger.userId }),
    });
    expect(response.status).toBe(403);
  });

  it("saves and forgets someone from a real table", async () => {
    server = await startTestServer();
    const s = server;
    const me = await signIn(s.url);
    const them = await signIn(s.url);
    await playTogether(s, me.cookie, them.cookie);

    const save = await fetch(`${s.url}/api/me/friends`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: me.cookie },
      body: JSON.stringify({ userId: them.userId }),
    });
    expect(save.status).toBe(204);

    const after = (await (
      await fetch(`${s.url}/api/me/friends`, { headers: { cookie: me.cookie } })
    ).json()) as { friends: { userId: string }[]; recent: { isFriend: boolean }[] };
    expect(after.friends.map((f) => f.userId)).toEqual([them.userId]);
    expect(after.recent[0]?.isFriend).toBe(true);

    // The list is one-directional: they have not gained a friend by being saved.
    const theirs = (await (
      await fetch(`${s.url}/api/me/friends`, { headers: { cookie: them.cookie } })
    ).json()) as { friends: unknown[] };
    expect(theirs.friends).toEqual([]);

    const forget = await fetch(`${s.url}/api/me/friends/${them.userId}`, {
      method: "DELETE",
      headers: { cookie: me.cookie },
    });
    expect(forget.status).toBe(204);
  });
});

describe("the friends store", () => {
  it("drops a deleted account from everyone's list, not just its own", async () => {
    const store = new InMemoryMatchStore();
    await store.addFriend("a", "b");
    await store.addFriend("b", "a");
    await store.anonymizeUser("a");
    expect(await store.listFriends("a")).toEqual([]);
    expect(await store.listFriends("b")).toEqual([]);
  });

  it("treats saving twice as a no-op", async () => {
    const store = new InMemoryMatchStore();
    await store.addFriend("a", "b");
    await store.addFriend("a", "b");
    expect(await store.listFriends("a")).toHaveLength(1);
  });
});
