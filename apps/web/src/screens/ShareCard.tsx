/**
 * /cards/share/:cardId — a fixed 1200×630 og-image composition of one card,
 * rendered by the same TrumpCard as the game so exports never drift. The
 * export pipeline screenshots this route; it is not linked from the app.
 */
import { useParams } from "react-router-dom";
import { DEFAULT_EDITION_ID, TrumpCard, getCardInfo, getEdition } from "@deckxi/ui";

export function ShareCardScreen() {
  const { cardId } = useParams();
  const edition = getEdition(DEFAULT_EDITION_ID);
  const { player, team } = getCardInfo(DEFAULT_EDITION_ID, cardId ?? "");

  return (
    <div className="share-frame" data-testid="share-frame">
      <div
        className="share-glow"
        style={{ "--team-color": team?.color ?? "#3b4a6b" } as React.CSSProperties}
      />
      <div className="share-card">
        <TrumpCard editionId={DEFAULT_EDITION_ID} cardId={cardId ?? null} size="full" />
      </div>
      <div className="share-copy">
        <h1 className="brand">
          Deck<span className="brand-xi">XI</span>
        </h1>
        {player !== null ? (
          <>
            <p className="share-player">{player.name}</p>
            <p className="share-team">
              {team?.name ?? ""} · {edition?.name ?? ""}
            </p>
          </>
        ) : (
          <p className="share-team">Cricket trump cards, live with friends.</p>
        )}
        <p className="share-cta">Play a hand at deckxi</p>
      </div>
    </div>
  );
}
