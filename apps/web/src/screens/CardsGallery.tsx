/**
 * /cards — the design-system gallery: every card in every size, state and
 * rarity, plus the shared theme toggle. Dev-facing (unlinked from the app
 * flow) and one of the surfaces the visual-regression screenshots run
 * against.
 */
import { DEFAULT_EDITION_ID, TrumpCard, getEdition } from "@deckxi/ui";
import type { Rarity } from "@deckxi/shared";
import { ThemeToggle } from "../components/Chrome.js";

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
        <ThemeToggle />
      </header>

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
