/**
 * Power trumps over the wire: the responding window, what each viewer is
 * allowed to see of a committed play, the one-clock-per-phase timer, and a
 * full game driven by the baseline bot through the socket API.
 */
import { afterEach, describe, expect, it } from "vitest";
import { baselineBot } from "@deckxi/engine";
import type { RedactedGameEvent, RoomJoined, TurnTimerView } from "@deckxi/shared";
import { startTestServer, trumpsState, type TestClient, type TestServer } from "./testkit.js";

let server: TestServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

interface Seat {
  client: TestClient;
  joined: RoomJoined;
  events: RedactedGameEvent[][];
  timers: (TurnTimerView | null)[];
}

async function powerLobby(
  playerCount: number,
  turnTimerMsOverride?: number,
): Promise<{ s: TestServer; seats: Seat[] }> {
  // Three commands a round instead of one: the abuse ceiling is not the
  // thing under test here.
  server = await startTestServer({
    limits: { global: { capacity: 1000, refillPerSec: 1000 } },
    ...(turnTimerMsOverride === undefined ? {} : { rooms: { turnTimerMsOverride } }),
  });
  const s = server;
  const seats: Seat[] = [];
  const host = s.client();
  await host.connected();
  const hostJoined = await host.call<RoomJoined>("room:create", {
    name: "P0",
    settings: { gameMode: "power-trumps", cardsPerPlayer: 4, maxRounds: 300 },
  });
  seats.push({
    client: host,
    joined: hostJoined,
    events: host.collect("game:events"),
    timers: host.collect("game:timer"),
  });
  for (let i = 1; i < playerCount; i++) {
    const client = s.client();
    await client.connected();
    const joined = await client.call<RoomJoined>("room:join", {
      code: hostJoined.room.code,
      name: `P${i}`,
    });
    seats.push({
      client,
      joined,
      events: client.collect("game:events"),
      timers: client.collect("game:timer"),
    });
    await client.call("room:ready", { ready: true });
  }
  return { s, seats };
}

const received = (seat: Seat): RedactedGameEvent[] => seat.events.flat();
const bySelf = (seats: Seat[], id: string): Seat =>
  seats.find((x) => x.joined.selfId === id) as Seat;

