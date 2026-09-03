/**
 * /deck — every card in the edition, in the card design the game plays
 * with. International cards: one flat grid, no franchise grouping. Not
 * linked from the app: a place to look at the whole deck, for the people
 * making it.
 */
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { DEFAULT_EDITION_ID, TrumpCard, getEdition } from "@deckxi/ui";
import type { Player } from "@deckxi/shared";
import { AppBar } from "../components/Chrome.js";

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
  const [params] = useSearchParams();
  const edition = getEdition(params.get("edition") ?? DEFAULT_EDITION_ID);
  const [filter, setFilter] = useState<Filter>("all");

  if (edition === null) {
    return (
      <main className="screen deck" data-testid="deck-screen">
        <AppBar title="The deck" back />
        <p className="hint">No edition bundled in this build.</p>
      </main>
    );
  }

  const keep = (p: Player) => filter === "all" || p.role === filter || p.rarity === filter;
  const shown = edition.players.filter(keep);

  return (
    <main className="screen deck" data-testid="deck-screen">
      <AppBar title="The deck" back />

      <div className="deck-head">
        <div>
          <h1 className="headline">{edition.name}</h1>
          <p className="sub">
            {shown.length} of {edition.players.length} cards · v{edition.version}
            {edition.sources !== undefined && (
              <>
                {" "}
                · <Link to={`/credits?edition=${edition.id}`}>data &amp; photo credits</Link>
              </>
            )}
          </p>
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

      <div className="deck-grid" data-testid="deck-grid">
        {shown.map((p) => (
          <TrumpCard key={p.id} editionId={edition.id} cardId={p.id} size="full" />
        ))}
      </div>
    </main>
  );
}
