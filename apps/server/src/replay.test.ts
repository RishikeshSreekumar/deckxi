/**
 * Shareable replays (#83). The rules worth pinning down are about who may
 * share and what a shared link shows: a player from that table, and only what
 * the table saw.
 */
import { afterEach, describe, expect, it } from "vitest";
import type { RoomJoined } from "@deckxi/shared";
import { startTestServer, type TestServer } from "./testkit.js";

let server: TestServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

async function signInGuest(url: string): Promise<string> {
  const response = await fetch(`${url}/api/auth/sign-in/anonymous`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  return (response.headers.getSetCookie() ?? []).map((c) => c.split(";")[0]).join("; ");
}

/** A two-player game decided by a forfeit — enough log to replay. */
async function playedMatch(s: TestServer, cookie: string): Promise<string> {
  const host = s.client({ cookie });
  await host.connected();
  const joined = await host.call<RoomJoined>("room:create", {
    name: "Host",
    settings: { cardsPerPlayer: 3 },
  });
  const guest = s.client();
  await guest.connected();
  await guest.call<RoomJoined>("room:join", { code: joined.room.code, name: "Guest" });
  await guest.call("room:ready", { ready: true });
  await host.call("room:start");
  const room = s.app.rooms.getRoom(joined.roomId);
  const state = room?.game?.state as { leader: string; config: { stats: { key: string }[] } };
  const stat = state.config.stats[0]?.key ?? "runs";
  const leader = state.leader === joined.selfId ? host : guest;
  await leader.callRaw("game:selectStat", { stat });
  await guest.call("game:forfeit");
  return room?.game?.matchId ?? "";
}

describe("sharing a replay", () => {
  it("gives a player a link, and the same link the second time", async () => {
    server = await startTestServer();
    const s = server;
    const cookie = await signInGuest(s.url);
    const matchId = await playedMatch(s, cookie);

    const first = await fetch(`${s.url}/api/me/matches/${matchId}/share`, {
      method: "POST",
      headers: { cookie },
    });
    expect(first.status).toBe(200);
    const { token } = (await first.json()) as { token: string };
    expect(token).toHaveLength(32);

    const again = await fetch(`${s.url}/api/me/matches/${matchId}/share`, {
      method: "POST",
      headers: { cookie },
    });
    // Sharing twice must hand back the link already in someone's chat thread
    // rather than orphaning it.
    expect(((await again.json()) as { token: string }).token).toBe(token);
  });

  it("refuses to share a match you did not play in", async () => {
    server = await startTestServer();
    const s = server;
    const playerCookie = await signInGuest(s.url);
    const strangerCookie = await signInGuest(s.url);
    const matchId = await playedMatch(s, playerCookie);

    const response = await fetch(`${s.url}/api/me/matches/${matchId}/share`, {
      method: "POST",
      headers: { cookie: strangerCookie },
    });
    expect(response.status).toBe(403);
  });

  it("serves the replay to anyone holding the link, redacted as a spectator", async () => {
    server = await startTestServer();
    const s = server;
    const cookie = await signInGuest(s.url);
    const matchId = await playedMatch(s, cookie);
    const { token } = (await (
      await fetch(`${s.url}/api/me/matches/${matchId}/share`, {
        method: "POST",
        headers: { cookie },
      })
    ).json()) as { token: string };

    // No cookie at all: the link is the permission.
    const replay = await fetch(`${s.url}/api/replay/${token}`);
    expect(replay.status).toBe(200);
    const body = (await replay.json()) as {
      match: { roomCode: string; players: { name: string }[] };
      events: { type: string; yourHand?: unknown }[];
    };
    // The signed-in seat is named by its account (a generated cricket
    // handle for a fresh guest), the cookie-less one by what it typed.
    expect(body.match.players).toHaveLength(2);
    expect(body.match.players[1]?.name).toBe("Guest");

    const started = body.events.find((e) => e.type === "GAME_STARTED");
    // A spectator is dealt nothing, and a shared link must not leak a hand
    // the table never turned over.
    expect(started?.yourHand ?? null).toBeNull();
  });

  it("stops working once the share is revoked", async () => {
    server = await startTestServer();
    const s = server;
    const cookie = await signInGuest(s.url);
    const matchId = await playedMatch(s, cookie);
    const { token } = (await (
      await fetch(`${s.url}/api/me/matches/${matchId}/share`, {
        method: "POST",
        headers: { cookie },
      })
    ).json()) as { token: string };

    expect((await fetch(`${s.url}/api/replay/${token}`)).status).toBe(200);
    const revoked = await fetch(`${s.url}/api/me/shares/${token}`, {
      method: "DELETE",
      headers: { cookie },
    });
    expect(revoked.status).toBe(204);
    expect((await fetch(`${s.url}/api/replay/${token}`)).status).toBe(404);
  });

  it("answers an unknown token with a 404, not a hint", async () => {
    server = await startTestServer();
    expect((await fetch(`${server.url}/api/replay/nope`)).status).toBe(404);
  });
});
