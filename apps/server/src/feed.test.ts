import { describe, expect, it } from "vitest";
import { EventFeed, teeLogger } from "./feed.js";
import { nullLogger } from "./logging.js";

describe("event feed", () => {
  it("records structured events and skips lines without one", () => {
    const feed = new EventFeed();
    const log = teeLogger(nullLogger, feed);
    log.info({ event: "room.created", roomId: "r1" }, "room created");
    log.info({ url: "/health" }, "request completed");
    const { entries } = feed.since();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      seq: 1,
      level: "info",
      event: "room.created",
      message: "room created",
      fields: { roomId: "r1" },
    });
  });

  it("carries child bindings into the feed", () => {
    const feed = new EventFeed();
    const log = teeLogger(nullLogger, feed).child({ socketId: "s1", roomId: "r1" });
    log.debug({ event: "game.event", type: "ROUND_RESOLVED" });
    expect(feed.since().entries[0]?.fields).toMatchObject({
      socketId: "s1",
      roomId: "r1",
      type: "ROUND_RESOLVED",
    });
  });

  it("hands back only what is newer than the cursor", () => {
    const feed = new EventFeed();
    const log = teeLogger(nullLogger, feed);
    log.info({ event: "a" });
    log.info({ event: "b" });
    const first = feed.since();
    expect(first.entries.map((e) => e.event)).toEqual(["a", "b"]);
    expect(feed.since(first.cursor).entries).toEqual([]);
    log.info({ event: "c" });
    expect(feed.since(first.cursor).entries.map((e) => e.event)).toEqual(["c"]);
  });

  it("filters to one room", () => {
    const feed = new EventFeed();
    const log = teeLogger(nullLogger, feed);
    log.info({ event: "a", roomId: "r1" });
    log.info({ event: "b", roomId: "r2" });
    expect(feed.since(0, 200, "r2").entries.map((e) => e.event)).toEqual(["b"]);
  });

  it("stays bounded, dropping the oldest", () => {
    const feed = new EventFeed(3);
    const log = teeLogger(nullLogger, feed);
    for (const event of ["a", "b", "c", "d"]) log.info({ event });
    expect(feed.since().entries.map((e) => e.event)).toEqual(["b", "c", "d"]);
  });

  it("flattens errors and objects rather than holding references to them", () => {
    const feed = new EventFeed();
    const log = teeLogger(nullLogger, feed);
    log.error({ event: "store.write_failed", err: new Error("connection refused") });
    log.info({ event: "x", detail: { a: 1 }, big: "y".repeat(500) });
    const [failure, detail] = feed.since().entries;
    expect(failure?.fields["err"]).toBe("connection refused");
    expect(detail?.fields["detail"]).toBe('{"a":1}');
    expect((detail?.fields["big"] as string).length).toBe(200);
  });

  it("still writes through to the underlying logger", () => {
    const written: string[] = [];
    const base = { ...nullLogger, info: (_f: object, m?: string) => void written.push(m ?? "") };
    teeLogger(base, new EventFeed()).info({ event: "a" }, "hello");
    expect(written).toEqual(["hello"]);
  });
});
