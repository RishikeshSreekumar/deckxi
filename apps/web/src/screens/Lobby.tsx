/**
 * Lobby (mockup turn 7): the room code in the bar, the seats as a grid of
 * pieces with open seats dashed, the chat beside them on a desktop and under
 * them on a phone, and one row of actions along the bottom — ready, the deck
 * rules (host edits them in a sheet), and Start.
 */
import { useEffect, useMemo, useState } from "react";
import {
  GAME_MODES,
  GAME_MODE_INFO,
  MAX_CHAT_LENGTH,
  type RoomSettings,
  type RoomView,
} from "@deckxi/shared";
import { Avatar, Dialog, PowerCard, RoomCode, getEdition } from "@deckxi/ui";
import { useStore } from "../store/store.js";
import { fetchFriends, type PlayerSummary } from "../lib/api.js";
import { LeaveIcon, Wordmark } from "../components/Chrome.js";

const MAX_SEATS = 6;

/** The powers in the order the table shows them, everywhere. */
const POWER_ORDER = ["powerplay", "drs", "super-over"] as const;

function inviteUrl(code: string): string {
  return `${location.origin}/join/${code}`;
}

function useCopy(text: string): { copied: boolean; copy: () => void } {
  const [copied, setCopied] = useState(false);
  return {
    copied,
    copy: () => {
      void navigator.clipboard
        .writeText(text)
        .then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        })
        .catch(() => undefined);
    },
  };
}

