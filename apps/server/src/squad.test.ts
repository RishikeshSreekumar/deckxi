/**
 * Squad Draft over the wire (Phase 9): the room runs a second game through
 * the same plumbing as trumps — mode-agnostic start, the generic
 * `game:command` message, per-phase turn timers, redaction of submitted XIs,
 * forfeits, and per-mode stats in the store.
 */
import { afterEach, describe, expect, it } from "vitest";
import { getMode, type SquadDraftState } from "@deckxi/engine";
import type { RoomJoined, SquadDraftWireEvent, WireGameEvent } from "@deckxi/shared";
import { startTestServer, type TestClient, type TestServer } from "./testkit.js";

let server: TestServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

interface Seat {
  client: TestClient;
  joined: RoomJoined;
  events: WireGameEvent[][];
}

function received(seat: Seat): SquadDraftWireEvent[] {
  return seat.events.flat() as SquadDraftWireEvent[];
}

async function lobby(
  playerCount: number,
  turnTimerMs?: number,
): Promise<{ s: TestServer; seats: Seat[] }> {
  server = await startTestServer(
    turnTimerMs === undefined ? {} : { rooms: { turnTimerMsOverride: turnTimerMs } },
  );
  const s = server;
  const seats: Seat[] = [];
  const host = s.client();
  await host.connected();
  const hostJoined = await host.call<RoomJoined>("room:create", {
    name: "P0",
    settings: { gameMode: "squad-draft" },
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
  return { s, seats };
}

function stateOf(s: TestServer, seat: Seat): SquadDraftState {
  const state = s.app.rooms.getRoom(seat.joined.roomId)?.game?.state;
  if (state === undefined) throw new Error("no game");
  return state as SquadDraftState;
}

describe("squad draft over the wire", () => {
  it("starts a draft with a face-up pool, then refuses picks out of turn", async () => {
    const { s, seats } = await lobby(2);
    const [host, guest] = seats as [Seat, Seat];
    await host.client.call("room:start");
    await expect.poll(() => received(guest).length).toBeGreaterThan(0);

    const started = received(guest).find((e) => e.type === "GAME_STARTED");
    if (started?.type !== "GAME_STARTED") throw new Error("no GAME_STARTED");
    expect(started.config.mode).toBe("squad-draft");
    expect(started.pool).toHaveLength(2 * 13 + 5);
    expect(started.pickOrder).toHaveLength(26);
    expect((started.config as { seed?: unknown }).seed).toBeUndefined();
    // Cards carry role and nation for the constraints UI.
    expect(started.config.cards.every((c) => typeof c.role === "string")).toBe(true);
    expect(started.config.cards.every((c) => typeof c.nation === "string")).toBe(true);

    const state = stateOf(s, host);
    const onClock = state.pickOrder[0] as string;
    const other = onClock === host.joined.selfId ? guest : host;
    const card = started.pool[0] as string;
    expect(
      await other.client.callRaw("game:command", { type: "DRAFT_PICK", cardId: card }),
    ).toMatchObject({ ok: false, code: "command-rejected", message: "not-on-the-clock" });
    // A trumps message in a draft is refused as a command the mode does not speak.
    expect(await host.client.callRaw("game:selectStat", { stat: "runs" })).toMatchObject({
      ok: false,
      code: "command-rejected",
      message: "unknown-command",
    });
  });

  it("refuses to seat more players than the mode allows", async () => {
    const { seats } = await lobby(5);
    const host = seats[0] as Seat;
    expect(await host.client.callRaw("room:start")).toMatchObject({
      ok: false,
      code: "too-many-players",
    });
  });

  it("plays a whole game: bots draft, XIs stay secret until the matches, one winner", async () => {
    const { s, seats } = await lobby(3);
    const host = seats[0] as Seat;
    await host.client.call("room:start");
    await expect.poll(() => received(host).length).toBeGreaterThan(0);
    const mode = getMode("squad-draft");
    const bySelf = new Map(seats.map((seat) => [seat.joined.selfId, seat]));

    for (let i = 0; i < 200; i++) {
      const room = s.app.rooms.getRoom(host.joined.roomId);
      if (room === undefined) throw new Error("room vanished");
      if (room.phase === "results") break;
      const state = stateOf(s, host);
      const mover = mode.status(state).waitingOn[0];
      if (mover === undefined) throw new Error("nobody to move");
      const move = mode.bot(state, mover) as { type: string; cardId?: string; roster?: unknown };
      const seat = bySelf.get(mover) as Seat;
      if (move.type === "DRAFT_PICK") {
        await seat.client.call("game:command", { type: "DRAFT_PICK", cardId: move.cardId });
      } else {
        await seat.client.call("game:command", { type: "SUBMIT_XI", roster: move.roster });
      }
    }
    expect(s.app.rooms.getRoom(host.joined.roomId)?.phase).toBe("results");

    await expect
      .poll(() => received(host).some((e) => e.type === "GAME_ENDED"), { timeout: 3000 })
      .toBe(true);
    for (const seat of seats) {
      const log = received(seat);
      const submissions = log.filter((e) => e.type === "XI_SUBMITTED");
      expect(submissions).toHaveLength(3);
      for (const e of submissions) {
        if (e.type !== "XI_SUBMITTED") continue;
        // Your own XI comes back to you; everyone else's is null until the reveal.
        expect(e.roster === null).toBe(e.playerId !== seat.joined.selfId);
      }
      const played = log.find((e) => e.type === "MATCHES_PLAYED");
      if (played?.type !== "MATCHES_PLAYED") throw new Error("no MATCHES_PLAYED");
      expect(Object.keys(played.rosters).sort()).toEqual([...bySelf.keys()].sort());
      expect(played.league.matches).toHaveLength(3);
      const ended = log.at(-1);
      expect(ended?.type).toBe("GAME_ENDED");
      if (ended?.type === "GAME_ENDED") {
        expect(ended.reason).toBe("league");
        expect(ended.winner).toBe(played.league.table[0]?.playerId);
      }
    }
  });

  it("auto-picks for a drafter who runs out of time, one clock per pick", async () => {
    const { s, seats } = await lobby(2, 40);
    const host = seats[0] as Seat;
    await host.client.call("room:start");
    await expect
      .poll(() => received(host).filter((e) => e.type === "CARD_DRAFTED").length, {
        timeout: 4000,
      })
      .toBeGreaterThanOrEqual(3);
    const picks = received(host).filter((e) => e.type === "CARD_DRAFTED");
    expect(picks.every((e) => e.type === "CARD_DRAFTED" && e.auto)).toBe(true);
    // Each expiry plays exactly the one seat on the clock, in snake order.
    const state = stateOf(s, host);
    for (const [i, e] of picks.entries()) {
      if (e.type === "CARD_DRAFTED") expect(e.playerId).toBe(state.pickOrder[i]);
    }
  });

  it("a player leaving mid-draft forfeits; the last one standing wins", async () => {
    const { s, seats } = await lobby(2);
    const [host, guest] = seats as [Seat, Seat];
    await host.client.call("room:start");
    await expect.poll(() => received(guest).length).toBeGreaterThan(0);
    await guest.client.call("room:leave");
    await expect
      .poll(() => s.app.rooms.getRoom(host.joined.roomId)?.phase, { timeout: 3000 })
      .toBe("results");
    const ended = received(host).at(-1);
    expect(ended).toMatchObject({
      type: "GAME_ENDED",
      winner: host.joined.selfId,
      reason: "opponents-forfeited",
    });
  });
});
