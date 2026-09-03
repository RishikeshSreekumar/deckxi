/**
 * Profile and settings (mockup turn 7's settings screen): who you are across
 * games — display name, avatar (card-art-style set), stats — plus the device
 * settings (sounds), and the guest→account upgrade path (Google or
 * magic link). Deleting the account scrubs your match history server-side.
 */
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { AVATARS, MAX_NAME_LENGTH } from "@deckxi/shared";
import { authClient, ensureSession } from "../lib/auth.js";
import { fetchProfile, type Profile } from "../lib/api.js";
import { Avatar, DEFAULT_EDITION_ID, statName } from "@deckxi/ui";
import { savePlayerName } from "../lib/session.js";
import { AppBar } from "../components/Chrome.js";
import { isMuted, setMuted } from "../lib/sounds.js";

export function ProfileScreen() {
  const navigate = useNavigate();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [pickingAvatar, setPickingAvatar] = useState(false);
  const [email, setEmail] = useState("");
  const [linkSent, setLinkSent] = useState(false);
  /** Separate from `error`, which replaces the whole screen (#93). */
  const [linkError, setLinkError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [muted, setLocalMuted] = useState(isMuted());

  const reload = useCallback(async () => {
    try {
      const data = await fetchProfile();
      setProfile(data);
      setName(data.user.name);
      setError(null);
    } catch {
      setError("Couldn't load your profile — is the server up?");
    }
  }, []);

  useEffect(() => {
    void ensureSession().then(reload);
  }, [reload]);

  // Landed here from the provider's error redirect (errorCallbackURL below).
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    if (params.get("auth") !== "failed") return;
    setLinkError("Google sign-in didn't complete — try again, or use a magic link.");
    setParams({}, { replace: true });
  }, [params, setParams]);

  const saveName = async () => {
    const trimmed = name.trim();
    if (trimmed.length === 0 || profile === null || trimmed === profile.user.name) return;
    setSavingName(true);
    try {
      await authClient.updateUser({ name: trimmed });
      savePlayerName(trimmed); // prefills the landing form
      await reload();
    } finally {
      setSavingName(false);
    }
  };

  const pickAvatar = async (id: string) => {
    setPickingAvatar(false);
    await authClient.updateUser({ image: id });
    await reload();
  };

  // better-auth resolves a relative callbackURL against *its* baseURL — the
  // API origin — so "/profile" would land on the API's 404 page. Both the
  // success and the error redirect need the web origin spelled out.
  const returnTo = `${window.location.origin}/profile`;

  const signInGoogle = async () => {
    setBusy("google");
    try {
      await authClient.signIn.social({
        provider: "google",
        callbackURL: returnTo,
        errorCallbackURL: `${returnTo}?auth=failed`,
      });
    } finally {
      setBusy(null);
    }
  };

  const sendMagicLink = async () => {
    if (!email.includes("@")) return;
    setBusy("magic");
    try {
      const { error: sendError } = await authClient.signIn.magicLink({
        email: email.trim(),
        callbackURL: returnTo,
      });
      // Delivery can genuinely fail (#93). Saying so beats "check your inbox"
      // for an email that is never coming.
      setLinkSent(sendError == null);
      setLinkError(
        sendError == null ? null : "Couldn't send the link — try Google, or try again later.",
      );
    } finally {
      setBusy(null);
    }
  };

  const signOut = async () => {
    setBusy("signout");
    try {
      await authClient.signOut();
      await ensureSession(); // fresh guest identity
      await reload();
    } finally {
      setBusy(null);
    }
  };

  const deleteAccount = async () => {
    setBusy("delete");
    try {
      await authClient.deleteUser();
      await ensureSession();
      navigate("/");
    } finally {
      setBusy(null);
    }
  };

  if (error !== null) {
    return (
      <main className="screen settings">
        <ScreenHead />
        <p className="notice">{error}</p>
      </main>
    );
  }
  if (profile === null) {
    return (
      <main className="screen settings">
        <ScreenHead />
        <p className="hint">Loading…</p>
      </main>
    );
  }

  const { user, stats } = profile;
  const winRate = stats.games === 0 ? null : Math.round((stats.wins / stats.games) * 100);

  return (
    <main className="screen settings">
      <ScreenHead />

      <section className="settings-section">
        <span className="label">Account</span>
        <div className="panel panel--flat profile-card">
          <div className="profile-identity">
            <button
              type="button"
              className="avatar-button"
              onClick={() => setPickingAvatar((v) => !v)}
              aria-label="Change avatar"
            >
              <Avatar image={user.image} name={user.name} size={64} />
              <span className="avatar-edit">edit</span>
            </button>
            <div className="profile-name">
              <label className="field">
                <span>Display name</span>
                <div className="join-row">
                  <input
                    value={name}
                    maxLength={MAX_NAME_LENGTH}
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void saveName();
                    }}
                  />
                  <button
                    type="button"
                    className="button"
                    disabled={savingName || name.trim() === user.name || name.trim().length === 0}
                    onClick={() => void saveName()}
                  >
                    {savingName ? "Saving…" : "Save"}
                  </button>
                </div>
              </label>
              {user.isAnonymous ? (
                <p className="hint">Playing as a guest on this device.</p>
              ) : (
                <p className="hint">Signed in as {user.email}</p>
              )}
            </div>
          </div>

          {pickingAvatar && (
            <div className="avatar-grid" role="listbox" aria-label="Pick an avatar">
              {AVATARS.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  className={`avatar-choice${a.id === user.image ? " avatar-choice--current" : ""}`}
                  title={a.label}
                  onClick={() => void pickAvatar(a.id)}
                >
                  <Avatar image={a.id} name={a.label} size={48} />
                </button>
              ))}
            </div>
          )}

          <div className="stats-row">
            <div className="stat-tile">
              <strong>{stats.games}</strong>
              <span>games</span>
            </div>
            <div className="stat-tile">
              <strong>{stats.wins}</strong>
              <span>wins</span>
            </div>
            <div className="stat-tile">
              <strong>{winRate === null ? "—" : `${winRate}%`}</strong>
              <span>win rate</span>
            </div>
            <div className="stat-tile">
              <strong>
                {stats.favouriteStat === null
                  ? "—"
                  : statName(DEFAULT_EDITION_ID, stats.favouriteStat)}
              </strong>
              <span>favourite stat</span>
            </div>
          </div>

          <Link className="button" to="/history">
            Match history
          </Link>
        </div>
      </section>

      <section className="settings-section">
        <span className="label">This device</span>
        <div className="panel panel--flat settings-rows">
          <div className="setting-row">
            <span>Sounds</span>
            <button
              type="button"
              role="switch"
              aria-checked={!muted}
              aria-label="Sounds"
              className={`toggle${muted ? "" : " toggle--on"}`}
              onClick={() => {
                setMuted(!muted);
                setLocalMuted(!muted);
              }}
            >
              <span className="toggle-knob" />
            </button>
          </div>
        </div>
      </section>

      {user.isAnonymous ? (
        <section className="settings-section">
          <span className="label">Save your progress</span>
          <div className="panel panel--flat">
            <p className="hint">
              Sign in to keep your handle, stats and match history across devices. Your games as a
              guest carry over.
            </p>
            <button
              type="button"
              className="button button--primary"
              disabled={busy !== null}
              onClick={() => void signInGoogle()}
            >
              {busy === "google" ? "Redirecting…" : "Continue with Google"}
            </button>
            <div className="divider">
              <span>or get a magic link</span>
            </div>
            {linkError !== null && (
              <p className="notice" role="alert">
                {linkError}
              </p>
            )}
            {linkSent ? (
              <p className="notice" role="status">
                Check your email — the sign-in link is on its way.
              </p>
            ) : (
              <div className="join-row">
                <input
                  type="email"
                  value={email}
                  placeholder="you@example.com"
                  autoComplete="email"
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void sendMagicLink();
                  }}
                />
                <button
                  type="button"
                  className="button"
                  disabled={busy !== null || !email.includes("@")}
                  onClick={() => void sendMagicLink()}
                >
                  {busy === "magic" ? "Sending…" : "Send link"}
                </button>
              </div>
            )}
          </div>
        </section>
      ) : (
        <section className="settings-section">
          <div className="profile-actions">
            <button
              type="button"
              className="button button--danger"
              disabled={busy !== null}
              onClick={() => void signOut()}
            >
              {busy === "signout" ? "Signing out…" : "Sign out"}
            </button>
          </div>
        </section>
      )}

      <section className="settings-section">
        <span className="label">Privacy</span>
        <div className="panel panel--flat">
          <p className="hint">
            We store very little about you — see <Link to="/privacy">what and why</Link>.
          </p>
          {confirmDelete ? (
            <div className="profile-actions">
              <p className="notice">
                This permanently deletes your account and unlinks your match history. There is no
                undo.
              </p>
              <button
                type="button"
                className="button button--danger"
                disabled={busy !== null}
                onClick={() => void deleteAccount()}
              >
                {busy === "delete" ? "Deleting…" : "Yes, delete my account"}
              </button>
              <button type="button" className="button" onClick={() => setConfirmDelete(false)}>
                Keep it
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="button button--ghost"
              onClick={() => setConfirmDelete(true)}
            >
              Delete my account
            </button>
          )}
        </div>
      </section>
    </main>
  );
}

function ScreenHead() {
  return <AppBar title="Settings" back />;
}
