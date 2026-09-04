/**
 * Multi-instance (#86).
 *
 * The interesting tests here run **two whole servers in one process**, sharing
 * an in-memory directory and bus. That is the same shape as two Cloud Run
 * instances sharing Redis, and it is the only way the forwarding path gets
 * exercised in CI without standing up a broker: a player connected to server B
 * joins a room owned by server A, plays, and sees every event.
 */
import { afterEach, describe, expect, it } from "vitest";
import type { RedactedGameEvent, RoomJoined, RoomView } from "@deckxi/shared";
import {
  InMemoryMessageBus,
  InMemoryRoomDirectory,
  localCluster,
  type Cluster,
} from "./cluster.js";
import { startTestServer, type TestServer } from "./testkit.js";

describe("the room directory", () => {
  it("hands a code to the first instance that claims it", async () => {
    const directory = new InMemoryRoomDirectory();
    expect(await directory.register({ roomId: "r1", code: "ABC123", instanceId: "a" })).toBe(true);
    expect(await directory.register({ roomId: "r2", code: "ABC123", instanceId: "b" })).toBe(false);
    expect(await directory.lookupByCode("ABC123")).toMatchObject({ instanceId: "a" });
  });

  it("re-registering the same room is a refresh, not a collision", async () => {
    const directory = new InMemoryRoomDirectory();
    await directory.register({ roomId: "r1", code: "ABC123", instanceId: "a" });
    expect(await directory.register({ roomId: "r1", code: "ABC123", instanceId: "a" })).toBe(true);
  });

  it("frees the code when the room goes", async () => {
    const directory = new InMemoryRoomDirectory();
    await directory.register({ roomId: "r1", code: "ABC123", instanceId: "a" });
    await directory.unregister("r1");
    expect(await directory.lookupByCode("ABC123")).toBeNull();
    expect(await directory.register({ roomId: "r2", code: "ABC123", instanceId: "b" })).toBe(true);
  });
});

describe("the bus", () => {
  it("answers 'room-not-found' for an instance that is gone", async () => {
    const bus = new InMemoryMessageBus();
    const reply = await bus.request("dead", { kind: "disconnect", sessionId: "s" });
    // The honest answer: whatever the player was reaching for is not there.
    expect(reply).toMatchObject({ ok: false, code: "room-not-found" });
  });
});

