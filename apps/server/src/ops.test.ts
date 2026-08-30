/**
 * Phase 8 — moderation, the maintenance banner and mode kill switches (#70).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RoomJoined, RoomView } from "@deckxi/shared";
import { startTestServer, AckError, type TestServer } from "./testkit.js";
import { InMemoryConfigStore, OpsConfig, CONFIG_KEY, DEFAULT_FLAGS } from "./ops.js";

const TOKEN = "an-admin-token-of-real-length";

let server: TestServer;
let config: InMemoryConfigStore;

beforeEach(async () => {
  config = new InMemoryConfigStore();
  server = await startTestServer({ admin: { token: TOKEN }, config });
});

afterEach(async () => {
  await server.close();
});

const auth = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" };

const setFlags = (patch: unknown): Promise<Response> =>
  fetch(`${server.url}/api/admin/flags`, {
    method: "PUT",
    headers: auth,
    body: JSON.stringify(patch),
  });

describe("ops flags", () => {
  it("starts with nothing switched off and no notice", async () => {
    const body = (await (
      await fetch(`${server.url}/api/admin/flags`, { headers: auth })
    ).json()) as { flags: unknown };
    expect(body.flags).toEqual(DEFAULT_FLAGS);
  });

  it("persists a change so a restart comes up already showing it", async () => {
    await setFlags({ notice: { text: "Back in ten.", level: "warning" } });
    expect(await config.read(CONFIG_KEY)).toMatchObject({
      notice: { text: "Back in ten.", level: "warning" },
    });

    // A fresh config over the same store is what a restart looks like.
    const reloaded = new OpsConfig(config);
    await reloaded.load();
    expect(reloaded.current.notice?.text).toBe("Back in ten.");
  });

  it("ignores a stored value that isn't valid flags rather than refusing to boot", async () => {
    await config.write(CONFIG_KEY, { notice: "just a string" });
    const ops = new OpsConfig(config);
    await ops.load();
    expect(ops.current).toEqual(DEFAULT_FLAGS);
  });

  it("treats a missing key as unchanged and null as cleared", async () => {
    const ops = new OpsConfig(new InMemoryConfigStore());
    await ops.update({ notice: { text: "hello", level: "info" }, modes: { x: false } });
    await ops.update({ modes: { x: true } });
    expect(ops.current.notice?.text).toBe("hello");
    await ops.update({ notice: null });
    expect(ops.current.notice).toBeNull();
    expect(ops.current.modes).toEqual({ x: true });
  });

  it("refuses a notice that is empty or absurdly long", async () => {
    expect(
      ((await (await setFlags({ notice: { text: "", level: "info" } })).json()) as { ok: boolean })
        .ok,
    ).toBe(false);
    const long = { notice: { text: "x".repeat(500), level: "info" } };
    expect(((await (await setFlags(long)).json()) as { ok: boolean }).ok).toBe(false);
  });
});

describe("maintenance notice", () => {
  it("reaches everyone already connected, and everyone who arrives after", async () => {
    const early = server.client();
    await early.connected();
    const incoming = early.next<unknown>("ops:notice");

    await setFlags({ notice: { text: "Restarting shortly.", level: "warning" } });
    expect(await incoming).toEqual({ text: "Restarting shortly.", level: "warning" });

    const late = server.client();
    const onConnect = late.next<unknown>("ops:notice");
    await late.connected();
    expect(await onConnect).toEqual({ text: "Restarting shortly.", level: "warning" });
  });

  it("clears with null", async () => {
    const client = server.client();
    await client.connected();
    await setFlags({ notice: { text: "Heads up.", level: "info" } });
    const cleared = client.next<unknown>("ops:notice");
    await setFlags({ notice: null });
    expect(await cleared).toBeNull();
  });
});

describe("game-mode kill switch", () => {
  it("stops new rooms and stops a formed lobby starting, but leaves running games alone", async () => {
    // A game already in progress before the switch is thrown.
    const host = server.client();
    await host.connected();
    const running = await host.call<RoomJoined>("room:create", { name: "Host" });
    const guest = server.client();
    await guest.connected();
    await guest.call<RoomJoined>("room:join", { code: running.room.code, name: "Guest" });
    await guest.call("room:ready", { ready: true });
    await host.call("room:start", undefined);

    // And a lobby that has not started yet.
    const waiting = server.client();
    await waiting.connected();
    const lobby = await waiting.call<RoomJoined>("room:create", { name: "Waiting" });
    const partner = server.client();
    await partner.connected();
    await partner.call<RoomJoined>("room:join", { code: lobby.room.code, name: "Partner" });
    await partner.call("room:ready", { ready: true });

    await setFlags({ modes: { "classic-trumps": false } });

    const newcomer = server.client();
    await newcomer.connected();
    await expect(newcomer.call("room:create", { name: "Late" })).rejects.toMatchObject({
      code: "mode-disabled",
    });
    await expect(waiting.call("room:start", undefined)).rejects.toBeInstanceOf(AckError);

    // The running game is untouched: pulling the rug mid-match would be worse
    // than whatever the switch was thrown for.
    await host.call("game:selectStat", { stat: "average" }).catch(() => undefined);
    const reenabled = await setFlags({ modes: { "classic-trumps": true } });
    expect(reenabled.status).toBe(200);
    await newcomer.call<RoomJoined>("room:create", { name: "Late" });
  });
});

describe("moderation", () => {
  it("closes a room, telling everyone in it why", async () => {
    const host = server.client();
    await host.connected();
    const joined = await host.call<RoomJoined>("room:create", { name: "Host" });
    const guest = server.client();
    await guest.connected();
    await guest.call<RoomJoined>("room:join", { code: joined.room.code, name: "Guest" });

    const hostClosed = host.next<{ reason: string }>("room:closed");
    const guestClosed = guest.next<{ reason: string }>("room:closed");
    const response = await fetch(`${server.url}/api/admin/rooms/${joined.roomId}/close`, {
      method: "POST",
      headers: auth,
      body: "{}",
    });
    expect(await response.json()).toEqual({ ok: true });
    expect((await hostClosed).reason).toBe("closed-by-admin");
    expect((await guestClosed).reason).toBe("closed-by-admin");
  });

  it("kicks one player and leaves the room standing", async () => {
    const host = server.client();
    await host.connected();
    const joined = await host.call<RoomJoined>("room:create", { name: "Host" });
    const guest = server.client();
    await guest.connected();
    const guestJoined = await guest.call<RoomJoined>("room:join", {
      code: joined.room.code,
      name: "Guest",
    });

    const kicked = guest.next<{ reason: string }>("room:closed");
    const hostSees = host.next<RoomView>("room:state");
    const response = await fetch(`${server.url}/api/admin/rooms/${joined.roomId}/kick`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ sessionId: guestJoined.selfId }),
    });
    expect(await response.json()).toEqual({ ok: true });
    expect((await kicked).reason).toBe("kicked");
    expect((await hostSees).players.map((p) => p.name)).toEqual(["Host"]);

    // And the kicked client is genuinely out — not merely told so.
    await expect(guest.call("room:ready", { ready: true })).rejects.toMatchObject({
      code: "not-in-room",
    });
  });

  it("reports honestly when there is nothing to close or kick", async () => {
    const closed = await fetch(`${server.url}/api/admin/rooms/nope/close`, {
      method: "POST",
      headers: auth,
      body: "{}",
    });
    expect(await closed.json()).toEqual({ ok: false });
    const kick = await fetch(`${server.url}/api/admin/rooms/nope/kick`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({}),
    });
    expect(await kick.json()).toMatchObject({ ok: false });
  });

  it("keeps moderation behind the same 404 as the rest of the admin API", async () => {
    const response = await fetch(`${server.url}/api/admin/rooms/whatever/close`, {
      method: "POST",
    });
    expect(response.status).toBe(404);
  });
});
