/**
 * App chrome shared by every screen: connection banner, update and install
 * prompts, toasts, floating emote reactions, and the mute and theme toggles.
 */
import { useEffect, useState } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import { useStore } from "../store/store.js";
import { isMuted, setMuted } from "../lib/sounds.js";
import { useTheme } from "../lib/theme.js";

const BANNER_COPY = {
  connecting: "Connecting…",
  reconnecting: "Reconnecting — hang tight…",
  // Honest rather than hopeful: the device knows there is no network, so we
  // do not pretend a server round-trip is imminent (#111).
  offline: "You're offline — we'll pick the game back up when you're connected.",
} as const;

export function ConnectionBanner() {
  const connection = useStore((s) => s.connection);
  if (connection === "online") return null;
  return (
    <div
      className={connection === "offline" ? "conn-banner conn-banner--offline" : "conn-banner"}
      role="status"
      data-testid="conn-banner"
    >
      {BANNER_COPY[connection]}
    </div>
  );
}

/**
 * A new build is waiting. Offered, never forced — and never while the player
 * is in a room, because reloading mid-match loses the round even though the
 * server would let them resume. The store already knows: `room === null`.
 */
export function UpdatePrompt() {
  const room = useStore((s) => s.room);
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  if (!needRefresh || room !== null) return null;
  return (
    <div className="update-bar" role="status" data-testid="update-prompt">
      <span>A new version of DeckXI is ready.</span>
      <div className="update-bar-actions">
        <button
          type="button"
          className="button button--primary button--sm"
          onClick={() => void updateServiceWorker(true)}
        >
          Refresh
        </button>
        <button
          type="button"
          className="button button--ghost button--sm"
          onClick={() => setNeedRefresh(false)}
        >
          Later
        </button>
      </div>
    </div>
  );
}

interface InstallEvent extends Event {
  prompt(): Promise<void>;
}

const INSTALL_DISMISSED = "deckxi.install-dismissed";

function isStandalone(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches;
}

/**
 * Add-to-home-screen education. Android fires `beforeinstallprompt` and we
 * can show a real button; Safari has no such event, so iOS gets a hint
 * pointing at the Share menu.
 *
 * Held back until the player has actually been in a room — asking someone to
 * install a game they have not played yet is how install prompts earn their
 * reputation. Dismissal is permanent, and nothing shows once installed.
 */
export function InstallPrompt() {
  const room = useStore((s) => s.room);
  const [event, setEvent] = useState<InstallEvent | null>(null);
  const [iosHint, setIosHint] = useState(false);
  const [earned, setEarned] = useState(false);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(INSTALL_DISMISSED) === "1";
    } catch {
      return true;
    }
  });

  useEffect(() => {
    if (room !== null) setEarned(true);
  }, [room]);

  useEffect(() => {
    if (isStandalone()) return;
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setEvent(e as InstallEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    // iOS Safari: no event to wait for, so detect the platform instead.
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) && "share" in navigator;
    if (ios) setIosHint(true);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(INSTALL_DISMISSED, "1");
    } catch {
      // Session-only dismissal; it will ask once more next time.
    }
  };

  if (dismissed || !earned || room !== null || isStandalone()) return null;
  if (event === null && !iosHint) return null;

  return (
    <div className="install-bar" role="note" data-testid="install-prompt">
      <span>
        {event !== null
          ? "Install DeckXI for a full-screen game."
          : "Add DeckXI to your home screen: Share → Add to Home Screen."}
      </span>
      <div className="update-bar-actions">
        {event !== null && (
          <button
            type="button"
            className="button button--primary button--sm"
            onClick={() => {
              void event.prompt();
              dismiss();
            }}
          >
            Install
          </button>
        )}
        <button type="button" className="button button--ghost button--sm" onClick={dismiss}>
          No thanks
        </button>
      </div>
    </div>
  );
}

/**
 * Operator broadcast (#70): "back in ten minutes", "we know about the
 * disconnects". Above everything, dismissible, and it comes back on the next
 * change — a notice the player can silence forever is a notice that failed.
 */
export function MaintenanceBanner() {
  const notice = useStore((s) => s.notice);
  const [dismissed, setDismissed] = useState<string | null>(null);
  if (notice === null || notice.text === dismissed) return null;
  return (
    <div
      className={`ops-banner ops-banner--${notice.level}`}
      role="status"
      data-testid="ops-banner"
    >
      <span>{notice.text}</span>
      <button
        type="button"
        className="icon-button"
        aria-label="Dismiss notice"
        onClick={() => setDismissed(notice.text)}
      >
        ✕
      </button>
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
