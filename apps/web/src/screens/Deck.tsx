/**
 * /deck — the cards, cut every way. The deck picker chooses which subset of
 * the edition you are looking at (#141), and it is the same `deckPool` the
 * server draws a game from, so the page shows exactly what that deck plays
 * with. Inside the chosen deck the toolbar cuts further: a search, the
 * edition's own role chips, the two rarity cuts, and a sort over any printed
 * stat — because a deck you are about to pick is a thing you want to read,
 * not just count.
 *
 * The deck a host picks in the lobby used to be a name and a blurb they had
 * to start a game to see the inside of; `?deck=` makes each one a page you
 * can link at, and the view controls travel in the URL with it.
 */
import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { DEFAULT_EDITION_ID, TrumpCard } from "@deckxi/ui";
import { DEFAULT_DECK_ID, type DeckId, type Edition, type Player } from "@deckxi/shared";
import { AppBar } from "../components/Chrome.js";
import { deckOf, useDecks } from "../lib/decks.js";
import { useAllEditions, useEdition } from "../lib/editions.js";
import { useDeckCards } from "../lib/deckCards.js";
import "./deck.css";

type Filter = "all" | Player["role"] | Player["rarity"];

/** Sort keys are either the two universal ones or `stat:<key>`. */
type SortKey = "deck" | "name" | "rating" | `stat:${string}`;

interface SortOption {
  key: SortKey;
  label: string;
  /** Which end of this sort reads as "best" — the default direction. */
  best: "asc" | "desc";
}

/**
 * The role chips are the edition's own roles (#143) — a cricket edition
 * offers batters and keepers, another sport offers whatever it declared —
 * followed by the two rarity cuts every edition has.
 */
function filtersFor(edition: Edition): { key: Filter; label: string }[] {
  return [
    { key: "all", label: "All" },
    ...edition.roles.map((r) => ({ key: r.id as Filter, label: r.name })),
    { key: "star", label: "Stars" },
    { key: "legend", label: "Legends" },
  ];
}

/**
 * The sorts on offer: the deck's own order, then the two things every card
 * has, then every stat the edition prints. A stat that wins low (economy)
 * defaults to ascending, so "best first" always means the top of the list.
 */
function sortsFor(edition: Edition): SortOption[] {
  return [
    { key: "deck", label: "Deck order", best: "asc" },
    { key: "name", label: "Name", best: "asc" },
    { key: "rating", label: "Rating", best: "desc" },
    ...edition.stats.map((s): SortOption => ({
      key: `stat:${s.key}`,
      label: s.name,
      best: s.direction === "lower" ? "asc" : "desc",
    })),
  ];
}

