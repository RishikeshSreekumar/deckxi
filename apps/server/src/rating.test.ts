/**
 * Ratings (#80): the Elo maths on its own, then the ladder end to end —
 * a game finishes, the players' rows move, and the leaderboard shows it.
 */
import { afterEach, describe, expect, it } from "vitest";
import type { RoomJoined } from "@deckxi/shared";
import { DEFAULT_RATING, expectedScore, PLACEMENT_GAMES, rateMatch, seasonOf } from "./rating.js";
import { InMemoryMatchStore } from "./store.js";
import { startTestServer, type TestServer } from "./testkit.js";

const player = (userId: string, rating = DEFAULT_RATING, games = PLACEMENT_GAMES) => ({
  userId,
  rating,
  games,
});

describe("expectedScore", () => {
  it("is even between equals and lopsided across a gap", () => {
    expect(expectedScore(1200, 1200)).toBe(0.5);
    expect(expectedScore(1600, 1200)).toBeGreaterThan(0.9);
    expect(expectedScore(1200, 1600)).toBeLessThan(0.1);
  });
});

describe("rateMatch", () => {
  it("moves the winner up and the loser down by the same amount", () => {
    const [winner, loser] = rateMatch([player("a"), player("b")], "a");
    expect(winner?.delta).toBeGreaterThan(0);
    expect(loser?.delta).toBeLessThan(0);
    expect(winner?.delta).toBe(-(loser?.delta ?? 0));
  });

  it("gives less for beating someone far below you", () => {
    const [strong] = rateMatch([player("a", 1800), player("b", 1200)], "a");
    const [even] = rateMatch([player("a", 1200), player("b", 1200)], "a");
    expect(strong?.delta ?? 0).toBeLessThan(even?.delta ?? 0);
  });

  it("moves a player still being placed further than an established one", () => {
    const [newcomer] = rateMatch([player("a", DEFAULT_RATING, 0), player("b")], "a");
    const [veteran] = rateMatch([player("a"), player("b")], "a");
    expect(newcomer?.delta ?? 0).toBeGreaterThan(veteran?.delta ?? 0);
  });

  it("does not move a six-player table six times as far", () => {
    const table = ["a", "b", "c", "d", "e", "f"].map((id) => player(id));
    const [winnerOfSix] = rateMatch(table, "a");
    const [winnerOfTwo] = rateMatch([player("a"), player("b")], "a");
    // Same K, spread over the pairs — the winner of a big table gains about
    // what the winner of a duel does, not a multiple of it.
    expect(winnerOfSix?.delta ?? 0).toBeCloseTo(winnerOfTwo?.delta ?? 0, 0);
  });

  it("treats the losers as having drawn with each other", () => {
    const changes = rateMatch([player("a", 1400), player("b", 1200), player("c", 1200)], "a");
    const b = changes.find((c) => c.userId === "b");
    const c = changes.find((c) => c.userId === "c");
    expect(b?.delta).toBe(c?.delta);
  });

  it("refuses to rate what it cannot: one player, or a winner who wasn't there", () => {
    expect(rateMatch([player("a")], "a")).toEqual([]);
    expect(rateMatch([player("a"), player("b")], "z")).toEqual([]);
  });

  it("puts a season on an edition, because the cards changed", () => {
    expect(seasonOf("edition-2026-q3")).toBe("edition-2026-q3");
  });
});

