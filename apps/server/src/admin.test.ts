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

describe("room inspector", () => {
  it("shows server truth, hands included", async () => {
    const host = server.client();
    await host.connected();
    const joined = await host.call<RoomJoined>("room:create", { name: "Host" });
    const guest = server.client();
    await guest.connected();
    await guest.call<RoomJoined>("room:join", { code: joined.room.code, name: "Guest" });
    await guest.call("room:ready", { ready: true });
    await host.call("room:start", undefined);

    const body = (await (
      await get(`/api/admin/rooms/${joined.roomId}`, { authorization: `Bearer ${TOKEN}` })
    ).json()) as {
      room: {
        sessions: { name: string; seat: number }[];
        game: { round: number; leader: string; players: { id: string; hand: string[] }[] };
        recentEvents: { seq: number; type: string }[];
      };
    };
    expect(body.room.sessions.map((s) => s.name).sort()).toEqual(["Guest", "Host"]);
    expect(body.room.game.round).toBe(1);
    // The whole point of the inspector: hands the players cannot see.
    for (const player of body.room.game.players) {
      expect(player.hand.length).toBeGreaterThan(0);
    }
    expect(body.room.recentEvents[0]).toMatchObject({ seq: 0, type: "GAME_STARTED" });
  });

  it("says a closed room is gone rather than inventing one", async () => {
    const response = await get("/api/admin/rooms/00000000-0000-0000-0000-000000000000", {
      authorization: `Bearer ${TOKEN}`,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ room: null });
  });
});

describe("live event feed", () => {
  it("streams room and game events, and advances by cursor", async () => {
    const host = server.client();
    await host.connected();
    const joined = await host.call<RoomJoined>("room:create", { name: "Host" });

    const auth = { authorization: `Bearer ${TOKEN}` };
    const first = (await (await get("/api/admin/events", auth)).json()) as {
      entries: { event: string; fields: Record<string, unknown> }[];
      cursor: number;
    };
    expect(first.entries.map((e) => e.event)).toContain("room.created");
    expect(first.entries.find((e) => e.event === "room.created")?.fields["roomId"]).toBe(
      joined.roomId,
    );

    const guest = server.client();
    await guest.connected();
    await guest.call<RoomJoined>("room:join", { code: joined.room.code, name: "Guest" });
    await guest.call("room:ready", { ready: true });
    await host.call("room:start", undefined);

    const next = (await (await get(`/api/admin/events?since=${first.cursor}`, auth)).json()) as {
      entries: { event: string }[];
    };
    const events = next.entries.map((e) => e.event);
    expect(events).toContain("room.joined");
    expect(events).toContain("game.started");
    // Engine events reach the feed even though their log level is off.
    expect(events).toContain("game.event");
    expect(events).not.toContain("room.created");
  });

  it("filters the feed to one room", async () => {
    const a = server.client();
    await a.connected();
    const roomA = await a.call<RoomJoined>("room:create", { name: "A" });
    const b = server.client();
    await b.connected();
    await b.call<RoomJoined>("room:create", { name: "B" });

    const body = (await (
      await get(`/api/admin/events?roomId=${roomA.roomId}`, { authorization: `Bearer ${TOKEN}` })
    ).json()) as { entries: { fields: Record<string, unknown> }[] };
    expect(body.entries.length).toBeGreaterThan(0);
    for (const entry of body.entries) expect(entry.fields["roomId"]).toBe(roomA.roomId);
  });
});

describe("replay debugger", () => {
  it("serves the match list and a full, replayable event log", async () => {
    const host = server.client();
    await host.connected();
    const joined = await host.call<RoomJoined>("room:create", { name: "Host" });
    const guest = server.client();
    await guest.connected();
    await guest.call<RoomJoined>("room:join", { code: joined.room.code, name: "Guest" });
    await guest.call("room:ready", { ready: true });
    await host.call("room:start", undefined);
    await host.call("game:forfeit", undefined);

    const auth = { authorization: `Bearer ${TOKEN}` };
    const list = (await (await get("/api/admin/matches", auth)).json()) as {
      matches: { matchId: string; roomCode: string; playerNames: string[]; endReason: string }[];
    };
    expect(list.matches).toHaveLength(1);
    const row = list.matches[0] as (typeof list.matches)[number];
    expect(row.roomCode).toBe(joined.room.code);
    expect(row.playerNames.sort()).toEqual(["Guest", "Host"]);
    expect(row.endReason).toBe("opponents-forfeited");

    const body = (await (await get(`/api/admin/matches/${row.matchId}`, auth)).json()) as {
      match: {
        events: { seq: number; event: { type: string; config?: { seed: number } } }[];
        result: { endReason: string } | null;
      };
    };
    const events = body.match.events;
    expect(events[0]?.event.type).toBe("GAME_STARTED");
    // Unredacted: the seed and the deal are exactly what the server acted on,
    // which is what makes the replay a replay rather than a reconstruction.
    expect(events[0]?.event.config?.seed).toEqual(expect.any(Number));
    expect(events.at(-1)?.event.type).toBe("GAME_ENDED");
    expect(body.match.result?.endReason).toBe("opponents-forfeited");
  });

  it("answers null for a match nobody has", async () => {
    const response = await get("/api/admin/matches/does-not-exist", {
      authorization: `Bearer ${TOKEN}`,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ match: null });
  });

  it("keeps the match log behind the same 404 as everything else", async () => {
    expect((await get("/api/admin/matches")).status).toBe(404);
  });
});

