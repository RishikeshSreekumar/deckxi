/**
 * The lobby's invite sheet: code, link, share, the QR for a phone across the
 * table, and your saved players. Lazy — it is one tap in, and it pulls the
 * QR encoder and the friends list with it.
 */
import { useEffect, useState } from "react";
import { Avatar, Dialog, RoomCode } from "@deckxi/ui";
import { fetchFriends, type PlayerSummary } from "../lib/api.js";
import { inviteUrl, useCopy } from "../lib/copy.js";

/** The invite sheet: code, link, share, and the QR for a phone across the table. */
export function InviteDialog({ code, onClose }: { code: string; onClose: () => void }) {
  const [qr, setQr] = useState<string | null>(null);
  const [friends, setFriends] = useState<PlayerSummary[]>([]);
  const url = inviteUrl(code);
  const { copied, copy } = useCopy(url);
  const message = `Join my DeckXI table — code ${code}. ${url}`;

  // Your saved players (#82), so inviting the people you actually play with
  // is one tap rather than a hunt through a chat app. Best-effort: signed out
  // or offline, the sheet is exactly what it was.
  useEffect(() => {
    let cancelled = false;
    void fetchFriends()
      .then((data) => {
        if (!cancelled) setFriends(data.friends);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

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
              void navigator
                .share({ title: "Play DeckXI", text: message, url })
                .catch(() => undefined)
            }
          >
            Share
          </button>
        )}
      </div>

      {friends.length > 0 && (
        <div className="invite-friends" data-testid="invite-friends">
          <span className="label">Your players</span>
          <ul className="friend-list">
            {friends.slice(0, 5).map((friend) => (
              <li key={friend.userId} className="friend-row">
                <Avatar image={friend.image} name={friend.name} size={28} />
                <div className="friend-detail">
                  <strong>{friend.name}</strong>
                </div>
                <button
                  type="button"
                  className="button button--sm"
                  onClick={() => {
                    // No push channel exists, and inventing one for an invite
                    // would be a notification nobody asked for: this hands the
                    // message to whatever app they already talk in.
                    const share = navigator.share?.bind(navigator);
                    if (share !== undefined) {
                      void share({ title: `Invite ${friend.name}`, text: message, url }).catch(
                        () => undefined,
                      );
                      return;
                    }
                    void navigator.clipboard?.writeText(message).catch(() => undefined);
                  }}
                >
                  Invite
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <button type="button" className="button button--ghost" onClick={onClose}>
        Done
      </button>
    </Dialog>
  );
}
