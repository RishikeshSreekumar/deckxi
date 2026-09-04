/**
 * Voice (#89): the credential maths and the relay's boundaries.
 *
 * There is no way to test a real peer connection here, and no value in
 * pretending — what the server does is issue short-lived TURN credentials and
 * pass opaque blobs between two players in the same room. Both are testable,
 * and both are where a mistake would be a security problem rather than a
 * dropped call.
 */
import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import type { RoomJoined, VoiceSignalView, VoiceStateView } from "@deckxi/shared";
import { DEFAULT_STUN, iceServers, parseTurnUrls } from "./voice.js";
import { startTestServer, type TestServer } from "./testkit.js";

describe("ICE configuration", () => {
  it("is STUN-only when no TURN is configured", () => {
    const servers = iceServers("user-1", null);
    expect(servers).toHaveLength(1);
    expect(servers[0]?.urls).toEqual(DEFAULT_STUN);
    expect(servers[0]?.username).toBeUndefined();
  });

  it("signs a coturn REST credential that expires", () => {
    const now = 1_700_000_000_000;
    const [, turn] = iceServers(
      "user-1",
      { urls: ["turn:turn.example.com:3478"], secret: "shhh", ttlSeconds: 600 },
      now,
    );
    expect(turn?.username).toBe(`${now / 1000 + 600}:user-1`);
    // The password is the HMAC of the username — which is what makes it
    // verifiable by the TURN server without us provisioning anything.
    const expected = createHmac("sha1", "shhh")
      .update(turn?.username ?? "")
      .digest("base64");
    expect(turn?.credential).toBe(expected);
  });

  it("gives two players different credentials", () => {
    const turn = { urls: ["turn:t:3478"], secret: "shhh" };
    const a = iceServers("user-a", turn)[1]?.credential;
    const b = iceServers("user-b", turn)[1]?.credential;
    expect(a).not.toBe(b);
  });

  it("reads a comma-separated URL list", () => {
    expect(parseTurnUrls("turn:a:3478, turns:b:5349")).toEqual(["turn:a:3478", "turns:b:5349"]);
    expect(parseTurnUrls(undefined)).toEqual([]);
    expect(parseTurnUrls("")).toEqual([]);
  });
});

describe("the signalling relay", () => {
  let server: TestServer | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  async function tableOfTwo(s: TestServer) {
    const host = s.client();
    await host.connected();
    const hostJoined = await host.call<RoomJoined>("room:create", { name: "Host" });
    const guest = s.client();
    await guest.connected();
    const guestJoined = await guest.call<RoomJoined>("room:join", {
      code: hostJoined.room.code,
      name: "Guest",
    });
    return { host, hostJoined, guest, guestJoined };
  }

  it("passes an offer to the named player, stamped with who sent it", async () => {
    server = await startTestServer();
    const { host, hostJoined, guest, guestJoined } = await tableOfTwo(server);
    const inbox = guest.collect<VoiceSignalView>("voice:signal");

    await host.call("voice:signal", {
      to: guestJoined.selfId,
      signal: { kind: "description", description: { type: "offer", sdp: "v=0 fake" } },
    });

    await expect.poll(() => inbox.length).toBe(1);
    expect(inbox[0]).toMatchObject({ from: hostJoined.selfId, to: guestJoined.selfId });
  });

  it("refuses to signal someone who is not at your table", async () => {
    server = await startTestServer();
    const s = server;
    const { host } = await tableOfTwo(s);
    const outsider = s.client();
    await outsider.connected();
    const theirRoom = await outsider.call<RoomJoined>("room:create", { name: "Elsewhere" });

    const reply = await host.callRaw("voice:signal", {
      to: theirRoom.selfId,
      signal: { kind: "candidate", candidate: { candidate: "candidate:1 udp" } },
    });
    expect(reply.ok).toBe(false);
  });

  it("tells the whole table who has a live mic, and stops when they do", async () => {
    server = await startTestServer();
    const { host, hostJoined, guest } = await tableOfTwo(server);
    const states = guest.collect<VoiceStateView>("voice:state");

    await host.call("voice:state", { live: true });
    await expect.poll(() => states.at(-1)?.live).toEqual([hostJoined.selfId]);

    await host.call("voice:state", { live: false });
    await expect.poll(() => states.at(-1)?.live).toEqual([]);
  });

  it("keeps a muted player in the call, so the others still connect to them", async () => {
    server = await startTestServer();
    const { host, hostJoined, guest, guestJoined } = await tableOfTwo(server);
    const states = guest.collect<VoiceStateView>("voice:state");

    await host.call("voice:state", { live: true, inCall: true });
    await guest.call("voice:state", { live: true, inCall: true });
    await expect
      .poll(() => states.at(-1)?.inCall?.slice().sort())
      .toEqual([hostJoined.selfId, guestJoined.selfId].sort());

    // Muting is not leaving: the dot goes out, the connection stays.
    await host.call("voice:state", { live: false, inCall: true });
    await expect.poll(() => states.at(-1)?.live).toEqual([guestJoined.selfId]);
    expect(states.at(-1)?.inCall?.slice().sort()).toEqual(
      [hostJoined.selfId, guestJoined.selfId].sort(),
    );

    // Leaving is.
    await host.call("voice:state", { live: false, inCall: false });
    await expect.poll(() => states.at(-1)?.inCall).toEqual([guestJoined.selfId]);
  });

  it("drops a player out of the call when their socket goes", async () => {
    server = await startTestServer();
    const { host, hostJoined, guest, guestJoined } = await tableOfTwo(server);
    const states = host.collect<VoiceStateView>("voice:state");
    await host.call("voice:state", { live: true, inCall: true });
    await guest.call("voice:state", { live: true, inCall: true });
    await expect.poll(() => states.at(-1)?.inCall?.length).toBe(2);

    guest.disconnect();
    // A mic dot that outlives its player says someone is listening when
    // nobody is.
    await expect.poll(() => states.at(-1)?.inCall).toEqual([hostJoined.selfId]);
    expect(states.at(-1)?.live).toEqual([hostJoined.selfId]);
    expect(guestJoined.selfId).not.toEqual(hostJoined.selfId);
  });

  it("needs a session: you cannot signal into a room you are not in", async () => {
    server = await startTestServer();
    const stranger = server.client();
    await stranger.connected();
    const reply = await stranger.callRaw("voice:signal", {
      to: "someone",
      signal: { kind: "description", description: { type: "offer", sdp: "v=0" } },
    });
    expect(reply.ok === false && reply.code).toBe("not-in-room");
  });

  it("refuses voice at a quick-match table, where the players are strangers", async () => {
    server = await startTestServer({ botWaitMs: 5 });
    const s = server;
    const solo = s.client();
    await solo.connected();
    const matched = solo.next<RoomJoined>("queue:matched");
    await solo.call("queue:join", { gameMode: "classic-trumps", name: "Solo" });
    const joined = await matched;
    expect(joined.room.matchmade).toBe(true);

    // The UI hides the button; the server is what makes it a rule.
    const signal = await solo.callRaw("voice:signal", {
      to: joined.selfId,
      signal: { kind: "description", description: { type: "offer", sdp: "v=0" } },
    });
    expect(signal.ok).toBe(false);
    const state = await solo.callRaw("voice:state", { live: true });
    expect(state.ok).toBe(false);
  });

  it("requires a session for TURN credentials", async () => {
    server = await startTestServer();
    expect((await fetch(`${server.url}/api/voice/ice`)).status).toBe(401);
  });
});
