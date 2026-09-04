/**
 * App chrome shared by every screen: the app bar and wordmark, the six-slot
 * code entry, connection banner, update and install prompts, toasts, floating
 * emote reactions, the mute toggle, and the shared icon glyphs.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { JOIN_CODE_LENGTH } from "@deckxi/shared";
import { useRegisterSW } from "virtual:pwa-register/react";
import { useStore } from "../store/store.js";
import { isMuted, setMuted } from "../lib/sounds.js";

const BANNER_COPY = {
  connecting: "Connecting…",
  reconnecting: "Reconnecting — hang tight…",
  // Honest rather than hopeful: the device knows there is no network, so we
  // do not pretend a server round-trip is imminent (#111).
  offline: "You're offline — we'll pick the game back up when you're connected.",
} as const;

export function ConnectionBanner() {
  const connection = useStore((s) => s.connection);
  const practice = useStore((s) => s.practice);
  // A practice game is played entirely on the device (#85). Telling someone
  // mid-round that we are reconnecting is true of the socket and irrelevant
  // to the game in front of them.
  if (connection === "online" || practice) return null;
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

/** Line icons for the chrome: one stroke weight, currentColor, 20px box. */
export function Icon({ children, size = 20 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export function ChevronLeftIcon({ size }: { size?: number }) {
  return (
    <Icon {...(size !== undefined ? { size } : {})}>
      <path d="M15 5l-7 7 7 7" />
    </Icon>
  );
}

/** Door with an arrow out of it. */
export function LeaveIcon({ size }: { size?: number }) {
  return (
    <Icon {...(size !== undefined ? { size } : {})}>
      <path d="M10 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h5" />
      <path d="M14 8l4 4-4 4" />
      <path d="M18 12H9" />
    </Icon>
  );
}

export function SmileIcon({ size }: { size?: number }) {
  return (
    <Icon {...(size !== undefined ? { size } : {})}>
      <circle cx="12" cy="12" r="9" />
      <path d="M8.5 14.5c.9 1.2 2.1 1.8 3.5 1.8s2.6-.6 3.5-1.8" />
      <path d="M9 10h.01M15 10h.01" />
    </Icon>
  );
}

/** A chevron home: the one way back from every settings-side screen. */
export function BackLink({ to = "/", label = "Back" }: { to?: string; label?: string }) {
  return (
    <Link to={to} className="icon-button" aria-label={label}>
      <ChevronLeftIcon />
    </Link>
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

/** The wordmark: Deck in ink, XI in the accent. A link home where it is one. */
export function Wordmark({ to }: { to?: string }) {
  const mark = (
    <>
      Deck<span className="brand-xi">XI</span>
    </>
  );
  if (to === undefined) return <span className="brand">{mark}</span>;
  return (
    <Link to={to} className="brand">
      {mark}
    </Link>
  );
}

/**
 * The bar across the top of every out-of-game screen (mockup turn 7): the
 * wordmark on the left and whatever the screen puts beside it on the right.
 * One rule under it, the same ink as every edge.
 */
export function AppBar({
  children,
  title,
  back = false,
}: {
  children?: ReactNode;
  title?: string;
  /** A chevron home, leading — the way back from a settings-side screen. */
  back?: boolean;
}) {
  return (
    <header className="app-bar">
      {back && <BackLink />}
      <Wordmark to="/" />
      {title !== undefined && <span className="app-bar-title">{title}</span>}
      <div className="app-bar-actions">{children}</div>
    </header>
  );
}

/**
 * Six outlined slots that fill as you type (mockup turn 7's join piece). One
 * real input sits over the slots — transparent, full width — so it is still
 * a single text field to a keyboard, a screen reader, autofill and the tests;
 * the slots are the picture of it. The next empty slot wears the accent.
 */
export function CodeSlots({
  value,
  onChange,
  onSubmit,
}: {
  value: string;
  onChange: (code: string) => void;
  onSubmit: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  const chars = value.toUpperCase().slice(0, JOIN_CODE_LENGTH).split("");
  const cursor = Math.min(chars.length, JOIN_CODE_LENGTH - 1);

  return (
    <div className="code-slots" onClick={() => inputRef.current?.focus()}>
      {Array.from({ length: JOIN_CODE_LENGTH }, (_, i) => (
        <span
          key={i}
          className={`code-slot${focused && i === cursor && chars.length < JOIN_CODE_LENGTH ? " code-slot--cursor" : ""}`}
          aria-hidden="true"
        >
          {chars[i] ?? ""}
        </span>
      ))}
      <input
        ref={inputRef}
        className="code-input"
        aria-label="Room code"
        value={value}
        maxLength={JOIN_CODE_LENGTH}
        placeholder="ABC123"
        autoCapitalize="characters"
        autoCorrect="off"
        autoComplete="off"
        spellCheck={false}
        inputMode="text"
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(e) => onChange(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
        onKeyDown={(e) => {
          if (e.key === "Enter") onSubmit();
        }}
      />
    </div>
  );
}
