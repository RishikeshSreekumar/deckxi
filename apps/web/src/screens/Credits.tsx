/**
 * /credits — where the cards come from. The stats are derived from open
 * data and the photographs are reused under free licences, and both ask to
 * be credited: this page is that credit, one line per photo, plus the
 * datasets. Linked from the privacy page and the deck view.
 */
import { Link, useSearchParams } from "react-router-dom";
import { DEFAULT_EDITION_ID, getEdition } from "@deckxi/ui";
import { AppBar } from "../components/Chrome.js";

export function CreditsScreen() {
  const [params] = useSearchParams();
  const edition = getEdition(params.get("edition") ?? DEFAULT_EDITION_ID);
  const photos = (edition?.players ?? []).filter((p) => p.photo !== undefined);

  return (
    <main className="screen privacy credits" data-testid="credits-screen">
      <AppBar title="Credits" back />

      <div className="panel privacy-copy">
        <h2>Where the numbers come from</h2>
        {edition === null ? (
          <p>No edition bundled in this build.</p>
        ) : edition.sources === undefined ? (
          <p>
            <strong>{edition.name}</strong> is a fictional deck: every player and every number is
            invented.
          </p>
        ) : (
          <>
            <p>
              <strong>{edition.name}</strong> (v{edition.version}) is built from real careers. Every
              stat on a card is derived by us from the sources below and refreshed automatically;
              nothing is typed in by hand.
            </p>
            <ul className="credits-sources">
              {edition.sources.map((s) => (
                <li key={s.name}>
                  <a href={s.url} rel="noreferrer" target="_blank">
                    {s.name}
                  </a>{" "}
                  —{" "}
                  {s.licenseUrl !== undefined ? (
                    <a href={s.licenseUrl} rel="noreferrer" target="_blank">
                      {s.license}
                    </a>
                  ) : (
                    s.license
                  )}
                  {s.note !== undefined && <span className="credits-note"> · {s.note}</span>}
                </li>
              ))}
            </ul>
            <p>
              Player names and figures are factual records. Teams on the cards are national sides;
              DeckXI is not affiliated with or endorsed by any cricket board, franchise or player.
            </p>
          </>
        )}

        {photos.length > 0 && (
          <>
            <h2>Photographs</h2>
            <p>
              {photos.length} of {edition?.players.length ?? 0} cards carry a photograph from
              Wikimedia Commons, each reused under the licence its author chose. Cards without one
              show a silhouette.
            </p>
            <ul className="credits-photos">
              {photos.map((p) => (
                <li key={p.id}>
                  <strong>{p.name}</strong> —{" "}
                  <a href={p.photo?.source} rel="noreferrer" target="_blank">
                    photo
                  </a>{" "}
                  by {p.photo?.author},{" "}
                  {p.photo?.licenseUrl !== undefined ? (
                    <a href={p.photo.licenseUrl} rel="noreferrer" target="_blank">
                      {p.photo.license}
                    </a>
                  ) : (
                    p.photo?.license
                  )}
                </li>
              ))}
            </ul>
          </>
        )}

        <p>
          See also <Link to="/privacy">what we store about you</Link>.
        </p>
      </div>
    </main>
  );
}
