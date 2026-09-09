/**
 * Lobby (mockup turn 7): the room code in the bar, the seats as a grid of
 * pieces with open seats dashed, the chat beside them on a desktop and under
 * them on a phone, and one row of actions along the bottom — ready, the deck
 * rules (host edits them in a sheet), and Start.
 */
import { Suspense, lazy, useMemo, useRef, useState } from "react";
import { GAME_MODES, GAME_MODE_INFO, MAX_CHAT_LENGTH, type RoomView } from "@deckxi/shared";
import { Dialog, PowerCard, getEdition } from "@deckxi/ui";
import { useStore } from "../store/store.js";
import { inviteUrl, useCopy } from "../lib/copy.js";
import { LeaveIcon, Wordmark } from "../components/Chrome.js";

const MAX_SEATS = 6;

const HowToPlay = lazy(() =>
  import("../components/HowToPlay.js").then((m) => ({ default: m.HowToPlay })),
);
/** The invite sheet draws a QR and lists your saved players; both wait for the tap. */
/** The host's settings sheet: three selects and the mode picker, one tap in. */
const SettingsRows = lazy(() =>
  import("../components/SettingsRows.js").then((m) => ({ default: m.SettingsRows })),
);
const InviteDialog = lazy(() =>
  import("../components/InviteDialog.js").then((m) => ({ default: m.InviteDialog })),
);

/** The powers in the order the table shows them, everywhere. */
const POWER_ORDER = ["powerplay", "drs", "super-over"] as const;

/**
 * The three power cards, laid out as cards. A power that only ever appears as
 * two letters on a chip is a rule nobody at the table has read; printed as a
 * piece of the deck, with what it does on it, it is a rule they can point at.
 */
function PowerCardRow() {
  return (
    <div className="power-card-row-strip" aria-label="Power cards">
      {POWER_ORDER.map((kind) => (
        <PowerCard key={kind} kind={kind} size="full" />
      ))}
    </div>
  );
}

/**
 * The setup, on the lobby itself. It used to live only behind "Deck rules",
 * which meant a player could sit through a whole match without ever learning
 * the mode was a choice — so the mode, the numbers and (in power trumps) the
 * cards are printed here, with the one button that changes them right beside
 * them.
 */
function MatchSetup({
  room,
  isHost,
  onEdit,
}: {
  room: RoomView;
  isHost: boolean;
  onEdit: () => void;
}) {
  const s = room.settings;
  const info = GAME_MODE_INFO[s.gameMode];
  const chips: [string, string][] = [
    ...(info.family === "trumps"
      ? ([["Cards each", String(s.cardsPerPlayer)]] as [string, string][])
      : []),
    ...(s.gameMode === "power-trumps"
      ? ([["Pick from", `top ${s.choiceDepth}`]] as [string, string][])
      : []),
    ["Turn timer", `${s.turnTimerSeconds}s`],
    ...(info.family === "trumps"
      ? ([["Round limit", String(s.maxRounds)]] as [string, string][])
      : []),
    ["Deck", getEdition(s.editionId)?.name ?? s.editionId],
  ];

  return (
    <section className="panel match-setup" aria-labelledby="setup-title" data-testid="match-setup">
      <div className="match-setup-head">
        <h2 className="panel-title" id="setup-title">
          Match setup
        </h2>
        <button
          type="button"
          className="chip match-setup-edit"
          data-testid="edit-setup"
          onClick={onEdit}
        >
          {isHost ? "Change" : "View"}
        </button>
      </div>

      <div className="match-setup-mode">
        <strong>{info.name}</strong>
        <span className="sub">{info.blurb}</span>
        <span className="sub">
          {info.players.min}–{info.players.max} players ·{" "}
          {isHost
            ? `${GAME_MODES.length} modes to pick from — tap Change`
            : "the host picks the mode"}
        </span>
      </div>

      <dl className="match-setup-chips">
        {chips.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>

      {info.family === "trumps" && s.cardsPerPlayer < room.players.length && (
        <p className="sub setting-warning" role="status" data-testid="cards-warning">
          Only {s.cardsPerPlayer} cards each for {room.players.length} players: the last seats can
          be out before their first call.{isHost ? " Deal more — tap Change." : ""}
        </p>
      )}
      {s.gameMode === "power-trumps" && <PowerCardRow />}
    </section>
  );
}

function LobbyChat() {
  const chat = useStore((s) => s.chat);
  const sendChat = useStore((s) => s.sendChat);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // The field's own value, not only the state: a Send that lands before
  // React has folded the last keystroke in must still post what is typed.
  const send = () => {
    const text = (inputRef.current?.value ?? draft).trim();
    if (text.length === 0) return;
    setDraft("");
    if (inputRef.current !== null) inputRef.current.value = "";
    void sendChat(text).catch(() => undefined);
  };

  return (
    <section className="lobby-chat" aria-label="Chat">
      <div className="lobby-chat-head">
        <span className="label">Chat</span>
      </div>
      <ul className="chat-log">
        {chat.length === 0 && <li className="sub">Say hi while everyone gets ready…</li>}
        {chat.map((m, i) => (
          <li key={i}>
            <strong>{m.from.name}</strong> {m.text}
          </li>
        ))}
      </ul>
      <div className="chat-row">
        <input
          ref={inputRef}
          value={draft}
          maxLength={MAX_CHAT_LENGTH}
          placeholder="Say something…"
          aria-label="Chat message"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") send();
          }}
        />
        <button type="button" className="icon-button chat-send" aria-label="Send" onClick={send}>
          ↑
        </button>
      </div>
    </section>
  );
}

