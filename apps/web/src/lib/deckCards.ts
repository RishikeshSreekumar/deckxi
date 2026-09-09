/**
 * The cards one deck holds, for /deck. A built-in deck resolves in the
 * bundle, so the grid draws on the first frame; the server is asked as well,
 * because an operator may have edited that deck or added one the client has
 * never heard of (#142), and the server's answer is what the game deals.
 */
import { useEffect, useState } from "react";
import { BUILT_IN_DECKS, deckPool, type Player } from "@deckxi/shared";
import { getEdition } from "@deckxi/ui";
import { API_URL } from "./socket.js";

function builtInCards(editionId: string, deckId: string): Player[] | null {
  const edition = getEdition(editionId);
  const deck = BUILT_IN_DECKS.find((d) => d.id === deckId);
  if (edition === null || deck === undefined) return null;
  return deckPool(edition, deck);
}

export function useDeckCards(editionId: string, deckId: string): Player[] {
  const [cards, setCards] = useState<Player[]>(() => builtInCards(editionId, deckId) ?? []);

  useEffect(() => {
    setCards(builtInCards(editionId, deckId) ?? []);
    let live = true;
    void (async () => {
      try {
        const response = await fetch(`${API_URL}/api/decks/${encodeURIComponent(deckId)}/cards`);
        if (!response.ok) return;
        const body = (await response.json()) as { cardIds: string[] };
        const edition = getEdition(editionId);
        if (!live || edition === null) return;
        const byId = new Map(edition.players.map((p) => [p.id, p]));
        setCards(
          body.cardIds.map((id) => byId.get(id)).filter((p): p is Player => p !== undefined),
        );
      } catch {
        // Offline, or no server: the built-in resolution stands.
      }
    })();
    return () => {
      live = false;
    };
  }, [editionId, deckId]);

  return cards;
}
