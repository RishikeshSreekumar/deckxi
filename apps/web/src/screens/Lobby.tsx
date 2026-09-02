/**
 * Lobby (mockup turn 7): the room code in the bar, the seats as a grid of
 * pieces with open seats dashed, the chat beside them on a desktop and under
 * them on a phone, and one row of actions along the bottom — ready, the deck
 * rules (host edits them in a sheet), and Start.
 */
import { useEffect, useMemo, useState } from "react";
import { MAX_CHAT_LENGTH, type RoomSettings, type RoomView } from "@deckxi/shared";
import { Dialog, RoomCode } from "@deckxi/ui";
import { useStore } from "../store/store.js";
import { LeaveIcon, Wordmark } from "../components/Chrome.js";

const MAX_SEATS = 6;

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
  const url = inviteUrl(code);
  const { copied, copy } = useCopy(url);

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
              void navigator.share({ title: "Play DeckXI", url }).catch(() => undefined)
            }
          >
            Share
          </button>
        )}
      </div>
      <button type="button" className="button button--ghost" onClick={onClose}>
        Done
      </button>
    </Dialog>
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
      {row("Cards per player", s.cardsPerPlayer, [3, 4, 5, 7, 9, 11], "cardsPerPlayer")}
      {row("Turn timer", s.turnTimerSeconds, [10, 15, 20, 30, 60], "turnTimerSeconds", "s")}
      {row("Round limit", s.maxRounds, [10, 25, 50, 100, 1000], "maxRounds")}
      <p className="sub">
        Edition: {s.editionId}
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
  const everyoneReady = room.players.length >= 2 && room.players.every((p) => p.ready);
  const players = useMemo(() => [...room.players].sort((a, b) => a.seat - b.seat), [room.players]);
  const openSeats = Math.max(0, MAX_SEATS - players.length);
  const missing = Math.max(0, 2 - players.length);
  const { copied, copy } = useCopy(inviteUrl(room.code));

  const heading = everyoneReady
    ? "Everyone's ready"
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
            {room.settings.editionId} · {room.settings.maxRounds} rounds
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
            <p className="sub">
              Everyone gets {room.settings.cardsPerPlayer} cards, dealt at random.
              {room.spectators.length > 0 && ` ${room.spectators.length} watching.`}
            </p>
          </div>

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
                  : room.players.length < 2
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
