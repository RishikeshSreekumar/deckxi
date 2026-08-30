/**
 * App chrome shared by every screen: connection banner, toasts, floating
 * emote reactions, and the mute and theme toggles.
 */
import { useState } from "react";
import { useStore } from "../store/store.js";
import { isMuted, setMuted } from "../lib/sounds.js";
import { useTheme } from "../lib/theme.js";

export function ConnectionBanner() {
  const connection = useStore((s) => s.connection);
  if (connection === "online") return null;
  return (
    <div className="conn-banner" role="status">
      {connection === "connecting" ? "Connecting…" : "Reconnecting — hang tight…"}
    </div>
  );
}

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismissToast);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <button
          key={t.id}
          type="button"
          className={`toast toast--${t.kind}`}
          onClick={() => dismiss(t.id)}
        >
          {t.text}
        </button>
      ))}
    </div>
  );
}

export function FloatingReactions() {
  const reactions = useStore((s) => s.reactions);
  return (
    <div className="reactions-layer" aria-hidden="true">
      {reactions.map((r) => (
        <span key={r.id} className="reaction-float" style={{ left: `${15 + ((r.id * 37) % 70)}%` }}>
          <span className="reaction-emote">{r.emote}</span>
          <span className="reaction-from">{r.from}</span>
        </span>
      ))}
    </div>
  );
}

/**
 * Theme toggle. Lives in real app chrome rather than the dev-facing /cards
 * gallery it used to hide in. Keeps the `theme-toggle` test id the visual
 * specs drive.
 */
export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <button
      type="button"
      className="icon-button"
      data-testid="theme-toggle"
      aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
      onClick={toggle}
    >
      {theme === "dark" ? "☀️" : "🌙"}
    </button>
  );
}

export function MuteButton() {
  const [muted, setLocalMuted] = useState(isMuted());
  return (
    <button
      type="button"
      className="icon-button"
      aria-label={muted ? "Unmute sounds" : "Mute sounds"}
      onClick={() => {
        setMuted(!muted);
        setLocalMuted(!muted);
      }}
    >
      {muted ? "🔇" : "🔊"}
    </button>
  );
}
