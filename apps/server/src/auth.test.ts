/**
 * Phase 6 — identity. Guest (anonymous) sessions over HTTP, socket handshake
 * auth, profile/history REST, guest→account upgrade via magic link, and
 * account deletion scrubbing match history.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isAvatarId, type RoomJoined } from "@deckxi/shared";
import { startTestServer, type TestServer } from "./testkit.js";
import { InMemoryMatchStore, DELETED_PLAYER_NAME } from "./store.js";
import type { MagicLinkMail } from "./auth.js";

/** Extract request Cookie header value from a response's Set-Cookie list. */
function cookiesOf(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((c) => c.split(";")[0] as string)
    .filter((c) => !c.endsWith("="))
    .join("; ");
}

interface SessionUser {
  id: string;
  name: string;
  image: string | null;
  isAnonymous?: boolean;
  email: string;
}

async function signInGuest(url: string): Promise<{ cookie: string; user: SessionUser }> {
  const response = await fetch(`${url}/api/auth/sign-in/anonymous`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  expect(response.status).toBe(200);
  const body = (await response.json()) as { user: SessionUser };
  return { cookie: cookiesOf(response), user: body.user };
}

describe("guest identity", () => {
  let server: TestServer;
  const links: MagicLinkMail[] = [];

  beforeEach(async () => {
    links.length = 0;
    server = await startTestServer({
      store: new InMemoryMatchStore(),
      auth: { sendMagicLink: (mail) => void links.push(mail) },
    });
  });
  afterEach(async () => {
    await server.close();
  });

  it("anonymous sign-in creates a guest with a cricket handle and avatar", async () => {
    const { cookie, user } = await signInGuest(server.url);
    expect(cookie).toContain("better-auth.session_token");
    expect(user.name).toMatch(/^[A-Za-z]+\d{1,2}$/);
    expect(user.isAnonymous).toBe(true);
    expect(user.image).not.toBeNull();
    expect(isAvatarId(user.image as string)).toBe(true);
  });

  it("socket handshake resolves the session cookie into a user identity", async () => {
    const { cookie, user } = await signInGuest(server.url);
    const authed = server.client({ cookie });
    const guestOnly = server.client();
    const created = await authed.call<RoomJoined>("room:create", { name: "Host" });
    await guestOnly.call<RoomJoined>("room:join", { code: created.room.code, name: "Anon" });
    await guestOnly.call("room:ready", { ready: true });
    await authed.call("room:start");

    const me = await fetch(`${server.url}/api/me/matches`, { headers: { cookie } });
    expect(me.status).toBe(200);
    const { matches } = (await me.json()) as {
      matches: { players: { name: string; userId: string | null }[] }[];
    };
    expect(matches).toHaveLength(1);
    const first = matches[0] as (typeof matches)[number];
    // The account's display name is the name at the table, not the payload's.
    expect(first.players.find((p) => p.userId === user.id)?.name).toBe(user.name);
    expect(first.players.find((p) => p.name === "Host")).toBeUndefined();
    expect(first.players.find((p) => p.name === "Anon")?.userId).toBeNull();
  });

  it("/api/me returns profile and stats, and hides the guest placeholder email", async () => {
    const { cookie } = await signInGuest(server.url);
    const response = await fetch(`${server.url}/api/me`, { headers: { cookie } });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      user: { email: string | null; isAnonymous: boolean };
      stats: { games: number; wins: number; favouriteStat: string | null };
    };
    expect(body.user.isAnonymous).toBe(true);
    expect(body.user.email).toBeNull();
    expect(body.stats).toEqual({ games: 0, wins: 0, favouriteStat: null, byMode: {} });
  });

  it("rejects profile requests without a session", async () => {
    const response = await fetch(`${server.url}/api/me`);
    expect(response.status).toBe(401);
  });

  it("magic-link sign-in upgrades the guest and migrates match history", async () => {
    const { cookie, user: guest } = await signInGuest(server.url);

    // The guest plays (a match record with their userId).
    const authed = server.client({ cookie });
    const other = server.client();
    const created = await authed.call<RoomJoined>("room:create", { name: "Guesty" });
    await other.call<RoomJoined>("room:join", { code: created.room.code, name: "Rival" });
    await other.call("room:ready", { ready: true });
    await authed.call("room:start");

    // Request a magic link while signed in as the guest, then visit it.
    const request = await fetch(`${server.url}/api/auth/sign-in/magic-link`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ email: "fan@example.com" }),
    });
    expect(request.status).toBe(200);
    expect(links).toHaveLength(1);
    const mail = links[0] as MagicLinkMail;
    expect(mail.email).toBe("fan@example.com");

    // The link is built on the configured baseURL; point it at the test port.
    const verify = await fetch(mail.url.replace("http://localhost:3001", server.url), {
      headers: { cookie },
      redirect: "manual",
    });
    expect([200, 302]).toContain(verify.status);
    const upgraded = cookiesOf(verify);

    const me = await fetch(`${server.url}/api/me`, { headers: { cookie: upgraded } });
    expect(me.status).toBe(200);
    const body = (await me.json()) as {
      user: { id: string; email: string | null; isAnonymous: boolean };
      stats: { games: number };
    };
    expect(body.user.isAnonymous).toBe(false);
    expect(body.user.email).toBe("fan@example.com");
    expect(body.user.id).not.toBe(guest.id);
    // History carried over to the new account.
    expect(body.stats.games).toBe(1);
    const history = await fetch(`${server.url}/api/me/matches`, {
      headers: { cookie: upgraded },
    });
    const { matches } = (await history.json()) as { matches: unknown[] };
    expect(matches).toHaveLength(1);
  });

  it("account deletion scrubs the user's match history rows", async () => {
    const store = new InMemoryMatchStore();
    await server.close();
    server = await startTestServer({ store });

    const { cookie, user } = await signInGuest(server.url);
    await store.createMatch({
      matchId: "m1",
      roomId: "r1",
      roomCode: "ABCDEF",
      editionId: "edition-2025-q3",
      gameMode: "classic-trumps",
      startedAt: new Date(),
      players: [{ sessionId: "s1", userId: user.id, name: user.name, seat: 0 }],
    });

    const response = await fetch(`${server.url}/api/auth/delete-user`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: "{}",
    });
    expect(response.status).toBe(200);

    const match = store.matches.get("m1");
    expect(match?.players[0]?.userId).toBeNull();
    expect(match?.players[0]?.name).toBe(DELETED_PLAYER_NAME);

    const me = await fetch(`${server.url}/api/me`, { headers: { cookie } });
    expect(me.status).toBe(401);
  });
});
