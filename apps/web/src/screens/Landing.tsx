/**
 * Landing: host a table or join one with a code (mockup turn 7). Two pieces
 * side by side on a desktop, stacked on a phone, under one "Start playing"
 * heading. Visiting an invite link (`/join/CODE`) opens an invitation sheet
 * over it — the code, your name, one Join button — because someone who
 * followed a link was invited to one table and should not be asked to
 * choose between hosting and joining.
 */
import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { JOIN_CODE_LENGTH, MAX_NAME_LENGTH, type RoomClosedReason } from "@deckxi/shared";
import { useStore } from "../store/store.js";
import { AckError } from "../lib/socket.js";
import { loadPlayerName } from "../lib/session.js";
import { fetchProfile, type ProfileUser } from "../lib/api.js";
import { ensureSession } from "../lib/auth.js";
import { Avatar, Dialog, RoomCode } from "@deckxi/ui";
import { AppBar, CodeSlots } from "../components/Chrome.js";

const CLOSED_COPY: Record<RoomClosedReason, string> = {
  "host-left": "The host left, so the table closed.",
  idle: "The table closed after sitting idle.",
  "server-shutdown": "The server restarted and closed the table.",
  // Operator actions (#70). Said plainly: a player who was removed deserves
  // to know it happened rather than to wonder what broke.
  "closed-by-admin": "That table was closed by a moderator.",
  kicked: "You were removed from that table by a moderator.",
};

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
  const [me, setMe] = useState<ProfileUser | null>(null);
  // The invitation sheet: open on arrival from a link, closed by joining or
  // by "not now", which drops back to the page with the code kept.
  const [invite, setInvite] = useState(
    linkCode !== undefined && linkCode.length === JOIN_CODE_LENGTH,
  );
  const joinRef = useRef<HTMLButtonElement>(null);
  const inviteNameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!invite) return;
    // A returning player has a name; put them on the button. A new one
    // needs to type first.
    if (loadPlayerName() !== "") joinRef.current?.focus();
    else inviteNameRef.current?.focus();
  }, [invite]);

  const declineInvite = () => {
    setInvite(false);
    history.replaceState(null, "", "/");
  };

  // Who am I? Fills the name from the account (generated cricket handle for
  // fresh guests) and shows the profile chip. Best-effort — offline is fine.
  useEffect(() => {
    let cancelled = false;
    void ensureSession()
      .then(fetchProfile)
      .then(({ user }) => {
        if (cancelled) return;
        setMe(user);
        setName((current) => (current === "" ? user.name : current));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const canSubmit = name.trim().length > 0 && busy === null && connection === "online";
  const codeComplete = code.trim().length === JOIN_CODE_LENGTH;

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

  const nameField = (ref?: React.RefObject<HTMLInputElement | null>) => (
    <label className="field">
      <span>Your name</span>
      <input
        {...(ref !== undefined ? { ref } : {})}
        value={name}
        maxLength={MAX_NAME_LENGTH}
        placeholder="e.g. CoverDrive"
        autoComplete="nickname"
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && invite && canSubmit && codeComplete) void doJoin(false);
        }}
      />
    </label>
  );

  const spectateOffer = offerSpectate && (
    <button type="button" className="button button--ghost" onClick={() => void doJoin(true)}>
      Table is full — watch as a spectator
    </button>
  );

  return (
    <main className="screen landing">
      <AppBar>
        <Link to="/profile" className="profile-chip" aria-label="Your profile">
          {me !== null ? (
            <>
              <span className="profile-chip-name">{me.name}</span>
              <Avatar image={me.image} name={me.name} size={34} />
            </>
          ) : (
            <span className="profile-chip-name">Profile</span>
          )}
        </Link>
      </AppBar>

      <div className="landing-body">
        <div className="landing-intro">
          <h1 className="headline">Start playing</h1>
          <p className="sub">Host a table for your group, or drop into one with a code.</p>
        </div>

        {roomClosedReason !== null && (
          <p className="notice" role="status">
            {CLOSED_COPY[roomClosedReason]}
          </p>
        )}

        {!invite && (
          <div className="landing-grid">
            <section className="panel landing-host" aria-labelledby="host-title">
              <h2 className="panel-title" id="host-title">
                Host a table
              </h2>
              <p className="sub">Pick the rules once you're in, then send the code.</p>
              {nameField()}
              <button
                type="button"
                className="button button--primary button--block landing-cta"
                disabled={!canSubmit}
                onClick={() => {
                  setBusy("create");
                  void createRoom(name.trim())
                    .then(() => history.replaceState(null, "", "/"))
                    .catch(() => undefined)
                    .finally(() => setBusy(null));
                }}
              >
                {busy === "create" ? "Creating…" : "Create table"}
              </button>
            </section>

            <section className="panel landing-join" aria-labelledby="join-title">
              <h2 className="panel-title" id="join-title">
                Join with a code
              </h2>
              <CodeSlots
                value={code}
                onChange={setCode}
                onSubmit={() => {
                  if (canSubmit && codeComplete) void doJoin(false);
                }}
              />
              <p className="sub">Six characters, from whoever invited you.</p>
              <button
                type="button"
                className="button button--block landing-cta"
                disabled={!canSubmit || !codeComplete}
                onClick={() => void doJoin(false)}
              >
                {busy === "join" ? "Joining…" : "Join table"}
              </button>
              {spectateOffer}
            </section>
          </div>
        )}

        {invite && (
          <Dialog title="You're invited" onClose={declineInvite}>
            <div className="invite-sheet" data-testid="invite-sheet">
              <p className="sub">Someone sent you a link to their table.</p>
              <RoomCode code={code} />
              {nameField(inviteNameRef)}
              <button
                ref={joinRef}
                type="button"
                className="button button--primary button--block landing-cta"
                disabled={!canSubmit || !codeComplete}
                onClick={() => void doJoin(false)}
              >
                {busy === "join"
                  ? "Joining…"
                  : connection !== "online"
                    ? "Connecting…"
                    : "Join table"}
              </button>
              {spectateOffer}
              <button type="button" className="button button--ghost" onClick={declineInvite}>
                Not now
              </button>
            </div>
          </Dialog>
        )}

        {connection !== "online" ? (
          <p className="sub landing-foot">Waiting for the server…</p>
        ) : (
          me !== null && <p className="sub landing-foot">Signed in as {me.name}</p>
        )}
      </div>
    </main>
  );
}
