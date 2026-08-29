import { describe, expect, it } from "vitest";
import { runLoadTest } from "./loadtest.js";

describe("bot load smoke test", () => {
  // CI-sized run; `pnpm --filter @deckxi/server loadtest` does the full 50.
  it("plays 10 concurrent bot rooms to completion", async () => {
    const summary = await runLoadTest({
      rooms: 10,
      playersPerRoom: 3,
      roomTimeoutMs: 60_000,
    });
    expect(summary.failed).toEqual([]);
    expect(summary.completed).toBe(10);
    expect(summary.totalRounds).toBeGreaterThan(0);
  }, 90_000);
});
