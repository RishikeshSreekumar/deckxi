/**
 * /deck — the cards, cut two ways. The deck picker chooses which subset of
 * the edition you are looking at (#141), and it is the same `deckPool` the
 * server draws a game from, so the page shows exactly what that deck plays
 * with. The role and rarity filters then cut inside the chosen deck.
 *
 * The deck a host picks in the lobby used to be a name and a blurb they had
 * to start a game to see the inside of; `?deck=` makes each one a page you
 * can link at.
 */
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { DEFAULT_EDITION_ID, TrumpCard, getEdition } from "@deckxi/ui";
import { DEFAULT_DECK_ID, type DeckId, type Player } from "@deckxi/shared";
import { AppBar } from "../components/Chrome.js";
import { deckOf, useDecks } from "../lib/decks.js";
import { useDeckCards } from "../lib/deckCards.js";

type Filter = "all" | Player["role"] | Player["rarity"];

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "batter", label: "Batters" },
  { key: "bowler", label: "Bowlers" },
  { key: "all-rounder", label: "All-rounders" },
  { key: "keeper", label: "Keepers" },
  { key: "star", label: "Stars" },
  { key: "legend", label: "Legends" },
];

export function DeckScreen() {
  const [params, setParams] = useSearchParams();
  const edition = getEdition(params.get("edition") ?? DEFAULT_EDITION_ID);
  const [filter, setFilter] = useState<Filter>("all");
  const editionId = edition?.id ?? DEFAULT_EDITION_ID;
  const decks = useDecks(editionId);
  const deckId: DeckId = params.get("deck") ?? DEFAULT_DECK_ID;
  const deck = deckOf(decks, deckId);
  const pool = useDeckCards(editionId, deckId);

  // The deck is the URL, not component state: a deck you are looking at is a
  // thing to send someone.
  const selectDeck = (id: DeckId) => {
    const next = new URLSearchParams(params);
    if (id === DEFAULT_DECK_ID) next.delete("deck");
    else next.set("deck", id);
    setParams(next, { replace: true });
  };

  if (edition === null) {
    return (
      <main className="screen deck" data-testid="deck-screen">
        <AppBar title="The decks" back />
        <p className="hint">No edition bundled in this build.</p>
      </main>
    );
  }

  const keep = (p: Player) => filter === "all" || p.role === filter || p.rarity === filter;
  const shown = pool.filter(keep);

  return (
    <main className="screen deck" data-testid="deck-screen">
      <AppBar title="The decks" back />

      <div className="deck-head">
        <div>
          <h1 className="headline">{deck.name}</h1>
          <p className="sub" data-testid="deck-count">
            {shown.length} of {pool.length} cards · {edition.name} v{edition.version}
            {edition.sources !== undefined && (
              <>
                {" "}
                · <Link to={`/credits?edition=${edition.id}`}>data &amp; photo credits</Link>
              </>
            )}
          </p>
          <p className="sub">{deck.blurb}</p>
        </div>
        <div className="deck-filters" role="group" aria-label="Filter cards">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              className={`chip ${filter === f.key ? "chip--on" : ""}`}
              aria-pressed={filter === f.key}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="deck-picker deck-picker--page" role="radiogroup" aria-label="Deck">
        {decks.map((d) => {
          const on = d.id === deckId;
          return (
            <button
              key={d.id}
              type="button"
              role="radio"
              aria-checked={on}
              className={on ? "mode-option mode-option--on" : "mode-option"}
              data-testid={`deck-${d.id}`}
              onClick={() => selectDeck(d.id)}
            >
              <strong>{d.name}</strong>
              <span className="sub">{d.blurb}</span>
              {d.cardCount > 0 && <span className="sub mode-seats">{d.cardCount} cards</span>}
            </button>
          );
        })}
      </div>

      <div className="deck-grid" data-testid="deck-grid">
        {shown.map((p) => (
          <TrumpCard key={p.id} editionId={edition.id} cardId={p.id} size="full" />
        ))}
      </div>
    </main>
  );
}