/** The invite sheet: code, link, share, and the QR for a phone across the table. */
function InviteDialog({ code, onClose }: { code: string; onClose: () => void }) {
  const [qr, setQr] = useState<string | null>(null);
  const [friends, setFriends] = useState<PlayerSummary[]>([]);
  const url = inviteUrl(code);
  const { copied, copy } = useCopy(url);
  const message = `Join my DeckXI table — code ${code}. ${url}`;

  // Your saved players (#82), so inviting the people you actually play with
  // is one tap rather than a hunt through a chat app. Best-effort: signed out
  // or offline, the sheet is exactly what it was.
  useEffect(() => {
    let cancelled = false;
    void fetchFriends()
      .then((data) => {
        if (!cancelled) setFriends(data.friends);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    // qrcode is ~40kB and only ever renders here, so it loads when the sheet
    // opens rather than riding in the initial bundle (#107).
    void import("qrcode")
      .then(({ default: QRCode }) => QRCode.toDataURL(url, { margin: 1, width: 176 }))
      .then((dataUrl) => {
        if (!cancelled) setQr(dataUrl);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [url]);

  return (
    <Dialog title="Invite friends" onClose={onClose}>
      <RoomCode code={code} />
      {qr !== null && <img className="invite-qr" src={qr} alt={`QR code for ${url}`} />}
      <div className="invite-actions">
        <button type="button" className="button" onClick={copy}>
          {copied ? "Copied!" : "Copy link"}
        </button>
        {"share" in navigator && (
          <button
            type="button"
            className="button"
            onClick={() =>
              void navigator
                .share({ title: "Play DeckXI", text: message, url })
                .catch(() => undefined)
            }
          >
            Share
          </button>
        )}
      </div>

      {friends.length > 0 && (
        <div className="invite-friends" data-testid="invite-friends">
          <span className="label">Your players</span>
          <ul className="friend-list">
            {friends.slice(0, 5).map((friend) => (
              <li key={friend.userId} className="friend-row">
                <Avatar image={friend.image} name={friend.name} size={28} />
                <div className="friend-detail">
                  <strong>{friend.name}</strong>
                </div>
                <button
                  type="button"
                  className="button button--sm"
                  onClick={() => {
                    // No push channel exists, and inventing one for an invite
                    // would be a notification nobody asked for: this hands the
                    // message to whatever app they already talk in.
                    const share = navigator.share?.bind(navigator);
                    if (share !== undefined) {
                      void share({ title: `Invite ${friend.name}`, text: message, url }).catch(
                        () => undefined,
                      );
                      return;
                    }
                    void navigator.clipboard?.writeText(message).catch(() => undefined);
                  }}
                >
                  Invite
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <button type="button" className="button button--ghost" onClick={onClose}>
        Done
      </button>
    </Dialog>
  );
}

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

      {s.gameMode === "power-trumps" && <PowerCardRow />}
    </section>
  );
}

function SettingsRows({ room, isHost }: { room: RoomView; isHost: boolean }) {
  const updateSettings = useStore((s) => s.updateSettings);
  const s = room.settings;
  const patch = (p: Partial<RoomSettings>) => void updateSettings(p).catch(() => undefined);

  const row = (
    label: string,
    value: number,
    options: number[],
    key: "cardsPerPlayer" | "turnTimerSeconds" | "maxRounds",
    unit = "",
  ) => (
    <label className="setting-row">
      <span>{label}</span>
      {isHost ? (
        <select value={value} onChange={(e) => patch({ [key]: Number(e.target.value) })}>
          {options.map((o) => (
            <option key={o} value={o}>
              {o}
              {unit}
            </option>
          ))}
        </select>
      ) : (
        <strong className="chip">
          {value}
          {unit}
        </strong>
      )}
    </label>
  );

  return (
    <div className="setting-rows">
      <div className="setting-row setting-row--modes" role="radiogroup" aria-label="Game mode">
        <span>Game mode</span>
        <div className="mode-picker">
          {GAME_MODES.map((mode) => {
            const info = GAME_MODE_INFO[mode];
            const on = s.gameMode === mode;
            return (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={on}
                className={on ? "mode-option mode-option--on" : "mode-option"}
                disabled={!isHost && !on}
                data-testid={`mode-${mode}`}
                onClick={() => {
                  if (isHost && !on) patch({ gameMode: mode });
                }}
              >
                <strong>{info.name}</strong>
                <span className="sub">{info.blurb}</span>
                <span className="sub mode-seats">
                  {info.players.min}–{info.players.max} players
                </span>
              </button>
            );
          })}
        </div>
      </div>
      {s.gameMode === "power-trumps" && <PowerCardRow />}
      {GAME_MODE_INFO[s.gameMode].family === "trumps" &&
        row("Cards per player", s.cardsPerPlayer, [3, 4, 5, 7, 9, 11], "cardsPerPlayer")}
      {row("Turn timer", s.turnTimerSeconds, [10, 15, 20, 30, 60], "turnTimerSeconds", "s")}
      {GAME_MODE_INFO[s.gameMode].family === "trumps" &&
        row("Round limit", s.maxRounds, [10, 25, 50, 100, 1000], "maxRounds")}
      <p className="sub">
        Deck: {getEdition(s.editionId)?.name ?? s.editionId}
        {isHost ? "" : " · the host decides"}
      </p>
    </div>
  );
}

function LobbyChat() {
  const chat = useStore((s) => s.chat);
  const sendChat = useStore((s) => s.sendChat);
  const [draft, setDraft] = useState("");

  const send = () => {
    const text = draft.trim();
    if (text.length === 0) return;
    setDraft("");
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
  const [sheet, setSheet] = useState<"invite" | "rules" | null>(null);

  const isHost = selfId === room.hostId;
  const self = room.players.find((p) => p.id === selfId);
  const modeInfo = GAME_MODE_INFO[room.settings.gameMode];
  const tooMany = room.players.length > modeInfo.players.max;
  const everyoneReady =
    room.players.length >= modeInfo.players.min && !tooMany && room.players.every((p) => p.ready);
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
          </div>

          {/* Above the seats, not under them: on a phone the seat list is
              most of the screen, and a setup nobody scrolls to is a setup
              nobody knows they can change. */}
          <MatchSetup room={room} isHost={isHost} onEdit={() => setSheet("rules")} />

          <ul className="player-list seat-grid" aria-label={`Players (${players.length}/6)`}>
            {players.map((p) => {
              const status = !p.connected
                ? "away"
                : p.id === selfId
                  ? `you${p.id === room.hostId ? " · host" : ""}`
                  : p.id === room.hostId
                    ? "host"
                    : p.ready
                      ? "ready"
                      : "not ready";
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
                className={self.ready ? "button button--on" : "button"}
                onClick={() => void setReady(!self.ready).catch(() => undefined)}
              >
                {self.ready ? "Not ready" : "I'm ready"}
              </button>
            )}
            <button type="button" className="button" onClick={() => setSheet("rules")}>
              Deck rules
            </button>
            {isHost && (
              <button
                type="button"
                className="button button--primary button--start"
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

      {sheet === "invite" && <InviteDialog code={room.code} onClose={() => setSheet(null)} />}
      {sheet === "rules" && (
        <Dialog title="Deck rules" onClose={() => setSheet(null)}>
          <SettingsRows room={room} isHost={isHost} />
          <button type="button" className="button" onClick={() => setSheet(null)}>
            Done
          </button>
        </Dialog>
      )}
    </main>
  );
}
