import { afterEach, describe, expect, it } from "vitest";
import { createMetrics, Metrics } from "./metrics.js";
import { startTestServer, type TestServer } from "./testkit.js";
import type { RoomJoined } from "@deckxi/shared";

let server: TestServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

/** Pull one series' value out of the exposition text. */
function series(text: string, line: string): number | undefined {
  const match = new RegExp(`^${line.replace(/[{}"+]/g, (c) => `\\${c}`)} (\\S+)$`, "m").exec(text);
  return match?.[1] === undefined ? undefined : Number(match[1]);
}

describe("metrics exposition", () => {
  it("renders declared counters at zero, so alerts can be written before the first event", () => {
    const text = createMetrics().render();
    expect(text).toContain("# TYPE deckxi_games_started_total counter");
    expect(series(text, "deckxi_games_started_total")).toBe(0);
  });

  it("counts per label set, independent of key order", () => {
    const metrics = new Metrics();
    metrics.declareCounter("t_total", "test");
    metrics.increment("t_total", { a: "1", b: "2" });
    metrics.increment("t_total", { b: "2", a: "1" });
    metrics.increment("t_total", { a: "9", b: "2" });
    const text = metrics.render();
    expect(series(text, 't_total{a="1",b="2"}')).toBe(2);
    expect(series(text, 't_total{a="9",b="2"}')).toBe(1);
  });

  it("escapes label values rather than emitting broken exposition", () => {
    const metrics = new Metrics();
    metrics.declareCounter("t_total", "test");
    metrics.increment("t_total", { reason: 'a"b' });
    expect(metrics.render()).toContain('t_total{reason="a\\"b"} 1');
  });

  it("buckets game durations cumulatively", () => {
    const metrics = new Metrics();
    metrics.observeGameDuration(10);
    metrics.observeGameDuration(45);
    metrics.observeGameDuration(5000);
    const text = metrics.render();
    expect(series(text, 'deckxi_game_duration_seconds_bucket{le="15"}')).toBe(1);
    expect(series(text, 'deckxi_game_duration_seconds_bucket{le="60"}')).toBe(2);
    expect(series(text, 'deckxi_game_duration_seconds_bucket{le="+Inf"}')).toBe(3);
    expect(series(text, "deckxi_game_duration_seconds_count")).toBe(3);
    expect(series(text, "deckxi_game_duration_seconds_sum")).toBe(5055);
  });

  it("reads gauges at scrape time", () => {
    const metrics = new Metrics();
    let value = 1;
    metrics.gauge("t_gauge", "test", () => value);
    expect(series(metrics.render(), "t_gauge")).toBe(1);
    value = 7;
    expect(series(metrics.render(), "t_gauge")).toBe(7);
  });
});

describe("/metrics endpoint", () => {
  it("counts a real game end to end", async () => {
    server = await startTestServer();
    const host = server.client();
    await host.connected();
    const joined = await host.call<RoomJoined>("room:create", { name: "Host" });
    const guest = server.client();
    await guest.connected();
    await guest.call<RoomJoined>("room:join", { code: joined.room.code, name: "Guest" });
    await guest.call("room:ready", { ready: true });
    await host.call("room:start", undefined);
    await host.call("game:forfeit", undefined);

    // Loopback, so no token is needed — that is the dev/test affordance.
    const text = await (await fetch(`${server.url}/metrics`)).text();
    expect(series(text, "deckxi_rooms_created_total")).toBe(1);
    expect(series(text, 'deckxi_room_joins_total{spectator="false"}')).toBe(1);
    expect(series(text, "deckxi_games_started_total")).toBe(1);
    expect(series(text, 'deckxi_games_finished_total{reason="opponents-forfeited"}')).toBe(1);
    expect(series(text, "deckxi_active_rooms")).toBe(1);
    expect(series(text, "deckxi_active_games")).toBe(0);
    expect(series(text, "deckxi_active_sockets")).toBe(2);
    expect(series(text, 'deckxi_commands_total{command="room:start"}')).toBe(1);
  });

  it("counts rejected commands by error code", async () => {
    server = await startTestServer();
    const client = server.client();
    await client.connected();
    await client.callRaw("room:join", { code: "ZZZZZZ", name: "Nobody" });
    const text = await (await fetch(`${server.url}/metrics`)).text();
    expect(series(text, 'deckxi_command_rejections_total{code="room-not-found"}')).toBe(1);
  });

  it("requires the bearer token when one is configured, and 404s otherwise", async () => {
    server = await startTestServer({ admin: { token: "a-token-at-least-16-chars" } });
    expect((await fetch(`${server.url}/metrics`)).status).toBe(404);
    const ok = await fetch(`${server.url}/metrics`, {
      headers: { authorization: "Bearer a-token-at-least-16-chars" },
    });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toContain("text/plain");
  });
});
