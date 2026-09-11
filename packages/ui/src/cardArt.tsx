/**
 * Inline SVG art for the TrumpCard: role icons, header portrait silhouettes,
 * the rating shield and the card-back crest. All drawn from primitives so
 * they inherit currentColor / CSS variables and stay theme-safe.
 */
import type { PlayerRoleId } from "@deckxi/shared";

/**
 * Small role glyphs for the card meta line. Roles are the edition's, so the
 * cricket glyphs below are art for cricket role ids and anything else falls
 * to a neutral figure rather than a blank corner (#143).
 */
export function RoleIcon({ role }: { role: PlayerRoleId }) {
  const common = {
    className: "role-icon",
    viewBox: "0 0 24 24",
    fill: "currentColor",
    "aria-hidden": true,
  } as const;
  switch (role) {
    case "batter":
      // Bat: blade + handle, angled for a drive.
      return (
        <svg {...common}>
          <rect x="9" y="2" width="6" height="14" rx="3" transform="rotate(35 12 9)" />
          <rect x="11.2" y="15" width="1.8" height="7" rx="0.9" transform="rotate(35 12 18)" />
        </svg>
      );
    case "bowler":
      // Ball with seam.
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path
            d="M6 6c4 3.5 8 8.5 10 13"
            fill="none"
            stroke="var(--team-color, #1d4137)"
            strokeWidth="1.6"
            strokeDasharray="2.4 2"
          />
        </svg>
      );
    case "keeper":
      // Glove: palm + thumb.
      return (
        <svg {...common}>
          <rect x="7" y="4" width="10" height="14" rx="5" />
          <rect x="4" y="10" width="5" height="7" rx="2.5" transform="rotate(-25 6.5 13.5)" />
        </svg>
      );
    case "all-rounder":
      // Bolt — does everything.
      return (
        <svg {...common}>
          <path d="M13 2 5 14h5l-1 8 8-12h-5z" />
        </svg>
      );
    case "belt":
      // Championship belt: strap with a centre plate.
      return (
        <svg {...common}>
          <rect x="1" y="9" width="22" height="6" rx="2" />
          <circle cx="12" cy="12" r="5.5" />
          <circle cx="12" cy="12" r="2.6" fill="var(--team-color, #1d4137)" />
        </svg>
      );
    case "mic":
      // Microphone: capsule, stem and base.
      return (
        <svg {...common}>
          <rect x="9" y="2" width="6" height="11" rx="3" />
          <path
            d="M6 11a6 6 0 0 0 12 0"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
          <rect x="11.1" y="16" width="1.8" height="4" rx="0.9" />
          <rect x="8" y="20" width="8" height="1.8" rx="0.9" />
        </svg>
      );
    default:
      // A role this build has no art for: a plain figure.
      return (
        <svg {...common}>
          <circle cx="12" cy="7" r="4" />
          <path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8z" />
        </svg>
      );
  }
}

/** Large low-opacity silhouettes behind the card header. */
export function RolePortrait({ role }: { role: PlayerRoleId }) {
  const common = {
    className: "card-portrait",
    viewBox: "0 0 64 64",
    fill: "currentColor",
    "aria-hidden": true,
  } as const;
  switch (role) {
    case "batter":
      // Head, torso leaning into a shot, raised bat.
      return (
        <svg {...common}>
          <circle cx="30" cy="14" r="7" />
          <path d="M22 24c8-4 16-2 19 6l5 16c1.5 4-3 8-7 6l-9-4-9 8-6-5 9-11-4-8c-1.5-3 0-6.5 2-8z" />
          <rect x="42" y="2" width="5" height="22" rx="2.5" transform="rotate(40 44.5 13)" />
        </svg>
      );
    case "bowler":
      // Delivery stride: arm straight up, ball in hand.
      return (
        <svg {...common}>
          <circle cx="34" cy="18" r="7" />
          <path d="M28 26c7-2 13 1 14 8l2 12-7 14-7-3 5-12-3-7-11 8-4-6z" />
          <rect x="38" y="2" width="5" height="16" rx="2.5" transform="rotate(12 40.5 10)" />
          <circle cx="43" cy="4" r="3.4" />
        </svg>
      );
    case "keeper":
      // Crouched, gloves forward.
      return (
        <svg {...common}>
          <circle cx="32" cy="20" r="7" />
          <path d="M22 30c6-4 14-4 19 0l3 10c1 3.5-2 7-6 6l-16-4c-3.5-1-4.5-6-1-8z" />
          <circle cx="20" cy="42" r="5" />
          <circle cx="44" cy="42" r="5" />
        </svg>
      );
    case "all-rounder":
      // Mid-motion: bat down, ball up.
      return (
        <svg {...common}>
          <circle cx="32" cy="14" r="7" />
          <path d="M24 24c7-3.5 15-1.5 17 6l4 14c1 4-3.5 7.5-7 5.5l-8-4.5-8 9-6-5 8-11-3-7c-1.2-3 .5-6 3-7z" />
          <circle cx="50" cy="8" r="4" />
          <rect x="12" y="40" width="4.5" height="18" rx="2.25" transform="rotate(30 14 49)" />
        </svg>
      );
    default:
      // Head and shoulders: the silhouette every sport has.
      return (
        <svg {...common}>
          <circle cx="32" cy="18" r="10" />
          <path d="M12 60c0-11 9-20 20-20s20 9 20 20z" />
        </svg>
      );
  }
}

