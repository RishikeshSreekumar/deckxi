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
    const cookie = await signInGuest(s.url);
    const host = s.client({ cookie });
    await host.connected();
    const joined = await host.call<RoomJoined>("room:create", {
      name: "Host",
      settings: { cardsPerPlayer: 3 },
    });
    const guest = s.client();
    await guest.connected();
    await guest.call<RoomJoined>("room:join", { code: joined.room.code, name: "Guest" });
    await guest.call("room:ready", { ready: true });
    await host.call("room:start");

    // Play the host's calls until someone runs out of cards. Whatever they
    // won rounds with is what should land in the collection.
    const room = s.app.rooms.getRoom(joined.roomId);
    for (let i = 0; i < 60 && room?.phase === "playing"; i++) {
      const state = room.game?.state as { leader: string; config: { stats: { key: string }[] } };
      const leader = state.leader;
      const stat = state.config.stats[i % state.config.stats.length]?.key ?? "runs";
      const client = leader === joined.selfId ? host : guest;
      await client.callRaw("game:selectStat", { stat });
    }

    const collection = await expect
      .poll(async () => {
        const response = await fetch(`${s.url}/api/me/collection`, { headers: { cookie } });
        return ((await response.json()) as { cards: unknown[] }).cards.length;
      })
      .toBeGreaterThan(0)
      .then(async () => {
        const response = await fetch(`${s.url}/api/me/collection`, { headers: { cookie } });
        return (await response.json()) as {
          cards: { editionId: string; cardId: string; wins: number }[];
        };
      });

    const first = collection.cards[0];
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
