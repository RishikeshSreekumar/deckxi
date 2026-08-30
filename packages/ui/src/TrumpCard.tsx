/**
 * The trump card renderer — a premium physical object: team-colored frame
 * with a beveled inner layer, role portrait silhouette, shield rating badge,
 * rarity foils, and a big legible stat table (stats are gameplay, not
 * decoration) with value meters normalized from the edition's stat bounds.
 * Data-driven from the edition dataset; unknown cards render a graceful
 * fallback.
 */
import { getCardInfo, getEdition, formatStatValue, statName } from "./editions.js";
import { CardBackArt, RatingShield, RoleIcon, RolePortrait } from "./cardArt.js";

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
}

const ROLE_LABELS: Record<string, string> = {
  batter: "Batter",
  bowler: "Bowler",
  "all-rounder": "All-rounder",
  keeper: "Keeper",
};

export function TrumpCard({
  editionId,
  cardId,
  size = "hand",
  faceDown = false,
  highlightStat,
  onSelectStat,
  pendingStat,
  outcome,
}: TrumpCardProps) {
  if (faceDown || cardId === null) {
    return (
      <div className={`card card--${size} card--back`}>
        <CardBackArt />
      </div>
    );
  }

  const { player, team } = getCardInfo(editionId, cardId);
  const edition = getEdition(editionId);
  const color = team?.color ?? "#3b4a6b";
  const rarity = player?.rarity ?? "regular";
  const stats = edition?.stats ?? [];

  const classes = [
    "card",
    `card--${size}`,
    `card--${rarity}`,
    outcome === "winner" ? "card--winner" : "",
    outcome === "loser" ? "card--loser" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes} style={{ "--team-color": color } as React.CSSProperties}>
      <div className="card-frame" aria-hidden="true" />
      <header className="card-head">
        {player !== null && <RolePortrait role={player.role} />}
        <span className="card-name">{player?.name ?? cardId}</span>
        <span className="card-meta">
          {team?.shortName ?? "?"}
          {player !== null && (
            <>
              {" · "}
              <RoleIcon role={player.role} />
              {size !== "hand" && (ROLE_LABELS[player.role] ?? player.role)}
            </>
          )}
          {rarity === "legend" ? (
            <span className="rarity-mark">★</span>
          ) : rarity === "star" ? (
            <span className="rarity-mark">✦</span>
          ) : null}
        </span>
      </header>
      {size !== "hand" && player !== null && (
        <div className="card-rating" aria-label={`Overall rating ${Math.round(player.rating)}`}>
          <RatingShield />
          <span>{Math.round(player.rating)}</span>
        </div>
      )}
      <ul className="card-stats">
        {stats.map((def) => {
          const value = player?.stats[def.key];
          const display = value === undefined ? "—" : formatStatValue(editionId, def.key, value);
          const highlighted = highlightStat === def.key || pendingStat === def.key;
          // Meter fill: normalized strength, flipped for lower-wins stats.
          const fraction =
            value === undefined
              ? 0
              : Math.min(1, Math.max(0, (value - def.min) / (def.max - def.min)));
          const meter = def.direction === "lower" ? 1 - fraction : fraction;
          const row = (
            <>
              <span className="stat-name">{statName(editionId, def.key)}</span>
              <span
                className="stat-dir"
                title={def.direction === "lower" ? "lower wins" : "higher wins"}
              >
                {def.direction === "lower" ? "▼" : "▲"}
              </span>
              <span className="stat-value">{display}</span>
            </>
          );
          return (
            <li
              key={def.key}
              className={highlighted ? "stat-row stat-row--hot" : "stat-row"}
              style={{ "--meter": `${Math.round(meter * 100)}%` } as React.CSSProperties}
            >
              {onSelectStat !== undefined ? (
                <button
                  type="button"
                  className="stat-button"
                  data-stat={def.key}
                  onClick={() => onSelectStat(def.key)}
                >
                  {row}
                </button>
              ) : (
                <div className="stat-static">{row}</div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
