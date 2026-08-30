/**
 * In-game chat: a collapsible drawer so the table stays uncluttered on mobile.
 * Closed, the toggle carries an unread count; opening it clears the badge and
 * pins the log to the newest message. Players and spectators can both talk.
 */
import { useEffect, useRef, useState } from "react";
import { MAX_CHAT_LENGTH } from "@deckxi/shared";
import { useStore } from "../store/store.js";

export function GameChat() {
  const chat = useStore((s) => s.chat);
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

  const send = () => {
    const text = draft.trim();
    if (text.length === 0) return;
    setDraft("");
    void sendChat(text).catch(() => undefined);
  };

  return (
    <div className={`game-chat ${open ? "game-chat--open" : ""}`} data-testid="game-chat">
      <button
        type="button"
        className="game-chat-toggle"
        aria-expanded={open}
        aria-label={open ? "Close chat" : unread > 0 ? `Open chat, ${unread} unread` : "Open chat"}
        onClick={() => setOpen(!open)}
      >
        <span aria-hidden="true">💬</span>
        <span>Chat</span>
        {unread > 0 && (
          <span className="game-chat-badge" aria-hidden="true">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="game-chat-panel">
          <ul className="chat-log" ref={logRef} data-testid="game-chat-log">
            {chat.length === 0 && <li className="hint">No messages yet — say something.</li>}
            {chat.map((m, i) => (
              <li key={i}>
                <strong>{m.from.name}:</strong> {m.text}
              </li>
            ))}
          </ul>
          <div className="chat-row">
            <input
              ref={inputRef}
              value={draft}
              maxLength={MAX_CHAT_LENGTH}
              placeholder="Message…"
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