describe("the ladder", () => {
  it("counts games and wins, and orders by rating", async () => {
    const store = new InMemoryMatchStore();
    await store.saveRatings([
      { userId: "a", gameMode: "classic-trumps", seasonId: "s1", rating: 1240, won: true },
      { userId: "b", gameMode: "classic-trumps", seasonId: "s1", rating: 1160, won: false },
    ]);
    await store.saveRatings([
      { userId: "b", gameMode: "classic-trumps", seasonId: "s1", rating: 1200, won: true },
    ]);

    const board = await store.leaderboard("classic-trumps", "s1");
    expect(board.map((r) => r.userId)).toEqual(["a", "b"]);
    expect(board.find((r) => r.userId === "b")).toMatchObject({ games: 2, wins: 1, rating: 1200 });
  });

  it("keeps modes and seasons apart", async () => {
    const store = new InMemoryMatchStore();
    await store.saveRatings([
      { userId: "a", gameMode: "classic-trumps", seasonId: "s1", rating: 1300, won: true },
      { userId: "a", gameMode: "squad-draft", seasonId: "s1", rating: 1100, won: false },
      { userId: "a", gameMode: "classic-trumps", seasonId: "s2", rating: 1200, won: false },
    ]);

    expect(await store.leaderboard("squad-draft", "s1")).toHaveLength(1);
    expect(await store.leaderboard("classic-trumps", "s2")).toHaveLength(1);
    expect(await store.userRatings("a")).toHaveLength(3);
  });

  it("takes the ladder entry with a deleted account", async () => {
    const store = new InMemoryMatchStore();
    await store.saveRatings([
      { userId: "a", gameMode: "classic-trumps", seasonId: "s1", rating: 1300, won: true },
    ]);
    await store.anonymizeUser("a");
    expect(await store.leaderboard("classic-trumps", "s1")).toEqual([]);
  });

  it("carries a guest's rating onto the account they sign up with", async () => {
    const store = new InMemoryMatchStore();
    await store.saveRatings([
      { userId: "guest", gameMode: "classic-trumps", seasonId: "s1", rating: 1300, won: true },
    ]);
    await store.reassignUser("guest", "account");
    const rows = await store.userRatings("account");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.rating).toBe(1300);
    expect(await store.userRatings("guest")).toEqual([]);
  });
});

describe("rating a real game", () => {
  let server: TestServer | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  /** A guest account is still an account — the ladder counts it. */
  async function signInGuest(url: string): Promise<string> {
    const response = await fetch(`${url}/api/auth/sign-in/anonymous`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    return (response.headers.getSetCookie() ?? []).map((cookie) => cookie.split(";")[0]).join("; ");
  }

  it("moves both players' ratings when a game is decided", async () => {
    server = await startTestServer();
    const s = server;
    const hostCookie = await signInGuest(s.url);
    const guestCookie = await signInGuest(s.url);

    const host = s.client({ cookie: hostCookie });
    await host.connected();
    const joined = await host.call<RoomJoined>("room:create", {
      name: "Host",
      settings: { cardsPerPlayer: 3 },
    });
    const guest = s.client({ cookie: guestCookie });
    await guest.connected();
    await guest.call<RoomJoined>("room:join", { code: joined.room.code, name: "Guest" });
    await guest.call("room:ready", { ready: true });
    await host.call("room:start");

    // Decided the quickest honest way: the opponent walks.
    await guest.call("game:forfeit");
    await expect
      .poll(async () => (await fetch(`${s.url}/api/leaderboard`).then((r) => r.json())).rows.length)
      .toBe(2);

    const board = (await (await fetch(`${s.url}/api/leaderboard`)).json()) as {
      rows: { name: string | null; rating: number; games: number; wins: number }[];
    };
    const [top, bottom] = board.rows;
    expect(top?.rating).toBeGreaterThan(DEFAULT_RATING);
    expect(bottom?.rating).toBeLessThan(DEFAULT_RATING);
    expect(top?.wins).toBe(1);
    expect(bottom?.games).toBe(1);
  });

  it("does not rate a table where the seats have no accounts", async () => {
    server = await startTestServer();
    const s = server;
    const host = s.client();
    await host.connected();
    const joined = await host.call<RoomJoined>("room:create", { name: "Host" });
    const guest = s.client();
    await guest.connected();
    await guest.call<RoomJoined>("room:join", { code: joined.room.code, name: "Guest" });
    await guest.call("room:ready", { ready: true });
    await host.call("room:start");
    await guest.call("game:forfeit");

    const board = (await (await fetch(`${s.url}/api/leaderboard`)).json()) as { rows: unknown[] };
    expect(board.rows).toEqual([]);
  });
});
