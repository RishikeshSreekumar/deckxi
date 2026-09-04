import { afterEach, describe, expect, it } from "vitest";
import type { RedactedGameEvent, RoomJoined, RoomView } from "@deckxi/shared";
import { startTestServer, trumpsState, type TestClient, type TestServer } from "./testkit.js";

let server: TestServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

interface Seat {
  client: TestClient;
  joined: RoomJoined;
  events: RedactedGameEvent[];
}

async function lobby(playerCount: number): Promise<{ s: TestServer; seats: Seat[]; code: string }> {
  // A test that plays a whole game sends commands as fast as the event loop
  // allows, which is nothing like a person and trips the per-socket abuse
  // bucket on a fast machine (it did, in CI). The limiter has its own tests;
  // this one is about the rules. Same seam power.test.ts already uses.
  server = await startTestServer({ limits: { global: { capacity: 1000, refillPerSec: 1000 } } });
  const s = server;
  const seats: Seat[] = [];
  const host = s.client();
  await host.connected();
  const hostJoined = await host.call<RoomJoined>("room:create", {
    name: "P0",
    settings: { cardsPerPlayer: 3, maxRounds: 500 },
  });
  seats.push({ client: host, joined: hostJoined, events: host.collect("game:events") });
  for (let i = 1; i < playerCount; i++) {
    const client = s.client();
    await client.connected();
    const joined = await client.call<RoomJoined>("room:join", {
      code: hostJoined.room.code,
      name: `P${i}`,
    });
    seats.push({ client, joined, events: client.collect("game:events") });
    await client.call("room:ready", { ready: true });
  }
  return { s, seats, code: hostJoined.room.code };
}

/** Flatten the batched game:events arrays a client has received so far. */
function received(seat: Seat): RedactedGameEvent[] {
  return seat.events.flat() as unknown as RedactedGameEvent[];
}

function gameStarted(seat: Seat): Extract<RedactedGameEvent, { type: "GAME_STARTED" }> {
  const event = received(seat).find((e) => e.type === "GAME_STARTED");
  if (event === undefined || event.type !== "GAME_STARTED") throw new Error("no GAME_STARTED");
  return event;
}

