/**
 * The deck catalogue on the client (#142). Decks are curated by an operator
 * at runtime, so the list comes from the server — but the built-ins ship in
 * the bundle and are what every screen renders until (and if) the fetch
 * lands. A lobby that has to wait on a round-trip before it can print "All
 * Stars" is a lobby that flickers, and a failed fetch costs a name, not a
 * game: the server is the one that decides which deck is dealt.
 */
import { useEffect, useState } from "react";
import { BUILT_IN_DECKS, deckPool, type DeckSummary } from "@deckxi/shared";
import { getEdition, DEFAULT_EDITION_ID } from "@deckxi/ui";
import { API_URL } from "./socket.js";

function builtInCatalogue(editionId: string): DeckSummary[] {
  const edition = getEdition(editionId) ?? getEdition(DEFAULT_EDITION_ID);
  return BUILT_IN_DECKS.map((deck) => ({
    id: deck.id,
    name: deck.name,
    blurb: deck.blurb,
    cardCount: edition === null ? 0 : deckPool(edition, deck).length,
    enabled: true,
  }));
}

/** One fetch per page load, shared by every caller. */
let inFlight: Promise<DeckSummary[]> | null = null;

export async function fetchDecks(): Promise<DeckSummary[]> {
  inFlight ??= (async () => {
    const response = await fetch(`${API_URL}/api/decks`);
    if (!response.ok) throw new Error(`decks failed (${response.status})`);
    const body = (await response.json()) as { decks: DeckSummary[] };
    return body.decks;
  })().catch((error: unknown) => {
    inFlight = null;
    throw error;
  });
  return inFlight;
}

/**
 * The decks a host may pick, starting from the built-ins so the first render
 * has names in it.
 */
export function useDecks(editionId: string = DEFAULT_EDITION_ID): DeckSummary[] {
  const [decks, setDecks] = useState<DeckSummary[]>(() => builtInCatalogue(editionId));

  useEffect(() => {
    let live = true;
    fetchDecks()
      .then((list) => {
        if (live && list.length > 0) setDecks(list);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  return decks;
}

/** The catalogue entry for one id, or a stand-in carrying the id itself. */
export function deckOf(decks: readonly DeckSummary[], id: string): DeckSummary {
  return (
    decks.find((deck) => deck.id === id) ?? {
      id,
      name: id,
      blurb: "",
      cardCount: 0,
      enabled: true,
    }
  );
}
