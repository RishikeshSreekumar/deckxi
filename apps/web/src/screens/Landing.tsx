/**
 * Landing: pick a name, create a room, or join by code. Visiting an invite
 * link (`/join/CODE`) lands here with the code prefilled and focus on Join.
 */
import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { JOIN_CODE_LENGTH, MAX_NAME_LENGTH } from "@deckxi/shared";
import { useStore } from "../store/store.js";
import { AckError } from "../lib/socket.js";
import { loadPlayerName } from "../lib/session.js";

const CLOSED_COPY = {
  "host-left": "The host left, so the room closed.",
  idle: "The room closed after sitting idle.",
  "server-shutdown": "The server restarted and closed the room.",
} as const;

export function Landing() {
  const { code: linkCode } = useParams();
  const createRoom = useStore((s) => s.createRoom);
  const joinRoom = useStore((s) => s.joinRoom);
  const roomClosedReason = useStore((s) => s.roomClosedReason);
  const connection = useStore((s) => s.connection);

  const [name, setName] = useState(loadPlayerName());
  const [code, setCode] = useState(linkCode?.toUpperCase() ?? "");
  const [busy, setBusy] = useState<"create" | "join" | null>(null);
  const [offerSpectate, setOfferSpectate] = useState(false);
  const joinRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (linkCode !== undefined && loadPlayerName() !== "") joinRef.current?.focus();
  }, [linkCode]);

  const canSubmit = name.trim().length > 0 && busy === null && connection === "online";

  const doJoin = async (spectator: boolean) => {
    setBusy("join");
    setOfferSpectate(false);
    try {
      await joinRoom(code.trim().toUpperCase(), name.trim(), spectator);
      history.replaceState(null, "", "/");
    } catch (error) {
      if (error instanceof AckError && error.code === "room-full") setOfferSpectate(true);
    } finally {
      setBusy(null);
    }
  };

  return (
    <main className="screen landing">
      <div className="landing-hero">
        <h1 className="brand">
          Deck<span className="brand-xi">XI</span>
        </h1>
        <p className="tagline">Cricket trump cards — live with friends.</p>
      </div>

      {roomClosedReason !== null && (
        <p className="notice" role="status">
          {CLOSED_COPY[roomClosedReason]}
        </p>
      )}

      <div className="panel landing-form">
        <label className="field">
          <span>Your name</span>
          <input
            value={name}
            maxLength={MAX_NAME_LENGTH}
            placeholder="e.g. CoverDrive"
            autoComplete="nickname"
            onChange={(e) => setName(e.target.value)}
          />
        </label>

        <button
          type="button"
          className="button button--primary"
          disabled={!canSubmit}
          onClick={() => {
            setBusy("create");
            void createRoom(name.trim())
              .then(() => history.replaceState(null, "", "/"))
              .catch(() => undefined)
              .finally(() => setBusy(null));
          }}
        >
          {busy === "create" ? "Creating…" : "Create a room"}
        </button>

        <div className="divider">
          <span>or join with a code</span>
        </div>

        <div className="join-row">
          <input
            className="code-input"
            value={code}
            maxLength={JOIN_CODE_LENGTH}
            placeholder="ABC123"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            onKeyDown={(e) => {
              if (e.key === "Enter" && canSubmit && code.length === JOIN_CODE_LENGTH)
                void doJoin(false);
            }}
          />
          <button
            ref={joinRef}
            type="button"
            className="button"
            disabled={!canSubmit || code.trim().length !== JOIN_CODE_LENGTH}
            onClick={() => void doJoin(false)}
          >
            {busy === "join" ? "Joining…" : "Join"}
          </button>
        </div>

        {offerSpectate && (
          <button type="button" className="button button--ghost" onClick={() => void doJoin(true)}>
            Room is full — watch as a spectator
          </button>
        )}

        {connection !== "online" && <p className="hint">Waiting for the server…</p>}
      </div>
    </main>
  );
}
