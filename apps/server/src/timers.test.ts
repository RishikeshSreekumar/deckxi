import { afterEach, describe, expect, it } from "vitest";
import type { RedactedGameEvent, RoomJoined, TurnTimerView } from "@deckxi/shared";
import { startTestServer, trumpsState, type TestClient, type TestServer } from "./testkit.js";

let server: TestServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

async function startedGame(turnTimerMsOverride: number): Promise<{
  s: TestServer;
  host: TestClient;
  joined: RoomJoined;
  events: RedactedGameEvent[][];
  timers: (TurnTimerView | null)[];
}> {
  server = await startTestServer({ rooms: { turnTimerMsOverride } });
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
  const events = host.collect<RedactedGameEvent[]>("game:events");
  const timers = host.collect<TurnTimerView | null>("game:timer");
  await host.call("room:start");
  return { s, host, joined, events, timers };
}

describe("turn timers", () => {
  it("announces the leader's deadline when the game starts", async () => {
    const { s, joined, timers } = await startedGame(60_000);
    await expect.poll(() => timers.length).toBeGreaterThan(0);
    const timer = timers[0] as TurnTimerView;
    const leader = trumpsState(s.app.rooms.getRoom(joined.roomId)).leader;
    expect(timer.playerId).toBe(leader);
    expect(timer.deadline).toBeGreaterThan(Date.now());
  });

  it("auto-plays an expired turn and re-arms for the next round", async () => {
    const { events, timers } = await startedGame(40);
    await expect
      .poll(() => events.flat().some((e) => e.type === "STAT_SELECTED"), { timeout: 3000 })
      .toBe(true);
    const selected = events.flat().find((e) => e.type === "STAT_SELECTED");
    expect(selected).toMatchObject({ auto: true });
    // A new deadline follows the resolved round.
    await expect.poll(() => timers.length).toBeGreaterThan(1);
  });

  it("drives an abandoned game to completion and clears the timer", async () => {
    const { s, joined, events, timers } = await startedGame(15);
    await expect
      .poll(() => events.flat().some((e) => e.type === "GAME_ENDED"), { timeout: 15_000 })
      .toBe(true);
    expect(s.app.rooms.getRoom(joined.roomId)?.phase).toBe("results");
    // The last timer broadcast clears the countdown.
    await expect.poll(() => timers.at(-1)).toBeNull();
    // Every auto-play was leader-picked-best, recorded as auto.
    const selects = events.flat().filter((e) => e.type === "STAT_SELECTED");
    expect(selects.length).toBeGreaterThan(0);
    expect(selects.every((e) => e.type === "STAT_SELECTED" && e.auto)).toBe(true);
  }, 20_000);

  it("does not auto-play when the leader acts in time", async () => {
    const { s, joined, events } = await startedGame(60_000);
    await expect.poll(() => events.flat().length).toBeGreaterThan(0);
    const room = s.app.rooms.getRoom(joined.roomId);
    const game = room?.game;
    expect(game?.turnDeadline).not.toBeNull();
    // Deadline far away: no STAT_SELECTED arrives on its own.
    await new Promise((r) => setTimeout(r, 150));
    expect(events.flat().some((e) => e.type === "STAT_SELECTED")).toBe(false);
  });
});
