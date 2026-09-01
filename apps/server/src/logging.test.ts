import { describe, expect, it } from "vitest";
import pino from "pino";
import { buildApp } from "./app.js";
import { loggerOptions, nullLogger, requestId, type Logger } from "./logging.js";
import { RoomManager, type RoomsObserver } from "./rooms.js";

interface Line {
  bindings: Record<string, unknown>;
  fields: object;
  message: string | undefined;
}

/** A Logger that records instead of writing, with child bindings merged in. */
function recorder(
  lines: Line[] = [],
  bindings: Record<string, unknown> = {},
): Logger & {
  lines: Line[];
} {
  const write =
    () =>
    (fields: object, message?: string): void => {
      lines.push({ bindings, fields, message });
    };
  return {
    lines,
    debug: write(),
    info: write(),
    warn: write(),
    error: write(),
    child: (extra) => recorder(lines, { ...bindings, ...extra }),
  };
}

const silentObserver: RoomsObserver = {
  roomState: () => undefined,
  roomClosed: () => undefined,
  gameEvents: () => undefined,
  timer: () => undefined,
};

describe("logger options", () => {
  it("maps pino levels onto Cloud Logging severities", () => {
    const format = loggerOptions({ level: "info", appEnv: "staging", release: "abc123" })[
      "formatters"
    ] as { level: (label: string) => object };
    expect(format.level("error")).toEqual({ severity: "ERROR", level: "error" });
    expect(format.level("info")).toEqual({ severity: "INFO", level: "info" });
    expect(format.level("warn")).toEqual({ severity: "WARNING", level: "warn" });
  });

  it("stamps service, env and release on every line, and renames msg to message", () => {
    const options = loggerOptions({ level: "info", appEnv: "production", release: "deadbee" });
    expect(options["base"]).toEqual({
      service: "deckxi-server",
      env: "production",
      release: "deadbee",
    });
    expect(options["messageKey"]).toBe("message");
  });

  it("redacts session cookies and the admin token", () => {
    const redact = loggerOptions({ level: "info", appEnv: "staging", release: undefined })[
      "redact"
    ] as { paths: string[] };
    expect(redact.paths).toContain("req.headers.cookie");
    expect(redact.paths).toContain("req.headers.authorization");
  });
});

describe("request correlation ids", () => {
  it("reuses an upstream x-request-id", () => {
    expect(requestId({ "x-request-id": "from-proxy" })).toBe("from-proxy");
  });

  it("falls back to the Cloud Run trace id", () => {
    expect(requestId({ "x-cloud-trace-context": "trace-abc/span-1;o=1" })).toBe("trace-abc");
  });

  it("generates one when the caller has none", () => {
    const id = requestId({});
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(requestId({})).not.toBe(id);
  });

  it("ignores an absurdly long header rather than logging it", () => {
    expect(requestId({ "x-request-id": "x".repeat(200) })).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("room lifecycle logging", () => {
  it("logs creation, joins and closure with correlation ids", () => {
    const log = recorder();
    const manager = new RoomManager(silentObserver, { logger: log });
    const { room } = manager.createRoom("Host", {}, "user-1");
    manager.joinRoom(room.code, "Guest", false, "user-2");
    manager.reapIdle(Date.now() + 60 * 60 * 1000);

    const events = log.lines.map((l) => (l.fields as { event: string }).event);
    expect(events).toEqual(["room.created", "room.joined", "room.closed"]);
    for (const line of log.lines) {
      expect((line.fields as { roomId: string }).roomId).toBe(room.id);
    }
    expect(log.lines[0]?.fields).toMatchObject({ userId: "user-1" });
    expect(log.lines[2]?.fields).toMatchObject({ reason: "idle" });
  });

  it("logs a match id on game start and finish", () => {
    const log = recorder();
    const manager = new RoomManager(silentObserver, { logger: log, turnTimerMsOverride: 60_000 });
    const { room, session } = manager.createRoom("Host");
    const guest = manager.joinRoom(room.code, "Guest");
    manager.setReady(guest.session.id, true);
    manager.startGame(session.id);
    const started = log.lines.find((l) => (l.fields as { event: string }).event === "game.started");
    expect(started?.fields).toMatchObject({ roomId: room.id, players: 2 });
    expect((started?.fields as { matchId: string }).matchId).toBe(room.game?.matchId);

    manager.forfeit(session.id);
    const finished = log.lines.find(
      (l) => (l.fields as { event: string }).event === "game.finished",
    );
    expect(finished?.fields).toMatchObject({ reason: "opponents-forfeited" });
    manager.closeAll();
  });

  it("defaults to silence, so library use logs nothing", () => {
    const manager = new RoomManager(silentObserver);
    const { room } = manager.createRoom("Host");
    expect(room.code).toHaveLength(6);
    expect(nullLogger.child({ a: 1 })).toBe(nullLogger);
  });
});

describe("buildApp logger wiring", () => {
  it("accepts a pre-built pino instance and logs through it", async () => {
    // Regression: Fastify 5 rejects an instance passed as `logger`
    // (FST_ERR_LOG_INVALID_LOGGER_CONFIG), which crashed the container on boot.
    const written: string[] = [];
    const log = pino({ level: "info" }, { write: (line: string) => written.push(line) });
    const app = buildApp({ loggerInstance: log });
    await app.fastify.ready();
    const res = await app.fastify.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(written.some((line) => line.includes("incoming request"))).toBe(true);
    await app.close();
  });
});
