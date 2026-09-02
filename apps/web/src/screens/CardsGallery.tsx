/**
 * /cards — the design-system gallery: the component kit's full state matrix,
 * then every card in every size, state and rarity. Dev-facing (unlinked from
 * the app flow) and the surface most of the visual-regression screenshots run
 * against.
 *
 * The kit section exists so a restyle of the buttons, the timer ring or the
 * room code is reviewable as a pixel diff. Before it, /cards exercised the
 * card renderer and nothing else, and a button regression was invisible.
 */
import { DEFAULT_EDITION_ID, RoomCode, TimerRing, TrumpCard, getEdition } from "@deckxi/ui";
import type { Rarity } from "@deckxi/shared";

/** A fixed deadline so the timer ring's arc is the same in every screenshot. */
const FROZEN_TIMER = { deadline: 0, seconds: 20 };

function KitSection() {
  const variants = ["", "button--primary", "button--secondary", "button--ghost", "button--danger"];
  return (
    <section className="panel gallery-section" data-testid="gallery-kit">
      <h2>Component kit</h2>

      <div className="gallery-row">
        {variants.map((variant) => (
          <figure key={variant || "default"} className="gallery-item">
            <button type="button" className={`button ${variant}`}>
              Play on
            </button>
            <figcaption>{variant.replace("button--", "") || "default"}</figcaption>
          </figure>
        ))}
      </div>

      <div className="gallery-row">
        <figure className="gallery-item">
          <button type="button" className="button" disabled>
            Disabled
          </button>
          <figcaption>disabled</figcaption>
        </figure>
        <figure className="gallery-item">
          <button type="button" className="button button--primary button--loading">
            Loading
          </button>
          <figcaption>loading</figcaption>
        </figure>
        <figure className="gallery-item">
          <button type="button" className="button button--sm">
            Compact
          </button>
          <figcaption>small</figcaption>
        </figure>
        <figure className="gallery-item">
          <button type="button" className="icon-button" aria-label="Icon button">
            🔊
          </button>
          <figcaption>icon</figcaption>
        </figure>
      </div>

      <div className="gallery-row">
        <figure className="gallery-item">
          <RoomCode code="TRUMP7" />
          <figcaption>room code</figcaption>
        </figure>
        <figure className="gallery-item">
          <TimerRing {...FROZEN_TIMER} />
          <figcaption>timer ring</figcaption>
        </figure>
        <figure className="gallery-item">
          <span className="round-chip">Round 4</span>
          <figcaption>round chip</figcaption>
        </figure>
        <figure className="gallery-item">
          <span>
            Player<span className="tag">host</span>
            <span className="tag tag--you">you</span>
            <span className="tag tag--away">away</span>
          </span>
          <figcaption>tags</figcaption>
        </figure>
      </div>

      <div className="gallery-row">
        <figure className="gallery-item">
          <span className="toast">Copied the invite link.</span>
          <figcaption>toast</figcaption>
        </figure>
        <figure className="gallery-item">
          <span className="toast toast--error">That room doesn&apos;t exist.</span>
          <figcaption>toast — error</figcaption>
        </figure>
      </div>

      <div className="gallery-row">
        <figure className="gallery-item">
          <p className="notice">The host left — this room is closing.</p>
          <figcaption>notice</figcaption>
        </figure>
        <figure className="gallery-item">
          <label className="field">
            <span>Your name</span>
            <input defaultValue="CoverDrive" readOnly />
          </label>
          <figcaption>field</figcaption>
        </figure>
      </div>
    </section>
  );
}

export function CardsGalleryScreen() {
  const edition = getEdition(DEFAULT_EDITION_ID);
  if (edition === null) return <main className="screen">Unknown edition.</main>;

  const byRarity = (rarity: Rarity) => edition.players.find((p) => p.rarity === rarity);
  const sample = byRarity("regular") ?? edition.players[0];
  const firstStat = edition.stats[0]?.key ?? "";
  if (sample === undefined) return <main className="screen">Empty edition.</main>;

  return (
    <main className="screen gallery" data-testid="cards-gallery">
      <header className="screen-head">
        <h1 className="brand brand--small">
          Deck<span className="brand-xi">XI</span> cards — {edition.name}
        </h1>
      </header>

      <KitSection />

      <section className="panel gallery-section" data-testid="gallery-states">
        <h2>Sizes &amp; states</h2>
        <div className="gallery-row">
          {(["hand", "reveal", "full"] as const).map((size) => (
            <figure key={size} className="gallery-item">
              <TrumpCard editionId={edition.id} cardId={sample.id} size={size} />
              <figcaption>{size}</figcaption>
            </figure>
          ))}
          <figure className="gallery-item">
            <TrumpCard editionId={edition.id} cardId={sample.id} size="reveal" faceDown />
            <figcaption>face-down</figcaption>
          </figure>
        </div>
        <div className="gallery-row">
          <figure className="gallery-item">
            <TrumpCard
              editionId={edition.id}
              cardId={sample.id}
              size="full"
              onSelectStat={() => undefined}
            />
            <figcaption>selectable</figcaption>
          </figure>
          <figure className="gallery-item">
            <TrumpCard
              editionId={edition.id}
              cardId={sample.id}
              size="full"
              onSelectStat={() => undefined}
              pendingStat={firstStat}
            />
            <figcaption>stat pending</figcaption>
          </figure>
          <figure className="gallery-item">
            <TrumpCard
              editionId={edition.id}
              cardId={sample.id}
              size="reveal"
              highlightStat={firstStat}
              outcome="winner"
            />
            <figcaption>winner</figcaption>
          </figure>
          <figure className="gallery-item">
            <TrumpCard
              editionId={edition.id}
              cardId={sample.id}
              size="reveal"
              highlightStat={firstStat}
              outcome="loser"
            />
            <figcaption>loser</figcaption>
          </figure>
        </div>
      </section>

      <section className="panel gallery-section" data-testid="gallery-rarities">
        <h2>Rarities</h2>
        <div className="gallery-row">
          {(["regular", "star", "legend"] as const).map((rarity) => {
            const player = byRarity(rarity);
            return player === undefined ? null : (
              <figure key={rarity} className="gallery-item">
                <TrumpCard editionId={edition.id} cardId={player.id} size="reveal" />
                <figcaption>{rarity}</figcaption>
              </figure>
            );
          })}
        </div>
      </section>

      <section className="panel gallery-section" data-testid="gallery-all">
        <h2>All {edition.players.length} cards</h2>
        <div className="gallery-grid">
          {edition.players.map((p) => (
            <TrumpCard key={p.id} editionId={edition.id} cardId={p.id} size="hand" />
          ))}
        </div>
      </section>
    </main>
  );
}
