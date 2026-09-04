/**
 * The in-memory match store's per-user stats, per mode (Phase 9). The
 * Postgres store answers the same shape with a grouped query.
 */
import { describe, expect, it } from "vitest";
import { InMemoryMatchStore } from "./store.js";

async function seed(store: InMemoryMatchStore): Promise<void> {
  const games = [
    { id: "m1", mode: "classic-trumps", winner: "s-me" },
    { id: "m2", mode: "classic-trumps", winner: "s-them" },
    { id: "m3", mode: "squad-draft", winner: "s-me" },
    { id: "m4", mode: "squad-draft", winner: "s-me" },
    { id: "m5", mode: "power-trumps", winner: null },
  ];
  for (const g of games) {
    await store.createMatch({
      matchId: g.id,
      roomId: "r",
      roomCode: "ABCDEF",
      editionId: "edition-2026-q3",
      gameMode: g.mode,
      startedAt: new Date(2026, 8, 1),
      players: [
        { sessionId: "s-me", userId: "me", name: "Me", seat: 0 },
        { sessionId: "s-them", userId: "them", name: "Them", seat: 1 },
      ],
    });
    if (g.winner !== null) {
      await store.finishMatch(g.id, {
        finishedAt: new Date(2026, 8, 1, 1),
        winnerSessionId: g.winner,
        endReason: "league",
        rounds: 3,
      });
    }
  }
}

describe("user stats by mode", () => {
  it("tallies games and wins overall and per mode", async () => {
    const store = new InMemoryMatchStore();
    await seed(store);
    const stats = await store.userStats("me");
    expect(stats.games).toBe(5);
    expect(stats.wins).toBe(3);
    expect(stats.byMode).toEqual({
      "classic-trumps": { games: 2, wins: 1 },
      "squad-draft": { games: 2, wins: 2 },
      "power-trumps": { games: 1, wins: 0 },
    });
    const theirs = await store.userStats("them");
    expect(theirs.byMode["classic-trumps"]).toEqual({ games: 2, wins: 1 });
    expect(theirs.byMode["squad-draft"]).toEqual({ games: 2, wins: 0 });
  });

  it("is empty for a user who never played", async () => {
    const store = new InMemoryMatchStore();
    expect(await store.userStats("nobody")).toEqual({
      games: 0,
      wins: 0,
      favouriteStat: null,
      byMode: {},
    });
  });
});
