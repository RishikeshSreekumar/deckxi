import { afterEach, describe, expect, it } from "vitest";
import type { RedactedGameEvent, RoomJoined, RoomResumed, RoomView } from "@deckxi/shared";
import { startTestServer, type TestClient, type TestServer } from "./testkit.js";

let server: TestServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

async function playingRoom(options: { disconnectGraceMs?: number } = {}): Promise<{
  s: TestServer;
  host: TestClient;
  hostJoined: RoomJoined;
  guest: TestClient;
  guestJoined: RoomJoined;
}> {
  server = await startTestServer({
    rooms: { turnTimerMsOverride: 60_000, ...options },
  });
  const s = server;
  const host = s.client();
  await host.connected();
  const hostJoined = await host.call<RoomJoined>("room:create", {
    name: "Host",
    settings: { cardsPerPlayer: 3 },
  });
  const guest = s.client();
  await guest.connected();
  const guestJoined = await guest.call<RoomJoined>("room:join", {
    code: hostJoined.room.code,
    name: "Guest",
  });
  await guest.call("room:ready", { ready: true });
  await host.call("room:start");
  return { s, host, hostJoined, guest, guestJoined };
}

describe("disconnect grace and reconnection", () => {
  it("keeps a mid-game player through a disconnect and restores them on resume", async () => {
    const { s, host, guest, guestJoined } = await playingRoom({ disconnectGraceMs: 60_000 });
    const states = host.collect<RoomView>("room:state");

    guest.disconnect();
    await expect
      .poll(() => states.at(-1)?.players.find((p) => p.name === "Guest")?.connected)
      .toBe(false);
    // Still a player, still in the game.
    expect(s.app.rooms.getRoom(guestJoined.roomId)?.players).toHaveLength(2);

    const fresh = s.client();
    await fresh.connected();
    const resumed = await fresh.call<RoomResumed>("room:resume", {
      roomId: guestJoined.roomId,
      resumeToken: guestJoined.resumeToken,
    });
    expect(resumed.selfId).toBe(guestJoined.selfId);
    expect(resumed.room.players.find((p) => p.name === "Guest")?.connected).toBe(true);

    // The replayed log rebuilds the guest's view: own hand, no other hands.
    const started = resumed.events.find((e) => e.type === "GAME_STARTED");
    expect(started?.type === "GAME_STARTED" && started.yourHand).toHaveLength(3);
    expect(resumed.events.length).toBe(s.app.rooms.getRoom(guestJoined.roomId)?.game?.log.length);
    expect(resumed.timer).toMatchObject({ deadline: expect.any(Number) });

    // The resumed socket is live: commands work again (leader or not).
    const reply = await fresh.callRaw("game:selectStat", { stat: "runs" });
    expect(reply.ok === false ? reply.code : "accepted").not.toBe("not-in-room");
  });

  it("forfeits a player whose grace window expires", async () => {
    const { s, host, guest, guestJoined } = await playingRoom({ disconnectGraceMs: 40 });
    const events = host.collect<RedactedGameEvent[]>("game:events");

    guest.disconnect();
    await expect
      .poll(() => events.flat().some((e) => e.type === "PLAYER_FORFEITED"), { timeout: 3000 })
      .toBe(true);
    await expect.poll(() => events.flat().some((e) => e.type === "GAME_ENDED")).toBe(true);
    expect(s.app.rooms.getRoom(guestJoined.roomId)?.phase).toBe("results");
    expect(s.app.rooms.getRoom(guestJoined.roomId)?.players.map((p) => p.name)).toEqual(["Host"]);
  });

  it("cancels the forfeit when the player resumes inside the grace window", async () => {
    const { s, guest, guestJoined } = await playingRoom({ disconnectGraceMs: 150 });
    guest.disconnect();
    const fresh = s.client();
    await fresh.connected();
    await fresh.call<RoomResumed>("room:resume", {
      roomId: guestJoined.roomId,
      resumeToken: guestJoined.resumeToken,
    });
    // Wait past the original grace deadline — no forfeit should fire.
    await new Promise((r) => setTimeout(r, 250));
    const room = s.app.rooms.getRoom(guestJoined.roomId);
    expect(room?.phase).toBe("playing");
    expect(room?.players).toHaveLength(2);
  });

  it("rejects resumes with a bad token or a dead room", async () => {
    const { s, guestJoined } = await playingRoom();
    const fresh = s.client();
    await fresh.connected();
    expect(
      await fresh.callRaw("room:resume", {
        roomId: guestJoined.roomId,
        resumeToken: "wrong-token",
      }),
    ).toMatchObject({ ok: false, code: "resume-failed" });
    expect(
      await fresh.callRaw("room:resume", {
        roomId: "no-such-room",
        resumeToken: guestJoined.resumeToken,
      }),
    ).toMatchObject({ ok: false, code: "resume-failed" });
  });

  it("resumes spectators with a redacted (handless) log", async () => {
    const { s, hostJoined } = await playingRoom();
    const spec = s.client();
    await spec.connected();
    const specJoined = await spec.call<RoomJoined>("room:join", {
      code: hostJoined.room.code,
      name: "Watcher",
    });
    expect(specJoined.spectator).toBe(true);
    spec.disconnect();

    const fresh = s.client();
    await fresh.connected();
    const resumed = await fresh.call<RoomResumed>("room:resume", {
      roomId: specJoined.roomId,
      resumeToken: specJoined.resumeToken,
    });
    const started = resumed.events.find((e) => e.type === "GAME_STARTED");
    expect(started?.type === "GAME_STARTED" && started.yourHand).toBeNull();
  });
});
