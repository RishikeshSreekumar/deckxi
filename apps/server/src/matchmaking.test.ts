/**
 * Quick match (#81). Two things must hold: waiting players are paired as soon
 * as there are enough of them, and nobody waits forever — after the threshold
 * the table is filled with bots and started.
 */
import { afterEach, describe, expect, it } from "vitest";
import type { RoomJoined, RoomView, QueueStatusView } from "@deckxi/shared";
import { Matchmaker } from "./matchmaking.js";
import { startTestServer, type TestServer } from "./testkit.js";

const minPlayers = () => 2;

describe("the queue", () => {
  it("holds a lone player until the bot deadline", () => {
    let now = 0;
    const queue = new Matchmaker<string>({ minPlayers, botWaitMs: 1000, now: () => now });
    queue.join("classic-trumps", "solo");

    expect(queue.take("classic-trumps")).toBeNull();
    now = 999;
    expect(queue.take("classic-trumps")).toBeNull();
    now = 1000;
    expect(queue.take("classic-trumps")).toEqual({
      mode: "classic-trumps",
      clients: ["solo"],
      bots: 1,
    });
  });

  it("pairs two humans immediately, with no bots", () => {
    const queue = new Matchmaker<string>({ minPlayers, botWaitMs: 10_000, now: () => 0 });
    queue.join("classic-trumps", "a");
    queue.join("classic-trumps", "b");
    expect(queue.take("classic-trumps")).toEqual({
      mode: "classic-trumps",
      clients: ["a", "b"],
      bots: 0,
    });
    expect(queue.size()).toBe(0);
  });

  it("keeps modes in separate queues", () => {
    const queue = new Matchmaker<string>({ minPlayers, botWaitMs: 10_000, now: () => 0 });
    queue.join("classic-trumps", "a");
    queue.join("power-trumps", "b");
    expect(queue.take("classic-trumps")).toBeNull();
    expect(queue.size()).toBe(2);
  });

  it("lets a player leave, and re-queueing moves them rather than cloning them", () => {
    const queue = new Matchmaker<string>({ minPlayers, botWaitMs: 10_000, now: () => 0 });
    queue.join("classic-trumps", "a");
    queue.join("power-trumps", "a");
    expect(queue.waiting("classic-trumps")).toHaveLength(0);
    expect(queue.size()).toBe(1);
    expect(queue.leave("a")).toBe(true);
    expect(queue.leave("a")).toBe(false);
  });
});

describe("over the wire", () => {
  let server: TestServer | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it("pairs two waiting players into one started game", async () => {
    server = await startTestServer({ botWaitMs: 60_000 });
    const s = server;
    const a = s.client();
    const b = s.client();
    await a.connected();
    await b.connected();
    const aMatched = a.next<RoomJoined>("queue:matched");
    const bMatched = b.next<RoomJoined>("queue:matched");

    await a.call<QueueStatusView>("queue:join", { gameMode: "classic-trumps", name: "A" });
    await b.call<QueueStatusView>("queue:join", { gameMode: "classic-trumps", name: "B" });

    const [first, second] = await Promise.all([aMatched, bMatched]);
    expect(first.roomId).toBe(second.roomId);
    expect(first.room.players.map((p) => p.name).sort()).toEqual(["A", "B"]);
    // Everyone here asked for a game; there is nothing left for a lobby to
    // decide, so the table starts itself.
    await expect.poll(() => s.app.rooms.getRoom(first.roomId)?.phase).toBe("playing");
  });

  it("backfills a lone player with bots and plays on without them", async () => {
    server = await startTestServer({ botWaitMs: 5 });
    const s = server;
    const solo = s.client();
    await solo.connected();
    const matched = solo.next<RoomJoined>("queue:matched");
    const status = await solo.call<QueueStatusView>("queue:join", {
      gameMode: "classic-trumps",
      name: "Solo",
    });
    expect(status.waiting).toBe(1);

    const joined = await matched;
    const bots = joined.room.players.filter((p) => p.bot === true);
    expect(bots).toHaveLength(1);

    // The table starts itself, and the bot moves without being waited on: in
    // classic trumps only the leader calls, so a bot on the lead plays whole
    // rounds by itself — the game is either underway waiting on the human or
    // already decided, never stuck on a seat with nobody behind it.
    await expect.poll(() => s.app.rooms.getRoom(joined.roomId)?.phase).not.toBe("lobby");
    const room = s.app.rooms.getRoom(joined.roomId);
    const status2 = room?.game == null ? null : room.game.mode.status(room.game.state);
    expect(status2?.finished === true || status2?.waitingOn).toBeTruthy();
    if (status2?.finished === false) expect(status2.waitingOn).toEqual([joined.selfId]);
  });

  it("takes a queued player out of the queue when they disconnect", async () => {
    server = await startTestServer({ botWaitMs: 60_000 });
    const s = server;
    const client = s.client();
    await client.connected();
    await client.call<QueueStatusView>("queue:join", { gameMode: "classic-trumps", name: "Gone" });
    client.socket.disconnect();

    const other = s.client();
    await other.connected();
    const status = await other.call<QueueStatusView>("queue:join", {
      gameMode: "classic-trumps",
      name: "Other",
    });
    await expect.poll(() => status.waiting).toBe(1);
  });

  it("refuses to queue while you are already in a room", async () => {
    server = await startTestServer({ botWaitMs: 60_000 });
    const s = server;
    const client = s.client();
    await client.connected();
    await client.call<RoomJoined>("room:create", { name: "Host" });
    const reply = await client.callRaw<RoomView>("queue:join", {
      gameMode: "classic-trumps",
      name: "Host",
    });
    expect(reply.ok === false && reply.code).toBe("already-in-room");
  });
});
