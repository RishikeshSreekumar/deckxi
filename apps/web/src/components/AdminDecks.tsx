/**
 * The deck editor (#142). Curating decks is content work — it is the lever
 * that keeps the game fresh between quarterly editions — so it lives behind
 * the admin auth that is already here rather than behind a code change, a
 * build and a deploy.
 *
 * Two ways to define a deck, and the editor shows which one is in force: a
 * **filter** (roles and rarities over the pinned edition, what the built-ins
 * are) or an **explicit list** of card ids, which wins when it is present.
 * Every write is validated whole on the server — a deck too small to seat a
 * table comes back refused, with the count, rather than as a room that will
 * not start.
 */
import { useEffect, useState } from "react";
import { raritySchema } from "@deckxi/shared";
import { DEFAULT_EDITION_ID, getEdition } from "@deckxi/ui";
import {
  createAdminDeck,
  deleteAdminDeck,
  fetchAdminDecks,
  patchAdminDeck,
  setAdminDeckCards,
  type AdminDeck,
  type DeckWriteResult,
} from "../lib/admin.js";

/**
 * The role filter offers the edition's own roles (#143), not a compiled-in
 * cricket enum — an edition of another sport lists its own words here.
 */
const ROLES = (getEdition(DEFAULT_EDITION_ID)?.roles ?? []).map((r) => r.id);
const RARITIES = raritySchema.options;

function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export function AdminDecks() {
  const [decks, setDecks] = useState<AdminDeck[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [blurb, setBlurb] = useState("");
  const [cards, setCards] = useState("");

  const reload = (): void => {
    fetchAdminDecks()
      .then(({ decks: list }) => setDecks(list))
      .catch(() => setDecks(null));
  };

  useEffect(reload, []);

  /** Every write answers with the catalogue, or with why it was refused. */
  const write = (run: () => Promise<DeckWriteResult>): void => {
    setBusy(true);
    setError(null);
    run()
      .then((result) => {
        if (result.ok) setDecks(result.decks ?? null);
        else setError(result.error ?? "refused");
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "failed"))
      .finally(() => setBusy(false));
  };

  const startEdit = (deck: AdminDeck): void => {
    setEditing(deck.id);
    setName(deck.name);
    setBlurb(deck.blurb);
    setCards((deck.cardIds ?? []).join("\n"));
  };

  const toggleIn = (list: string[] | undefined, value: string): string[] | null => {
    const current = list ?? [];
    const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
    // Empty means "no filter", which the API says with null.
    return next.length === 0 ? null : next;
  };

  return (
    <section className="panel admin-ops" data-testid="admin-decks">
      <h3 className="admin-feed-title">Decks</h3>

      {error !== null && (
        <p className="hint" role="status" data-testid="deck-error">
          Refused: {error}
        </p>
      )}

      <ul className="match-list">
        {(decks ?? []).map((deck) => (
          <li key={deck.id} className="panel match-row" data-testid={`admin-deck-${deck.id}`}>
            <div className="match-detail">
              <strong>
                {deck.name} <span className="hint">{deck.id}</span>
              </strong>
              <span className="hint">
                {deck.cardCount} cards ·{" "}
                {deck.cardIds !== undefined
                  ? `${deck.cardIds.length} hand-picked`
                  : [
                      deck.roles?.join("/") ?? "every role",
                      deck.rarities?.join("/") ?? "every rarity",
                    ].join(" · ")}
                {deck.enabled ? "" : " · retired"}
              </span>

              {editing === deck.id ? (
                <>
                  <label className="admin-field">
                    <span className="hint">Name</span>
                    <input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
                  </label>
                  <label className="admin-field">
                    <span className="hint">Blurb — the line a host reads in the lobby</span>
                    <input
                      value={blurb}
                      maxLength={160}
                      onChange={(e) => setBlurb(e.target.value)}
                    />
                  </label>

                  <div className="admin-modes">
                    {ROLES.map((role) => (
                      <button
                        key={role}
                        type="button"
                        className={`button button--sm ${deck.roles?.includes(role) === true ? "" : "button--ghost"}`}
                        disabled={busy}
                        onClick={() =>
                          write(() =>
                            patchAdminDeck(deck.id, { roles: toggleIn(deck.roles, role) }),
                          )
                        }
                      >
                        {role}
                      </button>
                    ))}
                    {RARITIES.map((rarity) => (
                      <button
                        key={rarity}
                        type="button"
                        className={`button button--sm ${deck.rarities?.includes(rarity) === true ? "" : "button--ghost"}`}
                        disabled={busy}
                        onClick={() =>
                          write(() =>
                            patchAdminDeck(deck.id, { rarities: toggleIn(deck.rarities, rarity) }),
                          )
                        }
                      >
                        {rarity}
                      </button>
                    ))}
                  </div>

                  <label className="admin-field">
                    <span className="hint">
                      Card ids, one per line. Any list at all overrides the filters above; empty
                      hands the deck back to them.
                    </span>
                    <textarea
                      value={cards}
                      rows={4}
                      data-testid={`deck-cards-${deck.id}`}
                      onChange={(e) => setCards(e.target.value)}
                    />
                  </label>

                  <div className="update-bar-actions">
                    <button
                      type="button"
                      className="button button--primary button--sm"
                      disabled={busy}
                      onClick={() => {
                        const ids = cards
                          .split(/\s+/)
                          .map((id) => id.trim())
                          .filter((id) => id.length > 0);
                        write(async () => {
                          const saved = await patchAdminDeck(deck.id, {
                            name: name.trim(),
                            blurb: blurb.trim(),
                          });
                          if (!saved.ok) return saved;
                          return setAdminDeckCards(deck.id, ids.length > 0 ? ids : null);
                        });
                        setEditing(null);
                      }}
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      className="button button--ghost button--sm"
                      onClick={() => setEditing(null)}
                    >
                      Cancel
                    </button>
                  </div>
                </>
              ) : (
                <div className="update-bar-actions">
                  <button
                    type="button"
                    className="button button--sm"
                    disabled={busy}
                    onClick={() => startEdit(deck)}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="button button--sm"
                    disabled={busy}
                    onClick={() => write(() => patchAdminDeck(deck.id, { enabled: !deck.enabled }))}
                  >
                    {deck.enabled ? "Retire" : "Offer"}
                  </button>
                  <button
                    type="button"
                    className="button button--sm button--danger"
                    disabled={busy}
                    onClick={() => write(() => deleteAdminDeck(deck.id))}
                  >
                    Delete
                  </button>
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>

      <div className="update-bar-actions">
        <input
          type="text"
          placeholder="New deck name"
          data-testid="new-deck-name"
          value={editing === null ? name : ""}
          disabled={editing !== null}
          onChange={(e) => setName(e.target.value)}
        />
        <button
          type="button"
          className="button button--primary button--sm"
          data-testid="new-deck"
          disabled={busy || editing !== null || name.trim().length === 0}
          onClick={() => {
            const id = slug(name);
            write(() =>
              createAdminDeck({
                id,
                name: name.trim(),
                blurb: "A new deck. Say what is in it.",
              }),
            );
            setName("");
          }}
        >
          Add deck
        </button>
      </div>

      <p className="hint" style={{ margin: 0 }}>
        A retired deck stays here but no host can pick it. Editing a deck never touches a game
        already running — the cards are drawn and recorded when the game starts.
      </p>
    </section>
  );
}
