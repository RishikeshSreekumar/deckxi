/**
 * Collection meta (#84). The definition under test is the one the feature
 * rests on: a card is yours when it took a round for you, not when you merely
 * held it or swept it out of the pot.
 */
import { afterEach, describe, expect, it } from "vitest";
import type { GameEvent } from "@deckxi/engine";
import type { RoomJoined } from "@deckxi/shared";
import { cardWinsByPlayer, toCardWins } from "./collection.js";
import { InMemoryMatchStore } from "./store.js";
import { startTestServer, type TestServer } from "./testkit.js";

const resolved = (
  round: number,
  revealed: { playerId: string; cardId: string; value: number }[],
  result: GameEvent extends { type: "ROUND_RESOLVED"; result: infer R } ? R : never,
  power?: unknown,
): GameEvent =>
  ({
    type: "ROUND_RESOLVED",
    round,
    stat: "runs",
    revealed,
    result,
    ...(power !== undefined ? { power } : {}),
  }) as GameEvent;

describe("cardWinsByPlayer", () => {
  it("credits the winner's own card, and nobody else's", () => {
    const wins = cardWinsByPlayer([
      resolved(
        1,
        [
          { playerId: "a", cardId: "rohit-sharma", value: 90 },
          { playerId: "b", cardId: "jasprit-bumrah", value: 10 },
        ],
        { kind: "won", winner: "a" },
      ),
    ]);
    expect(toCardWins(wins.get("a"))).toEqual([{ cardId: "rohit-sharma", wins: 1 }]);
    expect(wins.get("b")).toBeUndefined();
  });

  it("counts a repeat win with the same card", () => {
    const round = (n: number) =>
      resolved(
        n,
        [
          { playerId: "a", cardId: "rohit-sharma", value: 90 },
          { playerId: "b", cardId: "x", value: 10 },
        ],
        { kind: "won", winner: "a" },
      );
    const wins = cardWinsByPlayer([round(1), round(2)]);
    expect(toCardWins(wins.get("a"))).toEqual([{ cardId: "rohit-sharma", wins: 2 }]);
  });

  it("credits nobody for a tie — the cards went to the pot", () => {
    const wins = cardWinsByPlayer([
      resolved(
        1,
        [
          { playerId: "a", cardId: "one", value: 50 },
          { playerId: "b", cardId: "two", value: 50 },
        ],
        { kind: "tie", tiedPlayers: ["a", "b"] },
      ),
    ]);
    expect(wins.size).toBe(0);
  });

  it("gives a Super Over round to the card that actually took it", () => {
    const wins = cardWinsByPlayer([
      resolved(
        1,
        [
          { playerId: "a", cardId: "reveal-winner", value: 90 },
          { playerId: "b", cardId: "reveal-loser", value: 10 },
        ],
        { kind: "won", winner: "a" },
        {
          drsBy: null,
          outcomes: [],
          superOvers: [
            {
              challengerCard: { playerId: "b", cardId: "super-over-card", value: 99 },
              defenderCard: { playerId: "a", cardId: "reveal-winner", value: 90 },
              winner: "b",
            },
          ],
          transfers: [],
          nextLeader: "b",
        },
      ),
    ]);
    expect(toCardWins(wins.get("b"))).toEqual([{ cardId: "super-over-card", wins: 1 }]);
    expect(wins.get("a")).toBeUndefined();
  });

  it("ignores everything that is not a resolved round", () => {
    expect(
      cardWinsByPlayer([
        { type: "PLAYER_FORFEITED", playerId: "a" },
        { type: "GAME_ENDED", winner: "b", reason: "opponents-forfeited" },
      ] as GameEvent[]).size,
    ).toBe(0);
  });
});

