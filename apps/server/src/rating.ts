/**
 * Player ratings (#80).
 *
 * Elo, generalised to a table. A DeckXI game has one winner and two to five
 * losers, so the match is scored as the pairwise round-robin it effectively
 * is: the winner beats every other player, everyone else draws with each
 * other. Each player's K is divided by the number of pairs they took part in,
 * so a six-player game does not move ratings six times as far as a duel.
 *
 * Why Elo and not Glicko: Glicko's value is its rating deviation, which needs
 * per-player match timestamps and a rating period to mean anything. With the
 * volume this game has, a provisional-K rule (below) buys most of the same
 * benefit — new players converge quickly — for a fraction of the machinery.
 * If the population ever justifies it, the seam is `rateMatch`.
 *
 * Pure and total: no clock, no I/O, no database. Ties in the input order can
 * never change the result, because every pair is scored independently.
 */

/** Everyone starts here; the number is arbitrary and conventional. */
export const DEFAULT_RATING = 1200;

/** Below this many rated games a player moves faster — they are still being placed. */
export const PLACEMENT_GAMES = 10;

const K_ESTABLISHED = 24;
const K_PLACEMENT = 48;

export interface RatedPlayer {
  userId: string;
  rating: number;
  /** Rated games already played in this mode and season. */
  games: number;
}

export interface RatingChange {
  userId: string;
  before: number;
  after: number;
  delta: number;
}

function kFactor(games: number): number {
  return games < PLACEMENT_GAMES ? K_PLACEMENT : K_ESTABLISHED;
}

/** Elo's expectation that `a` beats `b`. */
export function expectedScore(a: number, b: number): number {
  return 1 / (1 + 10 ** ((b - a) / 400));
}

/**
 * Rate one finished match. `winnerId` must be one of the players; a match
 * with fewer than two rated players returns no changes, because a rating is
 * a statement about an opponent and there wasn't one.
 *
 * Ratings are rounded to whole points at the end, not per pair — rounding
 * each pair would leak a point or two per match into the pool.
 */
export function rateMatch(players: readonly RatedPlayer[], winnerId: string): RatingChange[] {
  if (players.length < 2) return [];
  if (!players.some((p) => p.userId === winnerId)) return [];

  const pairs = players.length - 1;
  return players.map((player) => {
    let delta = 0;
    for (const other of players) {
      if (other.userId === player.userId) continue;
      const actual = player.userId === winnerId ? 1 : other.userId === winnerId ? 0 : 0.5;
      delta +=
        (kFactor(player.games) / pairs) * (actual - expectedScore(player.rating, other.rating));
    }
    const after = Math.round(player.rating + delta);
    return { userId: player.userId, before: player.rating, after, delta: after - player.rating };
  });
}

/**
 * The season a match counts towards. Seasons follow data editions: a new
 * edition changes what the cards are worth, so carrying ratings across one
 * would be scoring two different games on one ladder.
 */
export function seasonOf(editionId: string): string {
  return editionId;
}
