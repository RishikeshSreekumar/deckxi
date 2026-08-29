import { afterEach, describe, expect, it } from "vitest";
import { replay } from "@deckxi/engine";
import type { RoomJoined } from "@deckxi/shared";
import { InMemoryMatchStore, type MatchStore } from "./store.js";
import { startTestServer, type TestServer } from "./testkit.js";

let server: TestServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

describe("match persistence", () => {
  it("persists the match record, players and full replayable event log", async () => {
    const store = new InMemoryMatchStore();
    // Fast timers: the game auto-plays itself to completion.
    server = await startTestServer({ store, rooms: { turnTimerMsOverride: 10 } });
    const s = server;

    const host = s.client();
    await host.connected();
    const joined = await host.call<RoomJoined>("room:create", {
      name: "Host",
      settings: { cardsPerPlayer: 3 },
    });
    const guest = s.client();
    await guest.connected();
    await guest.call("room:join", { code: joined.room.code, name: "Guest" });
    await guest.call("room:ready", { ready: true });
    await host.call("room:start");

    await expect
      .poll(() => [...store.matches.values()][0]?.result, { timeout: 15_000, interval: 50 })
      .toBeTruthy();

    const match = [...store.matches.values()][0];
    if (match === undefined) throw new Error("no match stored");
    expect(match.roomId).toBe(joined.roomId);
    expect(match.roomCode).toBe(joined.room.code);
    expect(match.gameMode).toBe("classic-trumps");
    expect(match.editionId).toBe(joined.room.settings.editionId);
    expect(match.players.map((p) => p.name).sort()).toEqual(["Guest", "Host"]);

    // The stored log is complete and gap-free…
    expect(match.events.map((e) => e.seq)).toEqual(match.events.map((_, i) => i));
    expect(match.events[0]?.event.type).toBe("GAME_STARTED");
    expect(match.events.at(-1)?.event.type).toBe("GAME_ENDED");

    // …and replaying it through the engine reproduces the persisted result.
    const finalState = replay(match.events.map((e) => e.event));
    expect(finalState.phase).toBe("finished");
    expect(finalState.winner).toBe(match.result?.winnerSessionId);
    expect(match.result?.rounds).toBe(finalState.round - 1);
    expect(match.result?.endReason).toBeTruthy();
  }, 20_000);

  it("keeps playing when the store fails, and healthz reports it", async () => {
    const brokenStore: MatchStore = {
      createMatch: () => Promise.reject(new Error("db down")),
      appendEvents: () => Promise.reject(new Error("db down")),
      finishMatch: () => Promise.reject(new Error("db down")),
      ping: () => Promise.reject(new Error("db down")),
      close: () => Promise.resolve(),
    };
    server = await startTestServer({ store: brokenStore });
    const s = server;

    const health = await fetch(`${s.url}/healthz`);
    expect(health.status).toBe(503);

    const host = s.client();
    await host.connected();
    const joined = await host.call<RoomJoined>("room:create", { name: "Host" });
    const guest = s.client();
    await guest.connected();
    await guest.call("room:join", { code: joined.room.code, name: "Guest" });
    await guest.call("room:ready", { ready: true });
    // Starting the game triggers failing writes — the game must still start.
    await host.call("room:start");
    expect(s.app.rooms.getRoom(joined.roomId)?.phase).toBe("playing");
  });
});
