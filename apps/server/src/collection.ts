/**
 * Collection meta (#84).
 *
 * "Cards you've won matches with" needs a definition sharp enough to compute.
 * The one that matches how the game feels: a card is yours when *it* took a
 * round for you — your card, face up, best number on the called stat. Cards
 * you merely held, or swept out of the pot without ever playing, are not
 * something you did.
 *
 * Derived from the engine log, not tracked during play: the log is server
 * truth and already persisted, so this stays a pure function over events and
 * can be recomputed for any past match if the definition ever changes.
 */
import type { GameEvent } from "@deckxi/engine";

export interface CardWin {
  cardId: string;
  wins: number;
}

/**
 * Rounds each seat won, by the card that won them. Keyed by the *session* id
 * the events name; the caller maps seats to accounts.
 *
 * Power trumps counts the same way, with one addition: a Super Over is a
 * head-to-head for the whole table, so the card that wins it is the card that
 * won the round, even though the reveal already named someone else.
 */
export function cardWinsByPlayer(events: readonly GameEvent[]): Map<string, Map<string, number>> {
  const bySeat = new Map<string, Map<string, number>>();
  const add = (playerId: string, cardId: string): void => {
    const cards = bySeat.get(playerId) ?? new Map<string, number>();
    cards.set(cardId, (cards.get(cardId) ?? 0) + 1);
    bySeat.set(playerId, cards);
  };

  for (const event of events) {
    if (event.type !== "ROUND_RESOLVED") continue;
    // A Super Over replays the round head-to-head for the whole table, so the
    // card that wins it is the card that won the round — even though the
    // reveal already named someone else.
    const superOvers = event.power?.superOvers ?? [];
    if (superOvers.length > 0) {
      let decided = false;
      for (const superOver of superOvers) {
        if (superOver.winner === null) continue;
        const card =
          superOver.challengerCard.playerId === superOver.winner
            ? superOver.challengerCard
            : superOver.defenderCard;
        add(superOver.winner, card.cardId);
        decided = true;
      }
      if (decided) continue;
    }
    if (event.result.kind !== "won") continue;
    const winner = event.result.winner;
    const card = event.revealed.find((r) => r.playerId === winner);
    if (card !== undefined) add(winner, card.cardId);
  }
  return bySeat;
}

/** Flatten one seat's tally into the rows a store writes. */
export function toCardWins(cards: Map<string, number> | undefined): CardWin[] {
  if (cards === undefined) return [];
  return [...cards].map(([cardId, wins]) => ({ cardId, wins }));
}
