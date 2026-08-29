import { afterEach, describe, expect, it } from "vitest";
import type { RoomJoined, RoomView } from "@deckxi/shared";
import { startTestServer, type TestClient, type TestServer } from "./testkit.js";

let server: TestServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

async function start(options: Parameters<typeof startTestServer>[0] = {}): Promise<TestServer> {
  server = await startTestServer(options);
  return server;
}

async function createRoom(
  s: TestServer,
  name = "Host",
): Promise<{ client: TestClient; joined: RoomJoined }> {
  const client = s.client();
  await client.connected();
  const joined = await client.call<RoomJoined>("room:create", { name });
  return { client, joined };
}

async function joinRoom(
  s: TestServer,
  code: string,
  name: string,
  spectator = false,
): Promise<{ client: TestClient; joined: RoomJoined }> {
  const client = s.client();
  await client.connected();
  const joined = await client.call<RoomJoined>("room:join", { code, name, spectator });
  return { client, joined };
}

describe("room lifecycle", () => {
  it("creates a room with a 6-char join code and the creator as host", async () => {
    const s = await start();
    const { joined } = await createRoom(s, "Rishi");
    expect(joined.room.code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(joined.room.hostId).toBe(joined.selfId);
    expect(joined.room.phase).toBe("lobby");
    expect(joined.room.players).toHaveLength(1);
    expect(joined.resumeToken).toBeTruthy();
    expect(joined.room.settings.gameMode).toBe("classic-trumps");
  });

  it("joins by code (case-insensitive) and broadcasts the new roster", async () => {
    const s = await start();
    const { client: host, joined } = await createRoom(s);
    const stateAfterJoin = host.next<RoomView>("room:state");
    const { joined: guest } = await joinRoom(s, joined.room.code.toLowerCase(), "Guest");
    expect(guest.room.players.map((p) => p.name)).toEqual(["Host", "Guest"]);
    expect(guest.spectator).toBe(false);
    expect((await stateAfterJoin).players).toHaveLength(2);
  });

  it("rejects unknown codes and malformed payloads", async () => {
    const s = await start();
    const client = s.client();
    await client.connected();
    const notFound = await client.callRaw("room:join", { code: "ABCDEF", name: "X" });
    expect(notFound).toMatchObject({ ok: false, code: "room-not-found" });
    const badName = await client.callRaw("room:join", { code: "ABCDEF", name: "" });
    expect(badName).toMatchObject({ ok: false, code: "bad-request" });
    const badPayload = await client.callRaw("room:create", { nope: true });
    expect(badPayload).toMatchObject({ ok: false, code: "bad-request" });
  });

  it("forces the 7th joiner into spectating", async () => {
    const s = await start();
    const { joined } = await createRoom(s);
    for (let i = 0; i < 5; i++) await joinRoom(s, joined.room.code, `P${i}`);
    const { joined: seventh } = await joinRoom(s, joined.room.code, "Late");
    expect(seventh.spectator).toBe(true);
    expect(seventh.room.players).toHaveLength(6);
    expect(seventh.room.spectators.map((x) => x.name)).toEqual(["Late"]);
  });

  it("tracks ready state, host-only settings, and rejects non-host edits", async () => {
    const s = await start();
    const { client: host, joined } = await createRoom(s);
    const { client: guest } = await joinRoom(s, joined.room.code, "Guest");

    const snapshots = guest.collect<RoomView>("room:state");
    await guest.call("room:ready", { ready: true });
    await host.call("room:settings", { cardsPerPlayer: 7, turnTimerSeconds: 30 });
    // Acks resolve after the manager broadcast, but delivery to this client is
    // async — poll briefly for the settings snapshot to arrive.
    await expect.poll(() => snapshots.at(-1)?.settings.cardsPerPlayer).toBe(7);
    expect(snapshots.some((v) => v.players.some((p) => p.ready))).toBe(true);

    const denied = await guest.callRaw("room:settings", { cardsPerPlayer: 3 });
    expect(denied).toMatchObject({ ok: false, code: "not-host" });
  });

  it("transfers host when the host leaves and closes the room when empty", async () => {
    const s = await start();
    const { client: host, joined } = await createRoom(s);
    const { client: guest, joined: guestJoined } = await joinRoom(s, joined.room.code, "Guest");

    const nextState = guest.next<RoomView>("room:state");
    await host.call("room:leave");
    expect((await nextState).hostId).toBe(guestJoined.selfId);

    const closedRoomId = guestJoined.roomId;
    await guest.call("room:leave");
    expect(s.app.rooms.getRoom(closedRoomId)).toBeUndefined();
  });

  it("removes lobby players on socket disconnect", async () => {
    const s = await start();
    const { client: host, joined } = await createRoom(s);
    const { client: guest } = await joinRoom(s, joined.room.code, "Guest");
    const nextState = host.next<RoomView>("room:state");
    guest.disconnect();
    expect((await nextState).players.map((p) => p.name)).toEqual(["Host"]);
  });

  it("reaps idle rooms and notifies members", async () => {
    const s = await start({ rooms: { idleTimeoutMs: 0 } });
    const { client: host, joined } = await createRoom(s);
    const closed = host.next<{ reason: string }>("room:closed");
    expect(s.app.rooms.reapIdle(Date.now() + 1)).toBe(1);
    expect((await closed).reason).toBe("idle");
    expect(s.app.rooms.getRoom(joined.roomId)).toBeUndefined();
  });

  it("rejects joining twice from one socket", async () => {
    const s = await start();
    const { client, joined } = await createRoom(s);
    const again = await client.callRaw("room:join", { code: joined.room.code, name: "Dup" });
    expect(again).toMatchObject({ ok: false, code: "already-in-room" });
  });
});