describe("the collection store", () => {
  it("accumulates across matches and reports most-won first", async () => {
    const store = new InMemoryMatchStore();
    await store.addCardWins("u1", "edition-2026-q3", [
      { cardId: "a", wins: 1 },
      { cardId: "b", wins: 3 },
    ]);
    await store.addCardWins("u1", "edition-2026-q3", [{ cardId: "a", wins: 2 }]);

    const rows = await store.collection("u1");
    expect(rows.map((r) => [r.cardId, r.wins])).toEqual([
      ["a", 3],
      ["b", 3],
    ]);
  });

  it("keeps editions apart — a card id is only unique inside one", async () => {
    const store = new InMemoryMatchStore();
    await store.addCardWins("u1", "edition-2026-q3", [{ cardId: "a", wins: 1 }]);
    await store.addCardWins("u1", "edition-2027-q1", [{ cardId: "a", wins: 1 }]);
    expect(await store.collection("u1")).toHaveLength(2);
  });

  it("takes the collection and the showcase with a deleted account", async () => {
    const store = new InMemoryMatchStore();
    await store.addCardWins("u1", "e", [{ cardId: "a", wins: 1 }]);
    await store.setShowcase("u1", { editionId: "e", cardId: "a" });
    await store.anonymizeUser("u1");
    expect(await store.collection("u1")).toEqual([]);
    expect(await store.getShowcase("u1")).toBeNull();
  });
});

describe("over the wire", () => {
  let server: TestServer | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  async function signInGuest(url: string): Promise<string> {
    const response = await fetch(`${url}/api/auth/sign-in/anonymous`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    return (response.headers.getSetCookie() ?? []).map((c) => c.split(";")[0]).join("; ");
  }

  it("fills a collection from a played game and pins a card to the profile", async () => {
    server = await startTestServer();
    const s = server;
    // Both seats are signed in: a round has exactly one winner, and which
    // seat that is depends on the deal, so a test that watched only one
    // account would be a coin toss (it was, in CI).
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

    const collectionOf = async (cookie: string) =>
      (await (await fetch(`${s.url}/api/me/collection`, { headers: { cookie } })).json()) as {
        cards: { editionId: string; cardId: string; wins: number }[];
      };

    // Play the leader's call until the game ends; whoever took rounds should
    // have those exact cards in their collection.
    const room = s.app.rooms.getRoom(joined.roomId);
    for (let i = 0; i < 200 && room?.phase === "playing"; i++) {
      const state = room.game?.state as { leader: string; config: { stats: { key: string }[] } };
      const stat = state.config.stats[i % state.config.stats.length]?.key ?? "runs";
      const client = state.leader === joined.selfId ? host : guest;
      await client.callRaw("game:selectStat", { stat });
    }
    expect(room?.phase).toBe("results");

    // The write is fire-and-forget, so wait for it rather than assuming.
    await expect
      .poll(async () => {
        const [mine, theirs] = await Promise.all([
          collectionOf(hostCookie),
          collectionOf(guestCookie),
        ]);
        return mine.cards.length + theirs.cards.length;
      })
      .toBeGreaterThan(0);

    const mine = await collectionOf(hostCookie);
    const winner = mine.cards.length > 0 ? { cookie: hostCookie, cards: mine.cards } : null;
    const cards = winner?.cards ?? (await collectionOf(guestCookie)).cards;
    const cookie = winner?.cookie ?? guestCookie;
    const first = cards[0];
    expect(first?.wins).toBeGreaterThan(0);

    const pinned = await fetch(`${s.url}/api/me/showcase`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ editionId: first?.editionId, cardId: first?.cardId }),
    });
    expect(pinned.status).toBe(200);

    const me = (await (await fetch(`${s.url}/api/me`, { headers: { cookie } })).json()) as {
      showcase: { cardId: string } | null;
    };
    expect(me.showcase?.cardId).toBe(first?.cardId);
  });

  it("refuses to show a card you have never won with", async () => {
    server = await startTestServer();
    const cookie = await signInGuest(server.url);
    const response = await fetch(`${server.url}/api/me/showcase`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ editionId: "edition-2026-q3", cardId: "rohit-sharma" }),
    });
    expect(response.status).toBe(403);
  });
});