describe("decks (#142)", () => {
  const send = (path: string, method: string, body?: unknown): Promise<Response> =>
    fetch(`${server.url}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${TOKEN}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  it("is invisible without admin credentials, like everything else here", async () => {
    expect((await get("/api/admin/decks")).status).toBe(404);
    expect((await fetch(`${server.url}/api/admin/decks`, { method: "POST" })).status).toBe(404);
  });

  it("publishes the catalogue to everyone, definitions to operators only", async () => {
    const publicList = (await (await get("/api/decks")).json()) as {
      decks: { id: string; cardCount: number }[];
    };
    expect(publicList.decks.map((d) => d.id)).toContain("all-stars");
    expect(publicList.decks[0]?.cardCount).toBeGreaterThan(0);
    // The public list carries counts, not the filters behind them.
    expect(JSON.stringify(publicList)).not.toContain("roles");

    const admin = (await (
      await get("/api/admin/decks", { authorization: `Bearer ${TOKEN}` })
    ).json()) as {
      decks: { id: string; roles?: string[] }[];
    };
    expect(admin.decks.find((d) => d.id === "batters-xi")?.roles).toEqual(["batter", "keeper"]);
  });

  it("creates a deck a host can then play with", async () => {
    const created = await send("/api/admin/decks", "POST", {
      id: "rivals-xi",
      name: "Rivals XI",
      blurb: "The needle games.",
      rarities: ["star", "legend"],
    });
    expect(created.status).toBe(200);
    expect((await created.json()) as { ok: boolean }).toMatchObject({ ok: true });

    const cards = (await (await get("/api/decks/rivals-xi/cards")).json()) as {
      cardIds: string[];
    };
    expect(cards.cardIds.length).toBeGreaterThan(0);

    // A room can be set to it, and the game deals from it.
    const host = server.client();
    await host.connected();
    const joined = await host.call<RoomJoined>("room:create", { name: "Host" });
    await host.call("room:settings", { deckId: "rivals-xi" });
    const guest = server.client();
    await guest.connected();
    await guest.call<RoomJoined>("room:join", { code: joined.room.code, name: "Guest" });
    await guest.call("room:ready", { ready: true });
    await host.call("room:ready", { ready: true });
    await host.call("room:start", undefined);
    const room = server.app.rooms.getRoom(joined.roomId);
    const dealt = room?.game?.state.config.cards.map((c: { id: string }) => c.id) ?? [];
    expect(dealt.length).toBeGreaterThan(0);
    for (const id of dealt) expect(cards.cardIds).toContain(id);
  });

  it("refuses a deck that cannot seat a table, and says why", async () => {
    const response = await send("/api/admin/decks", "POST", {
      id: "tiny",
      name: "Tiny",
      blurb: "Too few.",
      roles: ["keeper"],
      rarities: ["legend"],
      cardIds: ["nobody"],
    });
    const body = (await response.json()) as { ok: boolean; error?: string };
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/nobody/);
    expect((await (await get("/api/decks")).json()) as { decks: unknown[] }).not.toMatchObject({
      decks: [{ id: "tiny" }],
    });
  });

  it("will not delete the deck every room falls back to", async () => {
    const response = await send("/api/admin/decks/all-stars", "DELETE");
    expect((await response.json()) as { ok: boolean }).toMatchObject({ ok: false });
  });

  it("refuses a room set to a deck nobody curated", async () => {
    const host = server.client();
    await host.connected();
    await host.call<RoomJoined>("room:create", { name: "Host" });
    expect(await host.callRaw("room:settings", { deckId: "no-such-deck" })).toMatchObject({
      ok: false,
      code: "bad-request",
    });
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
      game: { matchId: "m1", state: {}, mode: { status: () => ({ round: 4 }) } },
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
