/**
 * Live ops controls (#70): the maintenance banner and the per-mode kill
 * switch, both of which take effect on the running server without a deploy —
 * which matters because a deploy is exactly what ends every live game.
 *
 * The notice is a two-step: type, then Broadcast. No auto-save, no debounce —
 * a control that shows every player what you are typing as you type it is a
 * control nobody will use.
 */
import { useEffect, useState } from "react";
import { GAME_MODES } from "@deckxi/shared";
import { fetchAdminFlags, saveAdminFlags, type OpsFlags } from "../lib/admin.js";

/** Every mode the engine registers gets a switch; a new mode is never dark by default. */
const MODES: readonly string[] = GAME_MODES;

export function AdminOps() {
  const [flags, setFlags] = useState<OpsFlags | null>(null);
  const [text, setText] = useState("");
  const [level, setLevel] = useState<"info" | "warning">("info");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchAdminFlags()
      .then(({ flags: loaded }) => {
        setFlags(loaded);
        setText(loaded.notice?.text ?? "");
        setLevel(loaded.notice?.level ?? "info");
      })
      .catch(() => setFlags(null));
  }, []);

  const apply = (patch: Partial<OpsFlags>): void => {
    setBusy(true);
    saveAdminFlags(patch)
      .then(({ flags: next }) => setFlags(next))
      .catch(() => undefined)
      .finally(() => setBusy(false));
  };

  return (
    <section className="panel admin-ops" data-testid="admin-ops">
      <h3 className="admin-feed-title">Live ops</h3>

      <label className="admin-field">
        <span className="hint">Maintenance notice — everyone connected sees this</span>
        <input
          type="text"
          value={text}
          maxLength={200}
          placeholder="Back in ten minutes."
          onChange={(e) => setText(e.target.value)}
        />
      </label>

      <div className="update-bar-actions">
        <select
          value={level}
          aria-label="Notice level"
          onChange={(e) => setLevel(e.target.value as "info" | "warning")}
        >
          <option value="info">Info</option>
          <option value="warning">Warning</option>
        </select>
        <button
          type="button"
          className="button button--primary button--sm"
          disabled={busy || text.trim().length === 0}
          onClick={() => apply({ notice: { text: text.trim(), level } })}
        >
          Broadcast
        </button>
        <button
          type="button"
          className="button button--ghost button--sm"
          disabled={busy || flags?.notice == null}
          onClick={() => {
            setText("");
            apply({ notice: null });
          }}
        >
          Clear
        </button>
      </div>

      <p className="hint" style={{ margin: 0 }}>
        {flags?.notice == null ? "No notice showing." : `Showing: “${flags.notice.text}”`}
      </p>

      <div className="admin-modes">
        {MODES.map((mode) => {
          const enabled = flags?.modes[mode] !== false;
          return (
            <button
              key={mode}
              type="button"
              className={`button button--sm ${enabled ? "" : "button--danger"}`}
              disabled={busy || flags === null}
              onClick={() => apply({ modes: { ...flags?.modes, [mode]: !enabled } })}
            >
              {mode}: {enabled ? "on" : "off"}
            </button>
          );
        })}
      </div>
      <p className="hint" style={{ margin: 0 }}>
        A switched-off mode stops new rooms and stops lobbies starting. Games already running are
        left alone — pulling the rug mid-match is worse than the bug you are switching off for.
      </p>
    </section>
  );
}
