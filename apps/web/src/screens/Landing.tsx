/**
 * Landing: host a table or join one with a code (mockup turn 7). Two pieces
 * side by side on a desktop, stacked on a phone, under one "Start playing"
 * heading. Visiting an invite link (`/join/CODE`) opens an invitation sheet
 * over it — the code, your name, one Join button — because someone who
 * followed a link was invited to one table and should not be asked to
 * choose between hosting and joining.
 */
import { useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { JOIN_CODE_LENGTH, MAX_NAME_LENGTH, type RoomClosedReason } from "@deckxi/shared";
import { useStore } from "../store/store.js";
import { AckError } from "../lib/socket.js";
import { loadPlayerName } from "../lib/session.js";
import { fetchProfile, type ProfileUser } from "../lib/api.js";
import { solveCaptcha } from "../lib/captcha.js";
import { authClient, ensureSession } from "../lib/auth.js";
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
  const [params] = useSearchParams();
  // The manifest's "Create a room" shortcut lands here as `/?new=1`. A
  // shortcut that only shows the same landing page is a lie, so it hosts a
  // table for you.
  const shortcutNewRoom = params.get("new") === "1";
  const createRoom = useStore((s) => s.createRoom);
  const practiceGame = useStore((s) => s.practiceGame);
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
  // The challenge sheet (#87): open only when the server has asked for one.
  // `retry` is the action that was refused, resumed with a solved token.
  const [challenge, setChallenge] = useState<((token: string) => Promise<void>) | null>(null);
  const [challengeError, setChallengeError] = useState<string | null>(null);
  const challengeRef = useRef<HTMLDivElement>(null);
  const hostNameRef = useRef<HTMLInputElement>(null);
  const shortcutFired = useRef(false);
  const inviteNameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!invite) return;
    // A returning player has a name; put them on the button. A new one
    // needs to type first.
    if (loadPlayerName() !== "") joinRef.current?.focus();
    else inviteNameRef.current?.focus();
  }, [invite]);

  // Turnstile renders into a real element, so it waits for the sheet to mount.
  useEffect(() => {
    const container = challengeRef.current;
    if (challenge === null || container === null) return;
    let cancelled = false;
    void solveCaptcha(container)
      .then(async (token) => {
        if (cancelled) return;
        setChallenge(null);
        await challenge(token);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setChallengeError(error instanceof Error ? error.message : "The challenge failed.");
      });
    return () => {
      cancelled = true;
    };
  }, [challenge]);

  const declineInvite = () => {
    setInvite(false);
    history.replaceState(null, "", "/");
  };

  // Who am I? The account's display name (generated cricket handle for fresh
  // guests, whatever you set on the profile screen since) is the name at the
  // table, so it replaces the copy this browser last remembered — unless you
  // have already started typing, which is never overwritten. Shows the
  // profile chip too. Best-effort — offline is fine.
  useEffect(() => {
    let cancelled = false;
    const remembered = loadPlayerName();
    void ensureSession()
      .then(fetchProfile)
      .then(({ user }) => {
        if (cancelled) return;
        setMe(user);
        setName((current) => (current === remembered ? user.name : current));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const canSubmit = name.trim().length > 0 && busy === null && connection === "online";
  const codeComplete = code.trim().length === JOIN_CODE_LENGTH;

  /**
   * The server seats you under your account's display name, so a name typed
   * here becomes that display name first — one name everywhere, not one on
   * the profile and another at the table. Best-effort: if the update fails
   * the server still has the last saved one.
   */
  const commitName = async (): Promise<string> => {
    const trimmed = name.trim();
    // `me` may still be loading if you were quick; the session is what
    // matters, and the update is a no-op when the name already matches.
    if (me === null || trimmed !== me.name) {
      try {
        await ensureSession();
        await authClient.updateUser({ name: trimmed });
        setMe((current) => (current === null ? current : { ...current, name: trimmed }));
      } catch {
        /* offline / signed out — the server falls back to what it has */
      }
    }
    return trimmed;
  };

  /**
   * A refused-for-CAPTCHA action is not an error the player can act on by
   * reading a toast, so it opens the challenge instead and replays itself
   * with the token. Anything else is already reported by the store.
   */
  const withChallenge = async (run: (token?: string) => Promise<void>): Promise<void> => {
    try {
      await run();
    } catch (error) {
      if (error instanceof AckError && error.code === "captcha-required") {
        setChallengeError(null);
        setChallenge(() => async (token: string) => {
          await run(token);
        });
        return;
      }
      /* every other failure is already a toast from the store */
    }
  };

  const hostTable = async (captchaToken?: string) => {
    setBusy("create");
    try {
      await createRoom(await commitName(), captchaToken);
      history.replaceState(null, "", "/");
    } finally {
      setBusy(null);
    }
  };

  /**
   * Home-screen shortcut: host straight away. It waits for the socket and for
   * a name — a fresh install has neither on the first frame — and fires once,
   * so a failed attempt does not loop. With no name to use we focus the field
   * instead of guessing one.
   */
  useEffect(() => {
    if (!shortcutNewRoom || shortcutFired.current || invite) return;
    if (name.trim() === "") {
      hostNameRef.current?.focus();
      return;
    }
    if (connection !== "online" || busy !== null) return;
    shortcutFired.current = true;
    void withChallenge((token) => hostTable(token));
    // hostTable closes over the current name; re-running on every keystroke is
    // exactly what we want until it fires.
    // hostTable is intentionally not a dependency: it is redefined every
    // render, and the ref guard is what makes this fire once.
  }, [shortcutNewRoom, invite, name, connection, busy]);

  const doJoin = async (spectator: boolean, captchaToken?: string) => {
    setBusy("join");
    setOfferSpectate(false);
    try {
      await joinRoom(code.trim().toUpperCase(), await commitName(), spectator, captchaToken);
      history.replaceState(null, "", "/");
    } catch (error) {
      if (error instanceof AckError && error.code === "room-full") setOfferSpectate(true);
      throw error;
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
          if (e.key === "Enter" && invite && canSubmit && codeComplete)
            void withChallenge((token) => doJoin(false, token));
        }}
      />
    </label>
  );

  const spectateOffer = offerSpectate && (
    <button
      type="button"
      className="button button--ghost"
      onClick={() => void withChallenge((token) => doJoin(true, token))}
    >
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
              {nameField(hostNameRef)}
              <button
                type="button"
                className="button button--primary button--block landing-cta"
                disabled={!canSubmit}
                onClick={() => void withChallenge((token) => hostTable(token))}
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
                  if (canSubmit && codeComplete)
                    void withChallenge((token) => doJoin(false, token));
                }}
              />
              <p className="sub">Six characters, from whoever invited you.</p>
              <button
                type="button"
                className="button button--block landing-cta"
                disabled={!canSubmit || !codeComplete}
                onClick={() => void withChallenge((token) => doJoin(false, token))}
              >
                {busy === "join" ? "Joining…" : "Join table"}
              </button>
              {spectateOffer}
            </section>
          </div>
        )}

        {!invite && (
          <section className="panel landing-practice" aria-labelledby="practice-title">
            <h2 className="panel-title" id="practice-title">
              Practice on your own
            </h2>
            <p className="sub">
              Two bots, no room, no connection needed — good for a train tunnel.
            </p>
            <button
              type="button"
              className="button button--block"
              data-testid="practice"
              disabled={name.trim().length === 0 || busy !== null}
              onClick={() => {
                setBusy("create");
                void practiceGame({ gameMode: "classic-trumps", name: name.trim() }).finally(() =>
                  setBusy(null),
                );
              }}
            >
              Play against bots
            </button>
          </section>
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
                onClick={() => void withChallenge((token) => doJoin(false, token))}
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

        {challenge !== null && (
          <Dialog title="Quick check" onClose={() => setChallenge(null)}>
            <div className="invite-sheet" data-testid="captcha-sheet">
              <p className="sub">
                A lot of wrong codes have come from this connection, so we need to know you're a
                person. This takes a second and only happens once.
              </p>
              <div ref={challengeRef} />
              {challengeError !== null && (
                <p className="notice" role="alert">
                  {challengeError}
                </p>
              )}
              <button
                type="button"
                className="button button--ghost"
                onClick={() => setChallenge(null)}
              >
                Cancel
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
