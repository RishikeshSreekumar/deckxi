/**
 * The trump card renderer (design 10 — shirt number, light table). A printed
 * piece: cream stock with an ink outline and drop; the top two thirds are
 * the player's photo, bled to the edges, with the shirt number in an ink
 * square in one corner and the nation's flag in the other, and the name in
 * an ink band printed over the photo's foot; under it, on the cream, a
 * table carries the stats in two headed columns — BATTING on the left,
 * BOWLING on the right — each row a label, a dotted leader and a number.
 * International cards: the nation is the only affiliation printed on them,
 * and rarity is not printed at all — every card is the same piece of stock.
 * A card whose shirt number is not on record prints the rating in the
 * square, with the role glyph under it, so the corner is never blank.
 *
 * Stats are gameplay, not decoration: with `onSelectStat` every row is a
 * button, and the called stat inverts to the table's green.
 *
 * Data-driven from the edition dataset; unknown cards render a graceful
 * fallback. A card whose player carries a licensed photo prints it full
 * bleed; without one the photo area is the striped stock with the role
 * silhouette in the team's colour. Photo credits are listed on /credits.
 */
import { roleName, type StatGroup } from "@deckxi/shared";
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
  /** Stats that may not be picked right now (power trumps: last round's call). */
  disabledStats?: readonly string[];
  outcome?: "winner" | "loser" | undefined;
  /**
   * Stat values to print instead of the edition's — the game passes the
   * engine's own numbers so the card and the result can never disagree.
   */
  stats?: Record<string, number> | undefined;
}

/** The card has two columns; an edition that names neither gets these. */
const UNNAMED_GROUPS: StatGroup[] = [
  { id: "left", name: "" },
  { id: "right", name: "" },
];

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
  // The WWE edition's nationalities (#143); anything else still gets initials.
  "United States": "🇺🇸",
  Canada: "🇨🇦",
  Mexico: "🇲🇽",
  Japan: "🇯🇵",
  France: "🇫🇷",
  Italy: "🇮🇹",
  Germany: "🇩🇪",
  Austria: "🇦🇹",
  Nigeria: "🇳🇬",
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
  disabledStats,
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
  const stats = edition?.stats ?? [];

  // The columns are the edition's (#143): a cricket card prints batting and
  // bowling, another sport prints its own two. A stat that names no group
  // falls to whichever column is shorter, which is what an edition that
  // declares no groups at all gets for every stat.
  const groups = edition?.statGroups ?? UNNAMED_GROUPS;
  const [left, right] = [groups[0] ?? UNNAMED_GROUPS[0], groups[1] ?? UNNAMED_GROUPS[1]] as [
    StatGroup,
    StatGroup,
  ];
  const columns: { left: typeof stats; right: typeof stats } = { left: [], right: [] };
  for (const def of stats) {
    const named = def.group === left.id ? "left" : def.group === right.id ? "right" : undefined;
    columns[named ?? (columns.left.length <= columns.right.length ? "left" : "right")].push(def);
  }

  const classes = [
    "card",
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
    const disabled = disabledStats?.includes(def.key) ?? false;
    const label = def.short ?? statName(editionId, def.key);
    // Lower-wins is the exception on a cricket card (economy), and the one
    // rule nobody guessed at the playtest: the row says so with an arrow.
    const lower = def.direction === "lower";
    const row = (
      <>
        <span
          className="stat-name"
          title={`${statName(editionId, def.key)} — ${lower ? "lower" : "higher"} wins`}
        >
          {label}
          {lower && (
            <span className="stat-dir" aria-hidden="true">
              ↓
            </span>
          )}
        </span>
        <span className="stat-leader" aria-hidden="true" />
        <span className="stat-value">{display}</span>
      </>
    );
    return (
      <li
        key={def.key}
        className={[
          "stat-row",
          highlighted ? "stat-row--hot" : "",
          disabled ? "stat-row--spent" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {onSelectStat !== undefined ? (
          <button
            type="button"
            className="stat-button"
            data-stat={def.key}
            disabled={disabled}
            aria-label={`${statName(editionId, def.key)}${disabled ? " (burned)" : ""} ${display}${lower ? ", lower wins" : ""}`}
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
          <div
            className={player?.photo === undefined ? "card-photo" : "card-photo card-photo--real"}
            aria-hidden="true"
          >
            {player !== null && player.photo === undefined && <RolePortrait role={player.role} />}
            {player?.photo !== undefined && (
              <img
                className="card-photo-img"
                src={player.photo.src}
                alt=""
                loading="lazy"
                decoding="async"
                draggable={false}
              />
            )}
            {player !== null && player.jerseyNumber !== undefined && (
              <span
                className="card-jersey"
                title={`${roleName(edition, player.role)} · shirt ${player.jerseyNumber}`}
              >
                <span className="card-jersey-number">{player.jerseyNumber}</span>
              </span>
            )}
            {player !== null && player.jerseyNumber === undefined && (
              <span
                className="card-jersey card-jersey--rating"
                title={`${roleName(edition, player.role)} · rating ${Math.round(player.rating)}`}
              >
                <span className="card-jersey-number">{Math.round(player.rating)}</span>
                <RoleIcon role={player.role} />
              </span>
            )}
            {player !== null && (
              <span className={`card-flag ${flag === undefined ? "card-flag--text" : ""}`}>
                {flag ?? initials(player.nationality)}
              </span>
            )}
          </div>

          <header className="card-band">
            <span className="card-name">{player?.name ?? cardId}</span>
          </header>
        </div>

        <div className="card-table">
          <div className="card-column">
            <span className="card-column-head">
              <span className="card-column-icon card-column-icon--bat" aria-hidden="true">
                <RoleIcon role={left.icon ?? left.id} />
              </span>
              {left.name}
            </span>
            <ul className="card-stats">{columns.left.map(renderRow)}</ul>
          </div>
          <div className="card-column">
            <span className="card-column-head">
              <span className="card-column-icon card-column-icon--ball" aria-hidden="true">
                <RoleIcon role={right.icon ?? right.id} />
              </span>
              {right.name}
            </span>
            <ul className="card-stats">{columns.right.map(renderRow)}</ul>
          </div>
        </div>
      </div>
    </div>
  );
}