describe("two instances", () => {
  let a: TestServer | undefined;
  let b: TestServer | undefined;

  afterEach(async () => {
    await a?.close();
    await b?.close();
    a = undefined;
    b = undefined;
  });

  /** Two servers wired into one cluster, exactly as Redis would wire them. */
  async function pair(): Promise<{ a: TestServer; b: TestServer }> {
    const directory = new InMemoryRoomDirectory();
    const bus = new InMemoryMessageBus();
    const clusterA: Cluster = { id: "instance-a", directory, bus };
    const clusterB: Cluster = { id: "instance-b", directory, bus };
    a = await startTestServer({ cluster: clusterA, rooms: { turnTimerMsOverride: 60_000 } });
    b = await startTestServer({ cluster: clusterB, rooms: { turnTimerMsOverride: 60_000 } });
    return { a, b };
  }

  it("lets a player on one instance join and play in a room owned by the other", async () => {
    const { a: serverA, b: serverB } = await pair();

    const host = serverA.client();
    await host.connected();
    const created = await host.call<RoomJoined>("room:create", {
      name: "Host",
      settings: { cardsPerPlayer: 3 },
    });

    // The code was minted on A; this client only ever talks to B.
    const guest = serverB.client();
    await guest.connected();
    const joined = await guest.call<RoomJoined>("room:join", {
      code: created.room.code,
      name: "Guest",
    });
    expect(joined.roomId).toBe(created.roomId);

    // Lobby state reaches the remote player: the room's fan-out is per
    // session, not a broadcast to the sockets one process happens to hold.
    const guestStates = guest.collect<RoomView>("room:state");
    const guestEvents = guest.collect<RedactedGameEvent[]>("game:events");
    await guest.call("room:ready", { ready: true });
    await expect.poll(() => guestStates.at(-1)?.players.length).toBe(2);

    // And a forwarded command is decided by the owner: B has no room at all.
    await host.call("room:start");
    await expect.poll(() => guestEvents.flat().length).toBeGreaterThan(0);
    expect(serverB.app.rooms.getRoom(created.roomId)).toBeUndefined();

    const started = guestEvents.flat().find((e) => e.type === "GAME_STARTED");
    // Redaction still happens on the owner, for the right viewer.
    expect(started?.type === "GAME_STARTED" && started.yourHand).not.toBeNull();
  });

  it("carries chat both ways across instances", async () => {
    const { a: serverA, b: serverB } = await pair();
    const host = serverA.client();
    await host.connected();
    const created = await host.call<RoomJoined>("room:create", { name: "Host" });
    const guest = serverB.client();
    await guest.connected();
    await guest.call<RoomJoined>("room:join", { code: created.room.code, name: "Guest" });

    const hostChat = host.collect<{ text: string }>("chat:message");
    const guestChat = guest.collect<{ text: string }>("chat:message");
    await guest.call("chat:send", { text: "hello from B" });
    await host.call("chat:send", { text: "hello from A" });

    await expect.poll(() => hostChat.map((m) => m.text)).toEqual(["hello from B", "hello from A"]);
    await expect.poll(() => guestChat.map((m) => m.text)).toEqual(["hello from B", "hello from A"]);
  });

  it("lets a remote player leave, and tells the owner when their socket dies", async () => {
    const { a: serverA, b: serverB } = await pair();
    const host = serverA.client();
    await host.connected();
    const created = await host.call<RoomJoined>("room:create", { name: "Host" });

    const guest = serverB.client();
    await guest.connected();
    await guest.call<RoomJoined>("room:join", { code: created.room.code, name: "Guest" });
    expect(serverA.app.rooms.getRoom(created.roomId)?.players).toHaveLength(2);

    guest.disconnect();
    // The owner never sees that socket close, so the instance holding it says
    // so — otherwise the seat sits there until the room is reaped.
    await expect.poll(() => serverA.app.rooms.getRoom(created.roomId)?.players.length).toBe(1);
  });

  it("resumes onto whichever instance the reconnect lands on", async () => {
    const { a: serverA, b: serverB } = await pair();
    const host = serverA.client();
    await host.connected();
    const created = await host.call<RoomJoined>("room:create", {
      name: "Host",
      settings: { cardsPerPlayer: 3 },
    });
    const guest = serverA.client();
    await guest.connected();
    const joined = await guest.call<RoomJoined>("room:join", {
      code: created.room.code,
      name: "Guest",
    });
    await guest.call("room:ready", { ready: true });
    await host.call("room:start");
    guest.disconnect();

    // Same player, different machine.
    const reconnected = serverB.client();
    await reconnected.connected();
    const resumed = await reconnected.call<RoomJoined & { events: RedactedGameEvent[] }>(
      "room:resume",
      { roomId: joined.roomId, resumeToken: joined.resumeToken },
    );
    expect(resumed.selfId).toBe(joined.selfId);
    expect(resumed.events.length).toBeGreaterThan(0);
  });

  it("still refuses a code nobody in the cluster owns", async () => {
    const { b: serverB } = await pair();
    const client = serverB.client();
    await client.connected();
    const reply = await client.callRaw("room:join", { code: "ZZZZZZ", name: "Nobody" });
    expect(reply.ok === false && reply.code).toBe("room-not-found");
  });
});

describe("a cluster of one", () => {
  it("is what you get by default, and nothing crosses a wire", async () => {
    const cluster = localCluster("solo");
    expect(cluster.id).toBe("solo");
    expect(await cluster.directory.lookupByCode("ABC123")).toBeNull();
  });
});
