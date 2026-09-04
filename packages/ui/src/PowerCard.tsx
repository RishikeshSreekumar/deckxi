/**
 * The power card — the same printed piece as a TrumpCard, but what is printed
 * on it is the rule. A power used to be three letters on a chip and a
 * tooltip, which is fine for the player who wrote the game and no use to the
 * four friends who did not: this is the card they can read, in the hand, in
 * the lobby and in the rules sheet.
 *
 * The top block is the badge in the power's own colour with the name over it;
 * the table under it is three headed rows — WHEN, IF IT WORKS, IF IT FAILS —
 * drawn like the stat table so the two cards read as one deck. It scales from
 * its own width exactly like a TrumpCard, so `size` is the same vocabulary.
 */
import { POWER_INFO, type PowerKindView } from "@deckxi/shared";
import type { CardSize } from "./TrumpCard.js";

export interface PowerCardProps {
  kind: PowerKindView;
  size?: CardSize;
  /** Spent this game — printed, not hidden, so the count stays readable. */
  spent?: boolean;
  /** Armed for this round. */
  armed?: boolean;
  /** When set the whole card is a button (arming it from the hand). */
  onSelect?: (kind: PowerKindView) => void;
  disabled?: boolean;
}

/** The ink each power is printed in, as the card's --team-color slot. */
const POWER_COLOR: Record<PowerKindView, string> = {
  powerplay: "#b8471f",
  drs: "#1d4137",
  "super-over": "#7a3b8f",
};

export function PowerCard({
  kind,
  size = "full",
  spent = false,
  armed = false,
  onSelect,
  disabled = false,
}: PowerCardProps) {
  const info = POWER_INFO[kind];
  const rows: [string, string][] = [
    ["When", info.when],
    ["If it works", info.win],
    ["If it fails", info.fail],
  ];

  const face = (
    <div
      className={[
        "card power-card",
        `power-card--${kind}`,
        armed ? "power-card--armed" : "",
        spent ? "power-card--spent" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={{ "--team-color": POWER_COLOR[kind] } as React.CSSProperties}
    >
      <div className="card-frame" aria-hidden="true" />

      <div className="power-card-top">
        <span className="power-card-badge" aria-hidden="true">
          {info.short}
        </span>
        <header className="card-band">
          <span className="card-name">{info.name}</span>
        </header>
        {spent && (
          <span className="power-card-stamp" aria-hidden="true">
            Used
          </span>
        )}
      </div>

      <dl className="power-card-table">
        {rows.map(([label, text]) => (
          <div className="power-card-row" key={label}>
            <dt>{label}</dt>
            <dd>{text}</dd>
          </div>
        ))}
      </dl>
    </div>
  );

  const scale = `card-scale card-scale--${size} power-card-scale`;

  if (onSelect === undefined) return <div className={scale}>{face}</div>;
  return (
    <button
      type="button"
      className={scale}
      aria-pressed={armed}
      disabled={disabled || spent}
      aria-label={`${info.name}${spent ? " (used)" : ""}: ${info.blurb}`}
      onClick={() => onSelect(kind)}
    >
      {face}
    </button>
  );
}