describe("power trumps over the wire", () => {
  it("opens a responding window and hides committed cards until the reveal", async () => {
    const { s, seats } = await powerLobby(3);
    const [host] = seats as [Seat, Seat, Seat];
    await host.client.call("room:start");
    await expect.poll(() => received(host).length).toBeGreaterThan(0);
    const started = received(host).find((e) => e.type === "GAME_STARTED");
    expect(started).toMatchObject({ config: { mode: "power-trumps" } });

    const room = s.app.rooms.getRoom(host.joined.roomId);
    const leaderId = trumpsState(room).leader as string;
    const leader = bySelf(seats, leaderId);
    const others = seats.filter((x) => x.joined.selfId !== leaderId) as [Seat, Seat];
    const stats = (started as { config: { stats: { key: string }[] } }).config.stats;
    const [stat, other] = [stats[0]?.key as string, stats[1]?.key as string];

    // Nobody may answer before the call.
    expect(await others[0].client.callRaw("game:playCard", { cardIndex: 0 })).toMatchObject({
      ok: false,
      code: "command-rejected",
    });

    await leader.client.call("game:selectStat", {
      stat,
      cardIndex: 2,
      power: { kind: "powerplay" },
    });
    await expect.poll(() => received(others[0]).some((e) => e.type === "STAT_SELECTED")).toBe(true);
    const leaderSaw = received(leader).find((e) => e.type === "STAT_SELECTED");
    const otherSaw = received(others[0]).find((e) => e.type === "STAT_SELECTED");
    expect(leaderSaw).toMatchObject({ cardId: expect.any(String), power: { kind: "powerplay" } });
    expect(otherSaw).toMatchObject({ cardId: null, power: { kind: "powerplay" } });
    expect(trumpsState(room).phase).toBe("responding");

    // The first answer, with a DRS whose stat only its owner sees.
    await others[0].client.call("game:playCard", {
      cardIndex: 1,
      power: { kind: "drs", stat: other },
    });
    await expect.poll(() => received(others[1]).some((e) => e.type === "CARD_PLAYED")).toBe(true);
    expect(received(others[0]).find((e) => e.type === "CARD_PLAYED")).toMatchObject({
      cardId: expect.any(String),
      power: { kind: "drs", stat: other },
    });
    expect(received(others[1]).find((e) => e.type === "CARD_PLAYED")).toMatchObject({
      cardId: null,
      power: { kind: "drs" },
    });
    expect(received(others[1]).find((e) => e.type === "CARD_PLAYED")).not.toHaveProperty(
      "power.stat",
    );
    expect(received(others[1]).some((e) => e.type === "ROUND_RESOLVED")).toBe(false);

    // Answering twice is refused; the last answer resolves the round for all.
    expect(await others[0].client.callRaw("game:playCard", { cardIndex: 0 })).toMatchObject({
      ok: false,
      code: "command-rejected",
    });
    await others[1].client.call("game:playCard", { cardIndex: 0 });
    for (const seat of seats) {
      await expect.poll(() => received(seat).some((e) => e.type === "ROUND_RESOLVED")).toBe(true);
    }
    const resolved = received(host).find((e) => e.type === "ROUND_RESOLVED");
    expect(resolved).toMatchObject({
      round: 1,
      stat: other,
      power: { calledStat: stat, drsBy: others[0].joined.selfId, nextLeader: expect.any(String) },
    });
    const rounds = seats.map((seat) =>
      JSON.stringify(received(seat).find((e) => e.type === "ROUND_RESOLVED")),
    );
    expect(new Set(rounds).size).toBe(1);
  });

  it("runs one clock per phase and auto-plays everyone still to answer", async () => {
    const { s, seats } = await powerLobby(3, 120);
    const [host] = seats as [Seat, Seat, Seat];
    await host.client.call("room:start");
    await expect.poll(() => host.timers.length).toBeGreaterThan(0);
    const room = s.app.rooms.getRoom(host.joined.roomId);
    const leaderId = trumpsState(room).leader as string;
    expect(host.timers[0]).toMatchObject({ playerId: leaderId, waitingOn: [leaderId] });

    // The leader's clock runs out: the call is automatic and the responding
    // window opens with a clock that names both responders.
    await expect
      .poll(() => received(host).some((e) => e.type === "STAT_SELECTED"), { timeout: 3000 })
      .toBe(true);
    expect(received(host).find((e) => e.type === "STAT_SELECTED")).toMatchObject({ auto: true });
    await expect
      .poll(() => host.timers.find((t) => t !== null && t.waitingOn.length === 2))
      .toBeDefined();

    // Then that clock runs out too: both responders are auto-played at once.
    await expect
      .poll(() => received(host).some((e) => e.type === "ROUND_RESOLVED"), { timeout: 3000 })
      .toBe(true);
    const plays = received(host).filter((e) => e.type === "CARD_PLAYED");
    expect(plays).toHaveLength(2);
    expect(plays.every((e) => e.type === "CARD_PLAYED" && e.auto && e.power === null)).toBe(true);
  });

  it("plays a full game to completion with the baseline bot on every seat", async () => {
    const { s, seats } = await powerLobby(3);
    const [host] = seats as [Seat, Seat, Seat];
    await host.client.call("room:start");
    await expect.poll(() => received(host).length).toBeGreaterThan(0);

    for (let i = 0; i < 5000; i++) {
      const room = s.app.rooms.getRoom(host.joined.roomId);
      if (room === undefined) throw new Error("room vanished");
      if (room.phase === "results") break;
      const state = trumpsState(room);
      if (state === undefined) throw new Error("no game");
      const mover =
        state.phase === "responding"
          ? state.players.find((p) => p.active && !(p.id in (state.pending?.plays ?? {})))?.id
          : state.leader;
      const command = mover === undefined ? null : baselineBot(state, mover);
      if (command === null) throw new Error(`no move for ${mover ?? "nobody"}`);
      const seat = bySelf(seats, command.playerId);
      if (command.type === "SELECT_STAT") {
        await seat.client.call("game:selectStat", {
          stat: command.stat,
          cardIndex: command.cardIndex ?? 0,
        });
      } else if (command.type === "PLAY_CARD") {
        await seat.client.call("game:playCard", { cardIndex: command.cardIndex });
      } else {
        throw new Error(`unexpected bot command ${command.type}`);
      }
    }

    expect(s.app.rooms.getRoom(host.joined.roomId)?.phase).toBe("results");
    await expect.poll(() => received(host).some((e) => e.type === "GAME_ENDED")).toBe(true);
    const seqs = received(host).map((e) => e.seq);
    expect(seqs).toEqual(seqs.map((_, i) => i));
  }, 30_000);
});
