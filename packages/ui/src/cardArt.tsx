/**
 * Inline SVG art for the TrumpCard: role icons, header portrait silhouettes,
 * the rating shield and the card-back crest. All drawn from primitives so
 * they inherit currentColor / CSS variables and stay theme-safe.
 */
import type { PlayerRole } from "@deckxi/shared";

/** Small role glyphs for the card meta line. */
export function RoleIcon({ role }: { role: PlayerRole }) {
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
  }
}

/** Large low-opacity silhouettes behind the card header. */
export function RolePortrait({ role }: { role: PlayerRole }) {
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
 * The card back — the brand mark. A gold dot grid on the night ground (the
 * thing that makes a fanned stack read as a stack), with a seamed crest ring
 * around the XI monogram.
 */
export function CardBackArt() {
  // Every colour is a semantic token so the back follows the theme; the
  // fallbacks only matter in the export pipeline's bare-SVG context.
  const ground = "var(--card-back, #0b1512)";
  const accent = "var(--interactive-accent, #d9a441)";
  return (
    <svg className="card-back-art" viewBox="0 0 100 140" aria-label="Face-down card" role="img">
      <defs>
        {/* The 9px dot grid of the physical deck, at the card's own scale. */}
        <pattern id="dxi-back-grid" width="6.4" height="6.4" patternUnits="userSpaceOnUse">
          <circle cx="3.2" cy="3.2" r="0.85" fill={accent} opacity="0.35" />
        </pattern>
      </defs>
      <rect width="100" height="140" fill={ground} />
      <rect width="100" height="140" fill="url(#dxi-back-grid)" />
      {/* Crest ring — the ground punched back through the grid. */}
      <circle cx="50" cy="70" r="27" fill={ground} stroke={accent} strokeWidth="1.4" />
      <circle
        cx="50"
        cy="70"
        r="22.5"
        fill="none"
        stroke={accent}
        strokeWidth="0.6"
        opacity="0.5"
      />
      {/* Seam arcs — the cricket ball motif */}
      <path
        d="M31 55 Q50 66 69 55"
        fill="none"
        stroke={accent}
        strokeWidth="1.2"
        strokeDasharray="2.6 2.2"
        opacity="0.85"
      />
      <path
        d="M31 85 Q50 74 69 85"
        fill="none"
        stroke={accent}
        strokeWidth="1.2"
        strokeDasharray="2.6 2.2"
        opacity="0.85"
      />
      {/* Monogram */}
      <text
        x="50"
        y="77"
        textAnchor="middle"
        fontSize="22"
        fontWeight="700"
        fill="var(--card-back-ink, #f4f1e6)"
        fontFamily="var(--font-display, 'Baloo 2', Barlow, sans-serif)"
        letterSpacing="1.2"
      >
        XI
      </text>
      {/* Gold rule inset from the edge — the printed border of the deck. */}
      <rect
        x="4"
        y="4"
        width="92"
        height="132"
        rx="5"
        fill="none"
        stroke={accent}
        strokeWidth="0.7"
        opacity="0.45"
      />
    </svg>
  );
}
