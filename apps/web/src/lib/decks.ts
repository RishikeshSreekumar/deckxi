/**
 * The deck catalogue on the client (#142). Decks are curated by an operator
 * at runtime, so the list comes from the server — but the built-ins ship in
 * the bundle and are what every screen renders until (and if) the fetch
 * lands. A lobby that has to wait on a round-trip before it can print "All
 * Stars" is a lobby that flickers, and a failed fetch costs a name, not a
 * game: the server is the one that decides which deck is dealt.
 */
import { useEffect, useState } from "react";
import { deckPool, editionDecks, type DeckSummary } from "@deckxi/shared";
import { DEFAULT_EDITION_ID } from "@deckxi/ui";
import type { Edition } from "@deckxi/shared";
import { API_URL } from "./socket.js";
import { useEdition } from "./editions.js";

/** The edition's own decks, which is what the client renders until the fetch lands. */
function builtInCatalogue(edition: Edition | null): DeckSummary[] {
  if (edition === null) return [];
  return editionDecks(edition).map((deck) => ({
    id: deck.id,
    name: deck.name,
    blurb: deck.blurb,
    cardCount: deckPool(edition, deck).length,
    enabled: true,
  }));
}

/** One fetch per edition per page load, shared by every caller. */
const inFlight = new Map<string, Promise<DeckSummary[]>>();

export async function fetchDecks(editionId: string = DEFAULT_EDITION_ID): Promise<DeckSummary[]> {
  // Decks belong to an edition (#143): a WWE room must not be offered the
  // cricket catalogue, so the id travels with the request.
  const pending =
    inFlight.get(editionId) ??
    (async () => {
      const query = `?edition=${encodeURIComponent(editionId)}`;
      const response = await fetch(`${API_URL}/api/decks${query}`);
      if (!response.ok) throw new Error(`decks failed (${response.status})`);
      const body = (await response.json()) as { decks: DeckSummary[] };
      return body.decks;
    })().catch((error: unknown) => {
      inFlight.delete(editionId);
      throw error;
    });
  inFlight.set(editionId, pending);
  return await pending;
}

/**
 * The decks a host may pick, starting from the built-ins so the first render
 * has names in it.
 */
export function useDecks(editionId: string = DEFAULT_EDITION_ID): DeckSummary[] {
  const edition = useEdition(editionId);
  const [decks, setDecks] = useState<DeckSummary[]>(() => builtInCatalogue(edition));

  useEffect(() => {
    setDecks(builtInCatalogue(edition));
    let live = true;
    fetchDecks(editionId)
      .then((list) => {
        if (live && list.length > 0) setDecks(list);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [editionId, edition]);

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
