/**
 * In-game chat: a collapsible sheet so the table stays uncluttered on mobile.
 * Closed, the toggle carries an unread count; opening it clears the badge and
 * pins the log to the newest message. Players and spectators can both talk.
 *
 * Messages are bubbles — yours on the right — and the quick phrases above the
 * input cover the things people type mid-round anyway, because a phone
 * keyboard mid-reveal costs you the round.
 */
import { useEffect, useRef, useState } from "react";
import { MAX_CHAT_LENGTH } from "@deckxi/shared";
import { useStore } from "../store/store.js";

/** Table talk, one tap. Short enough to read at a glance in a bubble. */
const QUICK_PHRASES = ["HOWZAT", "good call", "no chance", "rematch"];

export function GameChat() {
  const chat = useStore((s) => s.chat);
  const selfId = useStore((s) => s.selfId);
  const sendChat = useStore((s) => s.sendChat);
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(chat.length);
  const [draft, setDraft] = useState("");
  const logRef = useRef<HTMLUListElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const unread = open ? 0 : Math.max(0, chat.length - seen);

  // While open, everything is read and the newest message stays in view.
  useEffect(() => {
    if (!open) return;
    setSeen(chat.length);
    const log = logRef.current;
    if (log !== null) log.scrollTop = log.scrollHeight;
  }, [open, chat.length]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const post = (text: string) => {
    if (text.length === 0) return;
    void sendChat(text).catch(() => undefined);
  };

  const send = () => {
    const text = draft.trim();
    if (text.length === 0) return;
    setDraft("");
    post(text);
  };

  return (
    <div className={`game-chat ${open ? "game-chat--open" : ""}`} data-testid="game-chat">
      {/* The sheet carries its own close button, so the toggle steps aside
          while it is open — two controls both labelled "Close chat" is one
          ambiguous target for a screen reader and for the tests. */}
      {!open && (
        <button
          type="button"
          className="game-chat-toggle"
          aria-expanded={false}
          aria-label={unread > 0 ? `Open chat, ${unread} unread` : "Open chat"}
          onClick={() => setOpen(true)}
        >
          <span>Chat</span>
          {unread > 0 && (
            <span className="game-chat-badge" aria-hidden="true">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </button>
      )}

      {open && (
        <div className="game-chat-panel">
          <div className="game-chat-head">
            <span className="game-chat-title">Table chat</span>
            <button
              type="button"
              className="icon-button"
              aria-label="Close chat"
              onClick={() => setOpen(false)}
            >
              ✕
            </button>
          </div>

          <ul className="chat-log" ref={logRef} data-testid="game-chat-log">
            {chat.length === 0 && <li className="hint">No messages yet — say something.</li>}
            {chat.map((m, i) => (
              <li key={i} className={`chat-msg ${m.from.id === selfId ? "chat-msg--mine" : ""}`}>
                <strong>{m.from.name}</strong>
                <span>{m.text}</span>
              </li>
            ))}
          </ul>

          <div className="chat-quick">
            {QUICK_PHRASES.map((phrase) => (
              <button
                key={phrase}
                type="button"
                className="chat-quick-button"
                onClick={() => post(phrase)}
              >
                {phrase}
              </button>
            ))}
          </div>

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
                if (e.key === "Escape") setOpen(false);
              }}
            />
            <button type="button" className="button" onClick={send}>
              Send
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