describe("authoritative game loop", () => {
  it("refuses to start for non-hosts, tiny lobbies and unready players", async () => {
    const { s, seats } = await lobby(2);
    const [host, guest] = seats as [Seat, Seat];

    expect(await guest.client.callRaw("room:start")).toMatchObject({
      ok: false,
      code: "not-host",
    });

    await guest.client.call("room:ready", { ready: false });
    expect(await host.client.callRaw("room:start")).toMatchObject({
      ok: false,
      code: "players-not-ready",
    });

    const solo = s.client();
    await solo.connected();
    await solo.call("room:create", { name: "Alone" });
    expect(await solo.callRaw("room:start")).toMatchObject({
      ok: false,
      code: "not-enough-players",
    });
  });

  it("deals redacted views: own hand only, counts for everyone, no seed", async () => {
    const { seats } = await lobby(3);
    const [host] = seats as [Seat, Seat, Seat];
    await host.client.call("room:start");

    await expect.poll(() => received(seats[1] as Seat).length).toBeGreaterThan(0);
    for (const seat of seats) {
      const started = gameStarted(seat);
      expect(started.yourHand).toHaveLength(3);
      expect(started.config.players).toHaveLength(3);
      expect(Object.values(started.handCounts)).toEqual([3, 3, 3]);
      expect(started.config.cards).toHaveLength(9);
      // The wire form never carries the seed or other players' hands.
      expect(JSON.stringify(started)).not.toContain("seed");
      expect((started as unknown as { hands?: unknown }).hands).toBeUndefined();
      // Your hand is drawn from the game's deck.
      const deck = new Set(started.config.cards.map((c) => c.id));
      for (const cardId of started.yourHand ?? []) expect(deck.has(cardId)).toBe(true);
    }
    // Different players see different hands.
    const hands = seats.map((seat) => JSON.stringify(gameStarted(seat).yourHand));
    expect(new Set(hands).size).toBe(3);
  });

  it("rejects commands from non-leaders and rounds resolve identically for all", async () => {
    const { s, seats } = await lobby(2);
    const [host] = seats as [Seat, Seat];
    await host.client.call("room:start");
    await expect.poll(() => received(host).length).toBeGreaterThan(0);

    const room = s.app.rooms.getRoom(host.joined.roomId);
    const leaderId = trumpsState(room).leader;
    const leader = seats.find((x) => x.joined.selfId === leaderId) as Seat;
    const follower = seats.find((x) => x.joined.selfId !== leaderId) as Seat;
    const stat = gameStarted(host).config.stats[0]?.key as string;

    expect(await follower.client.callRaw("game:selectStat", { stat })).toMatchObject({
      ok: false,
      code: "command-rejected",
    });
    expect(await leader.client.callRaw("game:selectStat", { stat: "notAStat" })).toMatchObject({
      ok: false,
      code: "command-rejected",
    });

    await leader.client.call("game:selectStat", { stat });
    await expect.poll(() => received(follower).some((e) => e.type === "ROUND_RESOLVED")).toBe(true);
    const forLeader = received(leader).filter((e) => e.type !== "GAME_STARTED");
    const forFollower = received(follower).filter((e) => e.type !== "GAME_STARTED");
    expect(forLeader).toEqual(forFollower);
    const resolved = forLeader.find((e) => e.type === "ROUND_RESOLVED");
    expect(resolved).toMatchObject({ round: 1, stat, revealed: expect.any(Array) });
  });

  it("plays a full game to completion, then rematches back to the lobby", async () => {
    const { s, seats } = await lobby(3);
    const [host] = seats as [Seat, Seat, Seat];
    const states = host.client.collect<RoomView>("room:state");
    await host.client.call("room:start");
    await expect.poll(() => received(host).length).toBeGreaterThan(0);
    const stat = gameStarted(host).config.stats[0]?.key as string;

    // Server truth drives the test: whoever the engine says leads, plays.
    for (let i = 0; i < 2000; i++) {
      const room = s.app.rooms.getRoom(host.joined.roomId);
      if (room === undefined) throw new Error("room vanished");
      if (room.phase === "results") break;
      const leaderId = trumpsState(room).leader as string;
      const leader = seats.find((x) => x.joined.selfId === leaderId) as Seat;
      await leader.client.call("game:selectStat", { stat });
    }

    const room = s.app.rooms.getRoom(host.joined.roomId);
    expect(room?.phase).toBe("results");
    await expect.poll(() => received(host).some((e) => e.type === "GAME_ENDED")).toBe(true);
    const ended = received(host).find((e) => e.type === "GAME_ENDED");
    expect(ended).toMatchObject({ winner: expect.any(String) });
    expect(states.at(-1)?.phase).toBe("results");

    // Sequence numbers are strictly increasing with no gaps.
    const seqs = received(host).map((e) => e.seq);
    expect(seqs).toEqual(seqs.map((_, i) => i));

    // Late commands bounce; rematch resets the lobby.
    const late = await (seats[1] as Seat).client.callRaw("game:selectStat", { stat });
    expect(late).toMatchObject({ ok: false, code: "game-not-running" });
    await host.client.call("room:rematch");
    expect(s.app.rooms.getRoom(host.joined.roomId)?.phase).toBe("lobby");
    expect(s.app.rooms.getRoom(host.joined.roomId)?.game).toBeNull();
  });

  it("treats forfeit and mid-game leave as engine forfeits", async () => {
    const { s, seats } = await lobby(3);
    const [host, p1, p2] = seats as [Seat, Seat, Seat];
    await host.client.call("room:start");
    await expect.poll(() => received(host).length).toBeGreaterThan(0);

    await p1.client.call("game:forfeit");
    await expect.poll(() => received(host).some((e) => e.type === "PLAYER_FORFEITED")).toBe(true);

    // Second departure leaves one player standing — game over.
    await p2.client.call("room:leave");
    await expect.poll(() => received(host).some((e) => e.type === "GAME_ENDED")).toBe(true);
    const ended = received(host).find((e) => e.type === "GAME_ENDED");
    expect(ended).toMatchObject({ winner: host.joined.selfId, reason: "opponents-forfeited" });
    expect(s.app.rooms.getRoom(host.joined.roomId)?.phase).toBe("results");
  });

  it("gives spectators the full public log but no hand", async () => {
    const { s, seats, code } = await lobby(2);
    const [host] = seats as [Seat, Seat];
    const spectator = s.client();
    await spectator.connected();
    const specJoined = await spectator.call<RoomJoined>("room:join", {
      code,
      name: "Watcher",
      spectator: true,
    });
    expect(specJoined.spectator).toBe(true);
    const specEvents = spectator.collect<RedactedGameEvent[]>("game:events");

    await host.client.call("room:start");
    await expect.poll(() => specEvents.flat().length).toBeGreaterThan(0);
    const started = specEvents.flat().find((e) => e.type === "GAME_STARTED");
    expect(started).toBeDefined();
    expect(started?.type === "GAME_STARTED" && started.yourHand).toBeNull();

    // Spectators cannot play.
    expect(await spectator.callRaw("game:forfeit")).toMatchObject({
      ok: false,
      code: "spectators-cannot",
    });
  });
});
