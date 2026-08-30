/**
 * Lobby: player list with ready states, host-editable settings, invite
 * link/QR, and a small chat while everyone gathers.
 */
import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import { MAX_CHAT_LENGTH, type RoomSettings, type RoomView } from "@deckxi/shared";
import { RoomCode } from "@deckxi/ui";
import { useStore } from "../store/store.js";
import { MuteButton, ThemeToggle } from "../components/Chrome.js";

function inviteUrl(code: string): string {
  return `${location.origin}/join/${code}`;
}

function InvitePanel({ code }: { code: string }) {
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const url = inviteUrl(code);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(url, { margin: 1, width: 176 })
      .then((dataUrl) => {
        if (!cancelled) setQr(dataUrl);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [url]);

  return (
    <section className="panel invite-panel">
      <h2>Invite friends</h2>
      <RoomCode code={code} />
      <div className="invite-actions">
        <button
          type="button"
          className="button"
          onClick={() => {
            void navigator.clipboard
              .writeText(url)
              .then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              })
              .catch(() => undefined);
          }}
        >
          {copied ? "Copied!" : "Copy link"}
        </button>
        {"share" in navigator && (
          <button
            type="button"
            className="button button--ghost"
            onClick={() =>
              void navigator.share({ title: "Play DeckXI", url }).catch(() => undefined)
            }
          >
            Share
          </button>
        )}
      </div>
      {qr !== null && <img className="invite-qr" src={qr} alt={`QR code for ${url}`} />}
    </section>
  );
}

function SettingsPanel({ room, isHost }: { room: RoomView; isHost: boolean }) {
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
        <strong>
          {value}
          {unit}
        </strong>
      )}
    </label>
  );

  return (
    <section className="panel settings-panel">
      <h2>Game settings {isHost ? "" : "(host decides)"}</h2>
      {row("Cards per player", s.cardsPerPlayer, [3, 4, 5, 7, 9, 11], "cardsPerPlayer")}
      {row("Turn timer", s.turnTimerSeconds, [10, 15, 20, 30, 60], "turnTimerSeconds", "s")}
      {row("Round limit", s.maxRounds, [10, 25, 50, 100, 1000], "maxRounds")}
      <p className="hint">Edition: {s.editionId}</p>
    </section>
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
    <section className="panel chat-panel">
      <h2>Chat</h2>
      <ul className="chat-log">
        {chat.length === 0 && <li className="hint">Say hi while everyone gets ready…</li>}
        {chat.map((m, i) => (
          <li key={i}>
            <strong>{m.from.name}:</strong> {m.text}
          </li>
        ))}
      </ul>
      <div className="chat-row">
        <input
          value={draft}
          maxLength={MAX_CHAT_LENGTH}
          placeholder="Message…"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") send();
          }}
        />
        <button type="button" className="button" onClick={send}>
          Send
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

  const isHost = selfId === room.hostId;
  const self = room.players.find((p) => p.id === selfId);
  const everyoneReady = room.players.length >= 2 && room.players.every((p) => p.ready);
  const players = useMemo(() => [...room.players].sort((a, b) => a.seat - b.seat), [room.players]);

  return (
    <main className="screen lobby" data-testid="lobby-screen">
      <header className="screen-head">
        <h1 className="brand brand--small">
          Deck<span className="brand-xi">XI</span>
        </h1>
        <div className="head-actions">
          <ThemeToggle />
          <MuteButton />
          <button type="button" className="button button--ghost" onClick={() => void leaveRoom()}>
            Leave
          </button>
        </div>
      </header>

      <div className="lobby-grid">
        <section className="panel players-panel">
          <h2>
            Players ({players.length}/6)
            {room.spectators.length > 0 && (
              <span className="hint"> · {room.spectators.length} watching</span>
            )}
          </h2>
          <ul className="player-list">
            {players.map((p) => (
              <li key={p.id} className={p.connected ? "player" : "player player--away"}>
                <span className="player-avatar" aria-hidden="true">
                  {p.name.slice(0, 1).toUpperCase()}
                </span>
                <span className="player-name">
                  {p.name}
                  {p.id === room.hostId && <span className="tag">host</span>}
                  {p.id === selfId && <span className="tag tag--you">you</span>}
                  {!p.connected && <span className="tag tag--away">away</span>}
                </span>
                <span className={p.ready ? "ready ready--yes" : "ready"}>
                  {p.ready ? "Ready" : "Not ready"}
                </span>
              </li>
            ))}
          </ul>

          {!spectator && self !== undefined && (
            <button
              type="button"
              className={self.ready ? "button" : "button button--primary"}
              onClick={() => void setReady(!self.ready).catch(() => undefined)}
            >
              {self.ready ? "Not ready" : "I'm ready"}
            </button>
          )}

          {isHost && (
            <button
              type="button"
              className="button button--primary button--start"
              disabled={!everyoneReady}
              onClick={() => void startGame().catch(() => undefined)}
            >
              {everyoneReady
                ? "Start game"
                : room.players.length < 2
                  ? "Waiting for players…"
                  : "Waiting for ready…"}
            </button>
          )}
          {spectator && (
            <p className="hint">You're spectating — the game will appear when it starts.</p>
          )}
        </section>

        <InvitePanel code={room.code} />
        <SettingsPanel room={room} isHost={isHost} />
        <LobbyChat />
      </div>
    </main>
  );
}