export function Lobby({ room }: { room: RoomView }) {
  const selfId = useStore((s) => s.selfId);
  const spectator = useStore((s) => s.spectator);
  const setReady = useStore((s) => s.setReady);
  const startGame = useStore((s) => s.startGame);
  const leaveRoom = useStore((s) => s.leaveRoom);
  const setupChanged = useStore((s) => s.setupChanged);
  const [sheet, setSheet] = useState<"invite" | "rules" | "howto" | null>(null);

  const isHost = selfId === room.hostId;
  const self = room.players.find((p) => p.id === selfId);
  const modeInfo = GAME_MODE_INFO[room.settings.gameMode];
  const tooMany = room.players.length > modeInfo.players.max;
  const enoughPlayers = room.players.length >= modeInfo.players.min && !tooMany;
  const everyoneReady = enoughPlayers && room.players.every((p) => p.ready);
  const notReadyNames = room.players.filter((p) => !p.ready && p.id !== selfId).map((p) => p.name);
  const players = useMemo(() => [...room.players].sort((a, b) => a.seat - b.seat), [room.players]);
  const openSeats = Math.max(0, MAX_SEATS - players.length);
  const missing = Math.max(0, 2 - players.length);
  const { copied, copy } = useCopy(inviteUrl(room.code));

  const heading = everyoneReady
    ? "Everyone's ready"
    : tooMany
      ? `${modeInfo.name} seats ${modeInfo.players.max}`
      : missing > 0
        ? `Waiting for ${missing === 1 ? "one more" : "two more"}`
        : "Waiting for ready";

  return (
    <main className="screen lobby" data-testid="lobby-screen">
      <header className="app-bar lobby-bar">
        <Wordmark />
        <span className="lobby-code" aria-label={`Room code ${room.code.split("").join(" ")}`}>
          {room.code}
        </span>
        <button type="button" className="chip" onClick={copy}>
          {copied ? "Copied!" : "Copy invite"}
        </button>
        <div className="app-bar-actions">
          <span className="sub lobby-rules-line">
            {modeInfo.name}
            {modeInfo.family === "trumps"
              ? ` · ${room.settings.maxRounds} rounds`
              : " · 13-card draft"}
          </span>
          <button
            type="button"
            className="icon-button"
            aria-label="Leave room"
            title="Leave room"
            onClick={() => void leaveRoom()}
          >
            <LeaveIcon />
          </button>
        </div>
      </header>

      <div className="lobby-grid">
        <section className="lobby-main">
          <div className="lobby-intro">
            <h1 className="headline">{heading}</h1>
            {room.spectators.length > 0 && (
              <p className="sub">{room.spectators.length} watching.</p>
            )}
            {setupChanged && !spectator && self?.ready === false && (
              <p className="notice" role="status" data-testid="setup-changed">
                The host changed the setup and cleared your ready tick — check it, then ready up
                again.
              </p>
            )}
          </div>

          {/* Above the seats, not under them: on a phone the seat list is
              most of the screen, and a setup nobody scrolls to is a setup
              nobody knows they can change. */}
          <MatchSetup room={room} isHost={isHost} onEdit={() => setSheet("rules")} />

          <ul className="player-list seat-grid" aria-label={`Players (${players.length}/6)`}>
            {players.map((p) => {
              // Every seat says the same two things — who, and whether they are
              // ready — so nobody has to work out what the table is waiting on.
              const readiness = p.ready ? "ready" : "not ready";
              const status = !p.connected
                ? "away"
                : p.id === selfId
                  ? `you${p.id === room.hostId ? " · host" : ""} · ${readiness}`
                  : p.id === room.hostId
                    ? `host · ${readiness}`
                    : readiness;
              return (
                <li
                  key={p.id}
                  className={`panel player${p.connected ? "" : " player--away"}${p.ready ? " player--ready" : ""}`}
                >
                  <span className="avatar player-avatar" aria-hidden="true">
                    {p.name.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="player-name">
                    <strong>{p.name}</strong>
                    <span className="sub">{status}</span>
                  </span>
                  <span
                    className={p.ready ? "ready ready--yes" : "ready"}
                    aria-label={p.ready ? "Ready" : "Not ready"}
                  >
                    {p.ready ? "✓" : "…"}
                  </span>
                </li>
              );
            })}
            {Array.from({ length: openSeats }, (_, i) => (
              <li key={`open-${i}`} className="panel player player--open">
                <span className="player-name">
                  <strong>Open seat</strong>
                </span>
                <button type="button" className="chip" onClick={() => setSheet("invite")}>
                  Invite
                </button>
              </li>
            ))}
          </ul>

          {spectator && (
            <p className="sub">You're spectating — the game will appear when it starts.</p>
          )}

          <div className="lobby-actions">
            {!spectator && self !== undefined && (
              <button
                type="button"
                className={self.ready ? "button button--on" : "button button--primary"}
                aria-pressed={self.ready}
                data-testid="ready-toggle"
                onClick={() => void setReady(!self.ready).catch(() => undefined)}
              >
                {self.ready ? "✓ You're ready" : "I'm ready"}
              </button>
            )}
            <button type="button" className="button" onClick={() => setSheet("howto")}>
              How to play
            </button>
            <button type="button" className="button" onClick={() => setSheet("rules")}>
              {isHost ? "Match settings" : "View settings"}
            </button>
            {isHost && !everyoneReady && enoughPlayers && notReadyNames.length > 0 && (
              <button
                type="button"
                className="button button--ghost"
                data-testid="start-anyway"
                title={`Start without waiting for ${notReadyNames.join(", ")}`}
                onClick={() => void startGame(true).catch(() => undefined)}
              >
                Start anyway
              </button>
            )}
            {isHost && (
              <button
                type="button"
                className={
                  everyoneReady ? "button button--primary button--start" : "button button--start"
                }
                disabled={!everyoneReady}
                onClick={() => void startGame().catch(() => undefined)}
              >
                {everyoneReady
                  ? "Start match"
                  : tooMany
                    ? `Too many for ${modeInfo.name}`
                    : room.players.length < modeInfo.players.min
                      ? "Waiting for players…"
                      : "Waiting for ready…"}
              </button>
            )}
          </div>
        </section>

        <LobbyChat />
      </div>

      {sheet === "invite" && (
        <Suspense fallback={null}>
          <InviteDialog code={room.code} onClose={() => setSheet(null)} />
        </Suspense>
      )}
      {sheet === "howto" && (
        <Suspense fallback={null}>
          <HowToPlay
            editionId={room.settings.editionId}
            gameMode={room.settings.gameMode}
            onClose={() => setSheet(null)}
          />
        </Suspense>
      )}
      {sheet === "rules" && (
        <Dialog title="Match settings" onClose={() => setSheet(null)}>
          <Suspense fallback={null}>
            <SettingsRows room={room} isHost={isHost} />
          </Suspense>
          <button type="button" className="button" onClick={() => setSheet(null)}>
            Done
          </button>
        </Dialog>
      )}
    </main>
  );
}