/** Shield behind the overall rating. */
export function RatingShield() {
  return (
    <svg viewBox="0 0 26 29" aria-hidden="true">
      <path
        d="M13 1 24 5v10c0 6.5-4.5 11-11 13C6.5 26 2 21.5 2 15V5z"
        fill="rgba(0, 0, 0, 0.38)"
        stroke="rgba(255, 255, 255, 0.55)"
        strokeWidth="1.2"
      />
    </svg>
  );
}

/**
 * The card back — the brand mark, drawn as a printed piece (v4). Sky stock
 * with a cream lattice, a double printed rule inset from the edge, four
 * corner pips, and a crest medallion: a rayed ring around the XI monogram
 * with the ball's seam arcs above and below it and the wordmark under.
 *
 * Every colour is a semantic token, so the back follows the theme and the
 * export pipeline's bare-SVG context still gets the literal fallbacks.
 */
export function CardBackArt() {
  const ground = "var(--card-back, #3b82c4)";
  const ink = "var(--card-back-ink, #fdf9f0)";
  const accent = "var(--interactive-accent, #d1441f)";
  // The rays of the crest: twelve spokes between the two rings, drawn from
  // angles rather than by hand so the ring stays true at any scale.
  const rays = Array.from({ length: 12 }, (_, i) => {
    const a = (i * Math.PI) / 6;
    const [dx, dy] = [Math.sin(a), -Math.cos(a)];
    return `M${(50 + dx * 23).toFixed(1)} ${(70 + dy * 23).toFixed(1)}L${(50 + dx * 27).toFixed(1)} ${(70 + dy * 27).toFixed(1)}`;
  }).join("");
  return (
    <svg className="card-back-art" viewBox="0 0 100 140" aria-label="Face-down card" role="img">
      <defs>
        {/* The lattice of the physical stock: a fine cream cross-hatch with a
            dot at each crossing, at the card's own scale. */}
        <pattern id="dxi-back-weave" width="8" height="8" patternUnits="userSpaceOnUse">
          <path d="M0 8 8 0M-2 2 2-2M6 10 10 6" stroke={ink} strokeWidth="0.5" opacity="0.16" />
          <circle cx="4" cy="4" r="0.8" fill={ink} opacity="0.2" />
        </pattern>
        {/* Light on the middle of the card, so the stock is not flat. */}
        <radialGradient id="dxi-back-glow" cx="50%" cy="50%" r="62%">
          <stop offset="0%" stopColor={ink} stopOpacity="0.16" />
          <stop offset="100%" stopColor={ink} stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="100" height="140" fill={ground} />
      <rect width="100" height="140" fill="url(#dxi-back-weave)" />
      <rect width="100" height="140" fill="url(#dxi-back-glow)" />

      {/* The printed border: a cream rule with a hairline companion inside. */}
      <rect
        x="5"
        y="5"
        width="90"
        height="130"
        rx="5"
        fill="none"
        stroke={ink}
        strokeWidth="1.3"
        opacity="0.85"
      />
      <rect
        x="8"
        y="8"
        width="84"
        height="124"
        rx="3.5"
        fill="none"
        stroke={ink}
        strokeWidth="0.5"
        opacity="0.45"
      />

      {/* Corner pips — the ember, kept to four small marks. */}
      {(
        [
          [12, 12],
          [88, 12],
          [12, 128],
          [88, 128],
        ] as [number, number][]
      ).map(([x, y]) => (
        <rect
          key={`${x}-${y}`}
          x={x - 1.9}
          y={y - 1.9}
          width="3.8"
          height="3.8"
          rx="0.6"
          fill={accent}
          transform={`rotate(45 ${x} ${y})`}
        />
      ))}

      {/* The crest: rayed outer ring, medallion, seam arcs, monogram. */}
      <path d={rays} stroke={ink} strokeWidth="1" opacity="0.5" strokeLinecap="round" />
      <circle cx="50" cy="70" r="22" fill={ground} stroke={ink} strokeWidth="1.4" />
      <circle
        cx="50"
        cy="70"
        r="18.5"
        fill="none"
        stroke={accent}
        strokeWidth="0.9"
        opacity="0.9"
      />
      <path
        d="M33 60.5Q50 69 67 60.5"
        fill="none"
        stroke={ink}
        strokeWidth="1"
        strokeDasharray="2.4 2"
        opacity="0.7"
      />
      <path
        d="M33 79.5Q50 71 67 79.5"
        fill="none"
        stroke={ink}
        strokeWidth="1"
        strokeDasharray="2.4 2"
        opacity="0.7"
      />
      <text
        x="50.5"
        y="77.5"
        textAnchor="middle"
        fontSize="20"
        fontWeight="700"
        fill={ink}
        fontFamily="var(--font-display, 'Baloo 2', Barlow, sans-serif)"
        letterSpacing="1"
      >
        XI
      </text>
      <text
        x="51.3"
        y="106"
        textAnchor="middle"
        fontSize="6"
        fontWeight="600"
        fill={ink}
        opacity="0.75"
        fontFamily="var(--font-sans, Barlow, sans-serif)"
        letterSpacing="2.6"
      >
        DECKXI
      </text>
    </svg>
  );
}
