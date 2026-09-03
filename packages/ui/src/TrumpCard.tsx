/**
 * The trump card renderer (design 9b — full-bleed photo, icons instead of
 * headings). A printed piece: cream stock with an ink outline and drop; the
 * top two thirds are the player's photo, bled to the edges, with a rating
 * roundel in one corner and the nation's flag in the other, and the name in
 * an ink band printed over the photo's foot; under it an ink table carries
 * the stats in two columns — bat on the left, ball on the right — each a
 * label, a dotted leader and a number. International cards: the nation is
 * the only affiliation printed on them.
 *
 * Stats are gameplay, not decoration: with `onSelectStat` every row is a
 * button, and the called stat inverts to the table's green.
 *
 * Data-driven from the edition dataset; unknown cards render a graceful
 * fallback. There are no player photos yet, so the photo area is the striped
 * stock with the role silhouette in the team's colour.
 */
import { getCardInfo, getEdition, formatStatValue, statName } from "./editions.js";
import { CardBackArt, RoleIcon, RolePortrait } from "./cardArt.js";

export type CardSize = "hand" | "reveal" | "full";

export interface TrumpCardProps {
  editionId: string;
  cardId: string | null;
  size?: CardSize;
  faceDown?: boolean;
  /** Stat key to highlight (the round's pick). */
  highlightStat?: string;
  /** When set, stat rows become buttons — the leader picking their stat. */
  onSelectStat?: (stat: string) => void;
  /** Optimistically selected stat awaiting the server. */
  pendingStat?: string;
  outcome?: "winner" | "loser" | undefined;
  /**
   * Stat values to print instead of the edition's — the game passes the
   * engine's own numbers so the card and the result can never disagree.
   */
  stats?: Record<string, number> | undefined;
}

const ROLE_LABELS: Record<string, string> = {
  batter: "Batter",
  bowler: "Bowler",
  "all-rounder": "All-rounder",
  keeper: "Keeper",
};

/**
 * Which column a stat prints in, and the short label the table uses. The
 * left column is the bat, the right the ball (and the gloves). Stats the
 * table has never heard of fall to whichever column is shorter, labelled by
 * their edition name.
 */
const STAT_LAYOUT: Record<string, { column: "bat" | "ball"; label: string }> = {
  battingAvg: { column: "bat", label: "Avg." },
  strikeRate: { column: "bat", label: "S/R" },
  runs: { column: "bat", label: "Runs" },
  highest: { column: "bat", label: "High" },
  matches: { column: "bat", label: "Match" },
  wickets: { column: "ball", label: "Wkt." },
  economy: { column: "ball", label: "Econ." },
  overs: { column: "ball", label: "Overs" },
  catches: { column: "ball", label: "Ct." },
};

/** Flag emoji by nationality; anything unlisted gets its initials instead. */
const FLAGS: Record<string, string> = {
  India: "🇮🇳",
  Australia: "🇦🇺",
  England: "🏴󠁧󠁢󠁥󠁮󠁧󠁿",
  "New Zealand": "🇳🇿",
  Pakistan: "🇵🇰",
  "South Africa": "🇿🇦",
  "Sri Lanka": "🇱🇰",
  Bangladesh: "🇧🇩",
  Afghanistan: "🇦🇫",
  Ireland: "🇮🇪",
  Zimbabwe: "🇿🇼",
  Netherlands: "🇳🇱",
  Scotland: "🏴󠁧󠁢󠁳󠁣󠁴󠁿",
  Nepal: "🇳🇵",
};

function initials(nation: string): string {
  return nation
    .split(/\s+/)
    .map((w) => w[0] ?? "")
    .join("")
    .slice(0, 3)
    .toUpperCase();
}

