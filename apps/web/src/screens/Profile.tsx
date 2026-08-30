/**
 * Profile: who you are across games — display name, avatar (card-art-style
 * set), stats, and the guest→account upgrade path (Google or magic link).
 * Deleting the account scrubs your match history server-side.
 */
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AVATARS, MAX_NAME_LENGTH } from "@deckxi/shared";
import { authClient, ensureSession } from "../lib/auth.js";
import { fetchProfile, type Profile } from "../lib/api.js";
import { Avatar, DEFAULT_EDITION_ID, statName } from "@deckxi/ui";
import { savePlayerName } from "../lib/session.js";

export function ProfileScreen() {
  const navigate = useNavigate();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [pickingAvatar, setPickingAvatar] = useState(false);
  const [email, setEmail] = useState("");
  const [linkSent, setLinkSent] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

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

  const signInGoogle = async () => {
    setBusy("google");
    try {
      await authClient.signIn.social({ provider: "google", callbackURL: "/profile" });
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
        callbackURL: "/profile",
      });
      if (sendError == null) setLinkSent(true);
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
      <main className="screen profile">
        <ScreenHead />
        <p className="notice">{error}</p>
      </main>
    );
  }
  if (profile === null) {
    return (
      <main className="screen profile">
        <ScreenHead />
        <p className="hint">Loading…</p>
      </main>
    );
  }

  const { user, stats } = profile;
  const winRate = stats.games === 0 ? null : Math.round((stats.wins / stats.games) * 100);

  return (
    <main className="screen profile">
      <ScreenHead />

      <div className="panel profile-card">
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

      {user.isAnonymous ? (
        <div className="panel">
          <h2>Save your progress</h2>
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
      ) : (
        <div className="panel">
          <h2>Account</h2>
          <div className="profile-actions">
            <button
              type="button"
              className="button"
              disabled={busy !== null}
              onClick={() => void signOut()}
            >
              {busy === "signout" ? "Signing out…" : "Sign out"}
            </button>
          </div>
        </div>
      )}

      <div className="panel">
        <h2>Privacy</h2>
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
    </main>
  );
}

function ScreenHead() {
  return (
    <div className="screen-head">
      <Link to="/" className="brand brand--small" style={{ textDecoration: "none" }}>
        Deck<span className="brand-xi">XI</span>
      </Link>
      <h2 style={{ margin: 0 }}>Profile</h2>
    </div>
  );
}
