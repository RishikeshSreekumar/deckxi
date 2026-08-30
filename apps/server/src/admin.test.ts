/**
 * Phase 8 — admin access and the live rooms view (#67).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RoomJoined } from "@deckxi/shared";
import { startTestServer, type TestServer } from "./testkit.js";
import { toAdminRoomSummary } from "./admin.js";
import type { MagicLinkMail } from "./auth.js";
import type { Room } from "./rooms.js";

const TOKEN = "an-admin-token-of-real-length";
const ADMIN_EMAIL = "boss@example.com";

let server: TestServer;
const links: MagicLinkMail[] = [];

function cookiesOf(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((c) => c.split(";")[0] as string)
    .filter((c) => !c.endsWith("="))
    .join("; ");
}

/** Sign in with a real (non-guest) account at `email`, and return its cookie. */
async function signIn(email: string): Promise<string> {
  const before = links.length;
  const requested = await fetch(`${server.url}/api/auth/sign-in/magic-link`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email }),
  });
  expect(requested.status).toBe(200);
  const mail = links[before] as MagicLinkMail;
  const verified = await fetch(mail.url.replace("http://localhost:3001", server.url), {
    redirect: "manual",
  });
  expect([200, 302]).toContain(verified.status);
  return cookiesOf(verified);
}

async function signInGuest(): Promise<string> {
  const response = await fetch(`${server.url}/api/auth/sign-in/anonymous`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  return cookiesOf(response);
}

beforeEach(async () => {
  links.length = 0;
  server = await startTestServer({
    admin: { token: TOKEN, emails: [` ${ADMIN_EMAIL.toUpperCase()} `] },
    auth: { sendMagicLink: (mail) => void links.push(mail) },
  });
});

afterEach(async () => {
  await server.close();
});

const get = (path: string, headers: Record<string, string> = {}): Promise<Response> =>
  fetch(`${server.url}${path}`, { headers });

describe("admin authorisation", () => {
  it("answers 404, not 401, to a caller with no credentials", async () => {
    const response = await get("/api/admin/rooms");
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not found" });
  });

  it("accepts the bearer token", async () => {
    const response = await get("/api/admin/session", { authorization: `Bearer ${TOKEN}` });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ admin: true, via: "token", email: null });
  });

  it("refuses a token that is close but not equal", async () => {
    expect((await get("/api/admin/session", { authorization: `Bearer ${TOKEN}x` })).status).toBe(
      404,
    );
    expect(
      (await get("/api/admin/session", { authorization: `Bearer ${TOKEN.slice(0, -1)}X` })).status,
    ).toBe(404);
  });

  it("accepts an allowlisted account, ignoring case and surrounding space", async () => {
    const cookie = await signIn(ADMIN_EMAIL);
    const response = await get("/api/admin/session", { cookie });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ admin: true, via: "session", email: ADMIN_EMAIL });
  });

  it("refuses an account that isn't on the list", async () => {
    const cookie = await signIn("someone@example.com");
    expect((await get("/api/admin/session", { cookie })).status).toBe(404);
  });

  it("refuses a guest, whose placeholder email must never match", async () => {
    const cookie = await signInGuest();
    expect((await get("/api/admin/session", { cookie })).status).toBe(404);
  });

  it("lets nobody in when neither a token nor emails are configured", async () => {
    await server.close();
    server = await startTestServer();
    expect((await get("/api/admin/session")).status).toBe(404);
  });
});

describe("live rooms", () => {
  it("lists open rooms with phase, occupancy and the match in progress", async () => {
    const host = server.client();
    await host.connected();
    const joined = await host.call<RoomJoined>("room:create", { name: "Host" });
    const guest = server.client();
    await guest.connected();
    await guest.call<RoomJoined>("room:join", { code: joined.room.code, name: "Guest" });
    const watcher = server.client();
    await watcher.connected();
    await watcher.call<RoomJoined>("room:join", {
      code: joined.room.code,
      name: "Watcher",
      spectator: true,
    });
    await guest.call("room:ready", { ready: true });
    await host.call("room:start", undefined);

    const response = await get("/api/admin/rooms", { authorization: `Bearer ${TOKEN}` });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      rooms: Record<string, unknown>[];
      counts: { rooms: number; games: number };
    };
    expect(body.counts).toEqual({ rooms: 1, games: 1 });
    expect(body.rooms[0]).toMatchObject({
      roomId: joined.roomId,
      code: joined.room.code,
      phase: "playing",
      gameMode: "classic-trumps",
      hostName: "Host",
      players: 2,
      disconnected: 0,
      spectators: 1,
      round: 1,
    });
    expect(body.rooms[0]?.["matchId"]).toEqual(expect.any(String));
  });

  it("sorts the busiest room first", async () => {
    const quiet = server.client();
    await quiet.connected();
    await quiet.call<RoomJoined>("room:create", { name: "Alone" });
    const host = server.client();
    await host.connected();
    const busy = await host.call<RoomJoined>("room:create", { name: "Host" });
    const guest = server.client();
    await guest.connected();
    await guest.call<RoomJoined>("room:join", { code: busy.room.code, name: "Guest" });

    const body = (await (
      await get("/api/admin/rooms", { authorization: `Bearer ${TOKEN}` })
    ).json()) as { rooms: { roomId: string }[] };
    expect(body.rooms[0]?.roomId).toBe(busy.roomId);
  });
});

describe("room summary", () => {
  it("counts players still inside their reconnect grace as disconnected", () => {
    const room = {
      id: "r",
      code: "ABCDEF",
      phase: "playing",
      hostId: "p1",
      settings: { gameMode: "classic-trumps", editionId: "edition-2025-q3" },
      players: [
        { id: "p1", name: "Host", connected: true },
        { id: "p2", name: "Ghost", connected: false },
      ],
      spectators: [],
      game: { matchId: "m1", state: { round: 4 } },
      lastActivityAt: 1_000,
    } as unknown as Room;
    expect(toAdminRoomSummary(room, 31_000)).toMatchObject({
      hostName: "Host",
      players: 2,
      disconnected: 1,
      round: 4,
      matchId: "m1",
      idleSeconds: 30,
    });
  });
});
