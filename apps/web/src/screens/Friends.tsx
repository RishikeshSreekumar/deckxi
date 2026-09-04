/**
 * Friends and recent players (#82).
 *
 * A friend here is someone you saved, not someone who accepted you. There is
 * no request to send, nothing to decline, and saving somebody grants them
 * nothing — the invite link is still the only way into a room. The list is a
 * convenience: the people you play with, in one place, with a share sheet
 * that puts a room code in front of them in one tap.
 */
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Avatar } from "@deckxi/ui";
import { ensureSession } from "../lib/auth.js";
import { addFriend, fetchFriends, removeFriend, type PlayerSummary } from "../lib/api.js";
import { AppBar } from "../components/Chrome.js";

function ago(iso: string | null | undefined): string {
  if (iso == null) return "";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  return new Date(iso).toLocaleDateString();
}

export function FriendsScreen() {
  const [friends, setFriends] = useState<PlayerSummary[] | null>(null);
  const [recent, setRecent] = useState<PlayerSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    void ensureSession()
      .then(fetchFriends)
      .then((data) => {
        setFriends(data.friends);
        setRecent(data.recent);
      })
      .catch(() => setError("Couldn't load your players — is the server up?"));
  }, []);

  useEffect(load, [load]);

  const save = (player: PlayerSummary) => {
    void addFriend(player.userId)
      .then(load)
      .catch(() => setError("Couldn't save them just now."));
  };

  const forget = (player: PlayerSummary) => {
    void removeFriend(player.userId)
      .then(load)
      .catch(() => setError("Couldn't remove them just now."));
  };

  const row = (player: PlayerSummary, action: React.ReactNode) => (
    <li key={player.userId} className="panel friend-row">
      <Avatar image={player.image} name={player.name} size={34} />
      <div className="friend-detail">
        <strong>{player.name}</strong>
        {player.lastPlayedAt != null && (
          <span className="hint">played {ago(player.lastPlayedAt)}</span>
        )}
      </div>
      {action}
    </li>
  );

  return (
    <main className="screen friends">
      <AppBar title="Players" back />

      {error !== null && <p className="notice">{error}</p>}
      {error === null && friends === null && <p className="hint">Loading…</p>}

      {friends !== null && (
        <>
          <h2 className="panel-title">Friends</h2>
          {friends.length === 0 ? (
            <div className="panel">
              <p className="hint">
                Nobody saved yet. Play a game and the people at the table show up below.
              </p>
            </div>
          ) : (
            <ul className="friend-list" data-testid="friends">
              {friends.map((player) =>
                row(
                  player,
                  <button
                    type="button"
                    className="button button--ghost button--sm"
                    onClick={() => forget(player)}
                  >
                    Remove
                  </button>,
                ),
              )}
            </ul>
          )}

          <h2 className="panel-title">Recent players</h2>
          {recent.length === 0 ? (
            <div className="panel">
              <p className="hint">
                <Link to="/">Play a game</Link> and whoever you played shows up here.
              </p>
            </div>
          ) : (
            <ul className="friend-list" data-testid="recent-players">
              {recent.map((player) =>
                row(
                  player,
                  player.isFriend ? (
                    <span className="hint">Saved</span>
                  ) : (
                    <button
                      type="button"
                      className="button button--sm"
                      data-testid={`save-${player.userId}`}
                      onClick={() => save(player)}
                    >
                      Save
                    </button>
                  ),
                ),
              )}
            </ul>
          )}
        </>
      )}

      <p className="hint">
        Saving someone is just a note to yourself — they aren't told, and it gives them no way into
        your games. Invite links still do that.
      </p>
    </main>
  );
}
