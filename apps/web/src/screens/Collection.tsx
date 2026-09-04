/**
 * Your collection (#84): every card that has actually taken a round for you,
 * most-won first, with one of them pinned to your profile.
 *
 * "Won with" rather than "held" is the whole idea — a card arrives here
 * because of something you did with it, so the count beside it is a small
 * record of your own play rather than a number the game handed you.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { TrumpCard, getCardInfo } from "@deckxi/ui";
import { ensureSession } from "../lib/auth.js";
import {
  fetchCollection,
  setShowcase,
  type CollectionCard,
  type ShowcaseCard,
} from "../lib/api.js";
import { AppBar } from "../components/Chrome.js";

export function CollectionScreen() {
  const [cards, setCards] = useState<CollectionCard[] | null>(null);
  const [showcase, setShowcaseCard] = useState<ShowcaseCard | null>(null);
  const [selected, setSelected] = useState<CollectionCard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void ensureSession()
      .then(fetchCollection)
      .then((data) => {
        setCards(data.cards);
        setShowcaseCard(data.showcase);
      })
      .catch(() => setError("Couldn't load your collection — is the server up?"));
  }, []);

  const pin = (card: CollectionCard) => {
    const next = { editionId: card.editionId, cardId: card.cardId };
    const previous = showcase;
    setShowcaseCard(next); // optimistic: the tap should feel immediate
    setSelected(null);
    void setShowcase(next).catch(() => {
      setShowcaseCard(previous);
      setError("Couldn't pin that card. Try again?");
    });
  };

  return (
    <main className="screen collection">
      <AppBar title="Collection" back />

      {error !== null && <p className="notice">{error}</p>}
      {error === null && cards === null && <p className="hint">Loading…</p>}

      {cards !== null && cards.length === 0 && (
        <div className="panel">
          <p className="hint">
            Nothing here yet. Win a round with a card and it joins your collection —{" "}
            <Link to="/">start a game</Link>.
          </p>
        </div>
      )}

      {cards !== null && cards.length > 0 && (
        <>
          <p className="hint">
            {cards.length} {cards.length === 1 ? "card" : "cards"} you've won rounds with. Tap one
            to put it on your profile.
          </p>
          <ul className="collection-grid" data-testid="collection">
            {cards.map((card) => {
              const isShowcase =
                showcase?.cardId === card.cardId && showcase.editionId === card.editionId;
              const { player } = getCardInfo(card.editionId, card.cardId);
              return (
                <li key={`${card.editionId}-${card.cardId}`}>
                  <button
                    type="button"
                    className={`collection-card${isShowcase ? " collection-card--pinned" : ""}`}
                    aria-pressed={isShowcase}
                    onClick={() => setSelected(card)}
                  >
                    <TrumpCard editionId={card.editionId} cardId={card.cardId} size="hand" />
                    <span className="hint">
                      {player?.name ?? card.cardId} · {card.wins}{" "}
                      {card.wins === 1 ? "round" : "rounds"}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {selected !== null && (
        <div className="panel collection-detail" data-testid="collection-detail">
          <TrumpCard editionId={selected.editionId} cardId={selected.cardId} size="reveal" />
          <p className="hint">
            First won {new Date(selected.firstWonAt).toLocaleDateString()} · {selected.wins}{" "}
            {selected.wins === 1 ? "round" : "rounds"} taken
          </p>
          <button type="button" className="button button--primary" onClick={() => pin(selected)}>
            Show this on my profile
          </button>
          <button type="button" className="button button--ghost" onClick={() => setSelected(null)}>
            Close
          </button>
        </div>
      )}
    </main>
  );
}