export function TrumpCard({
  editionId,
  cardId,
  size = "hand",
  faceDown = false,
  highlightStat,
  onSelectStat,
  pendingStat,
  outcome,
  stats: statOverride,
}: TrumpCardProps) {
  if (faceDown || cardId === null) {
    return (
      <div className={`card-scale card-scale--${size}`}>
        <div className="card card--back">
          <CardBackArt />
        </div>
      </div>
    );
  }

  const { player, team } = getCardInfo(editionId, cardId);
  const edition = getEdition(editionId);
  // Fallback matches the --team-color role's dark default (night-600) for cards
  // whose team is missing from the edition.
  const color = team?.color ?? "#1d4137";
  const rarity = player?.rarity ?? "regular";
  const stats = edition?.stats ?? [];

  const columns: { bat: typeof stats; ball: typeof stats } = { bat: [], ball: [] };
  for (const def of stats) {
    const layout = STAT_LAYOUT[def.key];
    const column = layout?.column ?? (columns.bat.length <= columns.ball.length ? "bat" : "ball");
    columns[column].push(def);
  }

  const classes = [
    "card",
    `card--${rarity}`,
    outcome === "winner" ? "card--winner" : "",
    outcome === "loser" ? "card--loser" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const flag = player === null ? null : FLAGS[player.nationality];

  const renderRow = (def: (typeof stats)[number]) => {
    const value = statOverride?.[def.key] ?? player?.stats[def.key];
    const display = value === undefined ? "—" : formatStatValue(editionId, def.key, value);
    const highlighted = highlightStat === def.key || pendingStat === def.key;
    const label = STAT_LAYOUT[def.key]?.label ?? statName(editionId, def.key);
    const row = (
      <>
        <span className="stat-name" title={statName(editionId, def.key)}>
          {label}
        </span>
        <span className="stat-leader" aria-hidden="true" />
        <span className="stat-value">{display}</span>
      </>
    );
    return (
      <li key={def.key} className={highlighted ? "stat-row stat-row--hot" : "stat-row"}>
        {onSelectStat !== undefined ? (
          <button
            type="button"
            className="stat-button"
            data-stat={def.key}
            aria-label={`${statName(editionId, def.key)} ${display}`}
            onClick={() => onSelectStat(def.key)}
          >
            {row}
          </button>
        ) : (
          <div className="stat-static">{row}</div>
        )}
      </li>
    );
  };

  return (
    <div className={`card-scale card-scale--${size}`}>
      <div className={classes} style={{ "--team-color": color } as React.CSSProperties}>
        <div className="card-frame" aria-hidden="true" />

        <div className="card-top">
          <div className="card-photo" aria-hidden="true">
            {player !== null && <RolePortrait role={player.role} />}
            {player !== null && (
              <span
                className="card-roundel"
                title={`${ROLE_LABELS[player.role] ?? player.role} · rating ${Math.round(player.rating)}`}
              >
                <span className="card-roundel-rating">{Math.round(player.rating)}</span>
                <RoleIcon role={player.role} />
              </span>
            )}
            {player !== null && (
              <span className={`card-flag ${flag === undefined ? "card-flag--text" : ""}`}>
                {flag ?? initials(player.nationality)}
              </span>
            )}
            {rarity !== "regular" && (
              <span className={`card-rarity card-rarity--${rarity}`}>
                {rarity === "legend" ? "★" : "✦"}
              </span>
            )}
          </div>

          <header className="card-band">
            <span className="card-name">{player?.name ?? cardId}</span>
            {player !== null && <span className="card-nation">{player.nationality}</span>}
          </header>
        </div>

        <div className="card-table">
          <div className="card-column">
            <span className="card-column-icon card-column-icon--bat" aria-label="Batting">
              <RoleIcon role="batter" />
            </span>
            <ul className="card-stats">{columns.bat.map(renderRow)}</ul>
          </div>
          <div className="card-column">
            <span className="card-column-icon card-column-icon--ball" aria-label="Bowling">
              <RoleIcon role="bowler" />
            </span>
            <ul className="card-stats">{columns.ball.map(renderRow)}</ul>
          </div>
        </div>
      </div>
    </div>
  );
}