/** A chip-sized name for an edition: its series when that is short, else its sport. */
function editionLabel(edition: Edition): string {
  const label =
    edition.series !== undefined && edition.series.length <= 12 ? edition.series : edition.sport;
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** Everything about a card you could reasonably type into the search box. */
function haystack(player: Player, edition: Edition): string {
  const team = edition.teams.find((t) => t.id === player.teamId);
  const role = edition.roles.find((r) => r.id === player.role);
  return [player.name, player.nationality, team?.name, team?.shortName, role?.name]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function DeckScreen() {
  const [params, setParams] = useSearchParams();
  const edition = useEdition(params.get("edition") ?? DEFAULT_EDITION_ID);
  const editions = useAllEditions();
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("deck");
  const [order, setOrder] = useState<"asc" | "desc">("asc");
  // One card at a time turns over, so the back is a thing you can look at
  // without losing your place in the grid.
  const [flipped, setFlipped] = useState<string | null>(null);
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
    setFlipped(null);
    setParams(next, { replace: true });
  };

  /**
   * The edition is the URL too (#143). Without this the page could only ever
   * show the bundled cricket deck, and the WWE cards were reachable only by
   * typing a query string.
   */
  const selectEdition = (id: string) => {
    const next = new URLSearchParams(params);
    if (id === DEFAULT_EDITION_ID) next.delete("edition");
    else next.set("edition", id);
    // Decks belong to an edition, so the deck goes back to the default, and
    // so do the cuts — the roles and the stats are another vocabulary now.
    next.delete("deck");
    setFilter("all");
    setSort("deck");
    setOrder("asc");
    setQuery("");
    setFlipped(null);
    setParams(next, { replace: true });
  };

  const sorts = useMemo(() => (edition === null ? [] : sortsFor(edition)), [edition]);

  /** Picking a sort starts it at its own best end; the arrow flips it after. */
  const selectSort = (key: SortKey) => {
    setSort(key);
    setOrder(sorts.find((s) => s.key === key)?.best ?? "asc");
  };

  const shown = useMemo(() => {
    if (edition === null) return [];
    const needle = query.trim().toLowerCase();
    const kept = pool.filter(
      (p) =>
        (filter === "all" || p.role === filter || p.rarity === filter) &&
        (needle === "" || haystack(p, edition).includes(needle)),
    );
    if (sort === "deck") return order === "asc" ? kept : [...kept].reverse();
    const value = (p: Player): number =>
      sort === "rating" ? p.rating : (p.stats[sort.slice(5)] ?? Number.NEGATIVE_INFINITY);
    const sorted = [...kept].sort((a, b) =>
      sort === "name" ? a.name.localeCompare(b.name) : value(a) - value(b),
    );
    return order === "asc" ? sorted : sorted.reverse();
  }, [pool, edition, filter, query, sort, order]);

  if (edition === null) {
    return (
      <main className="screen deck" data-testid="deck-screen">
        <AppBar title="The decks" back />
        <p className="hint">No edition bundled in this build.</p>
      </main>
    );
  }

  const filters = filtersFor(edition);
  const dirty = filter !== "all" || query !== "" || sort !== "deck";

  return (
    <main className="screen deck" data-testid="deck-screen">
      <AppBar title="The decks" back />

      <header className="deck-hero">
        <div className="deck-hero-copy">
          <span className="label deck-eyebrow">
            {edition.name} · v{edition.version}
          </span>
          <h1 className="headline deck-title">{deck.name}</h1>
          <p className="sub deck-blurb">{deck.blurb}</p>
          <p className="sub deck-meta" data-testid="deck-count">
            <strong>{shown.length}</strong> of {pool.length} cards
            {edition.sources !== undefined && (
              <>
                {" · "}
                <Link to={`/credits?edition=${edition.id}`}>data &amp; photo credits</Link>
              </>
            )}
          </p>
        </div>
        {/* The deck itself, face down — three of the stock, fanned. */}
        <div className="deck-fan" aria-hidden="true">
          <TrumpCard editionId={edition.id} cardId={null} size="full" faceDown />
          <TrumpCard editionId={edition.id} cardId={null} size="full" faceDown />
          <TrumpCard editionId={edition.id} cardId={null} size="full" faceDown />
        </div>
      </header>

      {editions.length > 1 && (
        <div className="deck-editions" role="group" aria-label="Edition">
          {editions.map((e) => (
            <button
              key={e.id}
              type="button"
              className={`chip ${e.id === editionId ? "chip--on" : ""}`}
              aria-pressed={e.id === editionId}
              data-testid={`edition-${e.id}`}
              onClick={() => selectEdition(e.id)}
            >
              {editionLabel(e)}
            </button>
          ))}
        </div>
      )}

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

      {/* The toolbar sticks: on a long deck the cuts should still be to hand
          when you are halfway down the grid. */}
      <div className="deck-toolbar" data-testid="deck-toolbar">
        <div className="deck-search">
          <span className="deck-search-icon" aria-hidden="true">
            ⌕
          </span>
          <input
            type="search"
            className="deck-search-input"
            placeholder="Search name, team, nation"
            aria-label="Search cards"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <div className="deck-sort">
          <label className="deck-sort-label" htmlFor="deck-sort">
            Sort
          </label>
          <select
            id="deck-sort"
            className="deck-sort-select"
            value={sort}
            onChange={(e) => selectSort(e.target.value as SortKey)}
          >
            {sorts.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="chip deck-order"
            aria-label={order === "asc" ? "Sort ascending" : "Sort descending"}
            title={order === "asc" ? "Ascending" : "Descending"}
            onClick={() => setOrder(order === "asc" ? "desc" : "asc")}
          >
            <span aria-hidden="true">{order === "asc" ? "↑" : "↓"}</span>
          </button>
        </div>

        <div className="deck-filters" role="group" aria-label="Filter cards">
          {filters.map((f) => (
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
          {dirty && (
            <button
              type="button"
              className="chip deck-reset"
              onClick={() => {
                setFilter("all");
                setQuery("");
                selectSort("deck");
              }}
            >
              Reset
            </button>
          )}
        </div>
      </div>

      {shown.length === 0 ? (
        <p className="hint deck-empty">
          No cards in {deck.name} match that. Clear the search or pick another cut.
        </p>
      ) : (
        <div className="deck-grid" data-testid="deck-grid">
          {shown.map((p) => {
            const down = flipped === p.id;
            return (
              <button
                // The key carries the face, so turning a card over remounts it
                // and the flip animation runs each way.
                key={`${p.id}-${down ? "back" : "front"}`}
                type="button"
                className="deck-card"
                data-testid={`deck-card-${p.id}`}
                aria-pressed={down}
                aria-label={`${p.name} — ${down ? "show front" : "show card back"}`}
                onClick={() => setFlipped(down ? null : p.id)}
              >
                <TrumpCard editionId={edition.id} cardId={p.id} size="full" faceDown={down} />
              </button>
            );
          })}
        </div>
      )}
    </main>
  );
}
