/**
 * The Squad Draft table: three screens in one shell.
 *
 * Drafting — the pool as a scrollable list of rows (role, name, nation, the
 * three facet bars) with the pick button on the row when it is your turn;
 * filters by role and a sort so a phone can find "best bowler left" in one
 * tap; your squad and the nation cap in a drawer along the bottom.
 *
 * Building — your thirteen as a roster builder: tap a card into the XI, tap
 * the ball to make it a bowler, tap the gloves to make it the keeper, nudge
 * the batting order up and down. The engine's own validator says what is
 * still wrong; Auto XI fills a legal side the way a timeout would.
 *
 * Results — the reveal presenter: every match, phase by phase, scores landing
 * one at a time with the phase winner lit, then the table. Skippable, and
 * the Results screen waits for it to finish.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import "./squadDraft.css";
import {
  GAME_MODE_INFO,
  SQUAD_PHASE_INFO,
  type RoomView,
  type RosterView,
  type SquadMatchView,
} from "@deckxi/shared";
import {
  autoRoster,
  facetScore,
  overall,
  roleOf,
  rosterProblem,
  type CardDefinition,
  type SquadDraftState,
} from "@deckxi/engine";
import { Dialog, RoleIcon, TrumpCard, getCardInfo } from "@deckxi/ui";
import type { PlayerRole } from "@deckxi/shared";
import { useStore } from "../store/store.js";
import { MuteButton } from "../components/Chrome.js";
import { LeagueTable } from "../components/LeagueTable.js";
import { GameChat } from "../components/GameChat.js";
import { sounds } from "../lib/sounds.js";
import { haptics } from "../lib/haptics.js";
import {
  currentPick,
  legalPicks,
  nationCounts,
  onTheClock,
  type SquadClientState,
} from "../game/squadClient.js";

type RoleFilter = "all" | PlayerRole;
type SortKey = "overall" | "batting" | "bowling" | "fielding";

const ROLE_FILTERS: { key: RoleFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "batter", label: "Bat" },
  { key: "bowler", label: "Bowl" },
  { key: "all-rounder", label: "AR" },
  { key: "keeper", label: "WK" },
];
const SORTS: { key: SortKey; label: string }[] = [
  { key: "overall", label: "Overall" },
  { key: "batting", label: "Bat" },
  { key: "bowling", label: "Bowl" },
  { key: "fielding", label: "Field" },
];
const ROLE_SHORT: Record<string, string> = {
  batter: "BAT",
  bowler: "BOWL",
  "all-rounder": "AR",
  keeper: "WK",
};

/** How long each beat of the results reveal holds; the fixtures may freeze it. */
export const squadRevealTiming = { phaseMs: 1500, matchMs: 1200, tableMs: 2600 };

/**
 * The engine's roster helpers want its state shape. The wire config carries
 * everything they read (cards, stats, facets, the sizes); the seed and the
 * rest of the state are neither known nor needed here.
 */
function engineView(state: SquadClientState): SquadDraftState {
  return {
    config: { ...state.config, seed: 0 },
    phase: state.phase,
    pool: state.pool,
    pickOrder: state.pickOrder,
    pickIndex: state.pickIndex,
    squads: state.squads,
    active: state.active,
    rosters: {},
    form: null,
    league: null,
    winner: null,
  } as unknown as SquadDraftState;
}

function useCountdown(deadline: number | null): number | null {
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    if (deadline === null) {
      setLeft(null);
      return;
    }
    const read = () => setLeft(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    read();
    const id = setInterval(read, 200);
    return () => clearInterval(id);
  }, [deadline]);
  return left;
}

function Bar({ label, value }: { label: string; value: number }) {
  return (
    <span className="facet" aria-label={`${label} ${Math.round(value)}`}>
      <i>{label}</i>
      <b>
        <span style={{ width: `${Math.max(2, Math.min(100, value))}%` }} />
      </b>
      <em>{Math.round(value)}</em>
    </span>
  );
}

interface CardRowProps {
  card: CardDefinition;
  editionId: string;
  config: SquadClientState["config"];
  action?: React.ReactNode;
  note?: string | undefined;
  dim?: boolean;
  onOpen: (cardId: string) => void;
  extra?: React.ReactNode;
}

/** One card as a row: role, name, nation, the three bars. */
function CardRow({ card, editionId, config, action, note, dim, onOpen, extra }: CardRowProps) {
  const { player } = getCardInfo(editionId, card.id);
  const role = roleOf(card) as PlayerRole;
  return (
    <li className={`pool-row ${dim ? "pool-row--dim" : ""}`.trim()} data-testid={`pool-${card.id}`}>
      <button
        type="button"
        className="pool-row-main"
        onClick={() => onOpen(card.id)}
        aria-label={`View ${player?.name ?? card.id}`}
      >
        <span className={`pool-role pool-role--${role}`} aria-hidden="true">
          <RoleIcon role={role} />
          <small>{ROLE_SHORT[role] ?? role}</small>
        </span>
        <span className="pool-name">
          <strong>{player?.name ?? card.id}</strong>
          <span className="sub">
            {card.nation ?? "—"}
            {note !== undefined ? ` · ${note}` : ""}
          </span>
        </span>
        <span className="pool-facets">
          <Bar label="bat" value={facetScore(card, "batting", config)} />
          <Bar label="bowl" value={facetScore(card, "bowling", config)} />
          <Bar label="fld" value={facetScore(card, "fielding", config)} />
        </span>
      </button>
      {extra}
      {action}
    </li>
  );
}

function ScoreChip({
  name,
  count,
  tag,
  mine,
  out,
  hot,
}: {
  name: string;
  count: number;
  tag?: string | undefined;
  mine?: boolean;
  out?: boolean;
  hot?: boolean;
}) {
  return (
    <span
      className={[
        "score-chip",
        mine ? "score-chip--mine" : "",
        out ? "score-chip--out" : "",
        hot ? "score-chip--hot" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      aria-label={`${name}: ${count} cards${tag !== undefined ? `, ${tag}` : ""}`}
    >
      <span className="score-chip-name" aria-hidden="true">
        {name}
      </span>
      {tag !== undefined && (
        <span className="score-chip-tag" aria-hidden="true">
          {tag}
        </span>
      )}
      <span className="score-chip-count" aria-hidden="true">
        {count}
      </span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Drafting
// ---------------------------------------------------------------------------

function DraftBoard({
  state,
  selfId,
  spectator,
  names,
  onOpen,
}: {
  state: SquadClientState;
  selfId: string | null;
  spectator: boolean;
  names: Record<string, string>;
  onOpen: (cardId: string) => void;
}) {
  const command = useStore((s) => s.command);
  const [role, setRole] = useState<RoleFilter>("all");
  const [sort, setSort] = useState<SortKey>("overall");
  const [squadOpen, setSquadOpen] = useState(false);
  const [sending, setSending] = useState<string | null>(null);
  const { config } = state;
  const editionId = config.editionId;
  const picker = onTheClock(state);
  const yourPick = !spectator && selfId !== null && picker === selfId;
  const legal = useMemo(
    () => (selfId === null ? new Set<string>() : legalPicks(state, selfId)),
    [state, selfId],
  );
  const cards = useMemo(() => new Map(config.cards.map((c) => [c.id, c])), [config.cards]);

  useEffect(() => {
    setSending(null);
  }, [state.pickIndex]);

  const rows = useMemo(() => {
    const list = state.pool
      .map((id) => cards.get(id))
      .filter((c): c is CardDefinition => c !== undefined)
      .filter((c) => role === "all" || roleOf(c) === role);
    const score = (c: CardDefinition): number =>
      sort === "overall" ? overall(c, config) : facetScore(c, sort, config);
    return list.sort((a, b) => score(b) - score(a));
  }, [state.pool, cards, role, sort, config]);

  const mySquad = selfId === null ? [] : (state.squads[selfId] ?? []);
  const caps = selfId === null ? new Map<string, number>() : nationCounts(state, selfId);
  const full = [...caps.entries()].filter(([, n]) => n >= config.nationCap).map(([n]) => n);

  const pick = async (cardId: string) => {
    if (!yourPick || sending !== null) return;
    setSending(cardId);
    haptics.tap();
    try {
      await command({ type: "DRAFT_PICK", cardId });
    } catch {
      setSending(null);
    }
  };

  return (
    <>
      <div className="draft-tools">
        <div className="chip-row" role="radiogroup" aria-label="Filter by role">
          {ROLE_FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              role="radio"
              aria-checked={role === f.key}
              className={role === f.key ? "chip chip--on" : "chip"}
              onClick={() => setRole(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <label className="draft-sort">
          <span className="sub">Sort</span>
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
            {SORTS.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <ul className="pool-list" aria-label={`Pool (${state.pool.length} left)`} data-testid="pool">
        {rows.map((card) => {
          const capped = yourPick && !legal.has(card.id);
          return (
            <CardRow
              key={card.id}
              card={card}
              editionId={editionId}
              config={config}
              onOpen={onOpen}
              dim={capped}
              note={capped ? `${card.nation} cap reached` : undefined}
              action={
                yourPick ? (
                  <button
                    type="button"
                    className="button button--primary button--sm pool-pick"
                    disabled={capped || sending !== null}
                    data-testid={`pick-${card.id}`}
                    onClick={() => void pick(card.id)}
                  >
                    {sending === card.id ? "…" : "Pick"}
                  </button>
                ) : undefined
              }
            />
          );
        })}
        {rows.length === 0 && <li className="hint">Nothing left in that role.</li>}
      </ul>

      {!spectator && selfId !== null && (
        <section className={`squad-drawer ${squadOpen ? "squad-drawer--open" : ""}`.trim()}>
          <button
            type="button"
            className="squad-drawer-head"
            aria-expanded={squadOpen}
            onClick={() => setSquadOpen((v) => !v)}
          >
            <strong>
              Your squad {mySquad.length}/{config.squadSize}
            </strong>
            <span className="sub">
              {full.length > 0
                ? `Cap reached: ${full.join(", ")}`
                : `Max ${config.nationCap} per nation`}
            </span>
            <span aria-hidden="true">{squadOpen ? "▾" : "▴"}</span>
          </button>
          {squadOpen && (
            <ul className="squad-list" data-testid="your-squad">
              {mySquad.map((id) => {
                const card = cards.get(id);
                if (card === undefined) return null;
                return (
                  <CardRow
                    key={id}
                    card={card}
                    editionId={editionId}
                    config={config}
                    onOpen={onOpen}
                  />
                );
              })}
              {mySquad.length === 0 && <li className="hint">No picks yet.</li>}
            </ul>
          )}
        </section>
      )}

      {state.lastPick !== null && (
        <p className="draft-last sub" role="status">
          Pick {state.lastPick.pick}:{" "}
          {state.lastPick.playerId === selfId ? "you" : (names[state.lastPick.playerId] ?? "?")}{" "}
          took {getCardInfo(editionId, state.lastPick.cardId).player?.name ?? state.lastPick.cardId}
          {state.lastPick.auto ? " (auto)" : ""}.
        </p>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Building
// ---------------------------------------------------------------------------

function RosterBuilder({
  state,
  selfId,
  names,
  onOpen,
}: {
  state: SquadClientState;
  selfId: string;
  names: Record<string, string>;
  onOpen: (cardId: string) => void;
}) {
  const command = useStore((s) => s.command);
  const { config } = state;
  const editionId = config.editionId;
  const squad = state.squads[selfId] ?? [];
  const cards = useMemo(() => new Map(config.cards.map((c) => [c.id, c])), [config.cards]);
  const [order, setOrder] = useState<string[]>([]);
  const [bowlers, setBowlers] = useState<string[]>([]);
  const [keeper, setKeeper] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const engine = useMemo(() => engineView(state), [state]);

  const draft: RosterView = { order, bowlers, keeper: keeper ?? "" };
  const problem = rosterProblem(engine, selfId, draft);
  const submitted = state.yourRoster !== null;

  const toggleXi = (id: string) => {
    haptics.tap();
    if (order.includes(id)) {
      setOrder(order.filter((x) => x !== id));
      setBowlers(bowlers.filter((x) => x !== id));
      if (keeper === id) setKeeper(null);
    } else if (order.length < config.xiSize) {
      setOrder([...order, id]);
    }
  };
  const toggleBowler = (id: string) => {
    haptics.tap();
    if (bowlers.includes(id)) setBowlers(bowlers.filter((x) => x !== id));
    else if (bowlers.length < config.bowlerCount) setBowlers([...bowlers, id]);
  };
  const move = (id: string, delta: number) => {
    const i = order.indexOf(id);
    const j = i + delta;
    if (i === -1 || j < 0 || j >= order.length) return;
    const next = [...order];
    next[i] = order[j] as string;
    next[j] = id;
    setOrder(next);
  };
  const fill = () => {
    haptics.tap();
    const auto = autoRoster(engine, selfId);
    setOrder(auto.order);
    setBowlers(auto.bowlers);
    setKeeper(auto.keeper);
  };
  const submit = async () => {
    if (problem !== null || keeper === null || sending) return;
    setSending(true);
    haptics.tap();
    try {
      await command({ type: "SUBMIT_XI", roster: { order, bowlers, keeper } });
    } catch {
      setSending(false);
    }
  };

  if (submitted) {
    const waiting = config.players.filter((id) => state.active[id] && !state.submitted[id]);
    return (
      <section className="panel roster-done" role="status" data-testid="roster-done">
        <h2 className="panel-title">Your XI is in</h2>
        <p className="sub">
          {waiting.length > 0
            ? `Waiting on ${waiting.map((id) => names[id] ?? id).join(", ")}…`
            : "Playing the matches…"}
        </p>
        <ol className="xi-list xi-list--compact">
          {state.yourRoster?.order.map((id, i) => (
            <li key={id}>
              <span>{i + 1}</span>
              <strong>{getCardInfo(editionId, id).player?.name ?? id}</strong>
              <em>
                {state.yourRoster?.bowlers.includes(id) ? "🏏" : ""}
                {state.yourRoster?.keeper === id ? "🧤" : ""}
              </em>
            </li>
          ))}
        </ol>
      </section>
    );
  }

  return (
    <div className="roster-builder" data-testid="roster-builder">
      <div className="roster-head">
        <div>
          <strong>
            XI {order.length}/{config.xiSize}
          </strong>
          <span className="sub">
            {" · "}bowlers {bowlers.length}/{config.bowlerCount}
            {" · "}keeper {keeper === null ? "—" : "✓"}
          </span>
        </div>
        <button type="button" className="button button--sm" onClick={fill} data-testid="auto-xi">
          Auto XI
        </button>
      </div>

      {order.length > 0 && (
        <ol className="xi-list" aria-label="Batting order" data-testid="xi-order">
          {order.map((id, i) => {
            const card = cards.get(id);
            const name = getCardInfo(editionId, id).player?.name ?? id;
            const isKeeperRole = card !== undefined && roleOf(card) === "keeper";
            return (
              <li key={id} className="xi-row">
                <span className="xi-pos">{i + 1}</span>
                <button type="button" className="xi-name" onClick={() => onOpen(id)}>
                  <strong>{name}</strong>
                  <span className="sub">
                    {card !== undefined ? (ROLE_SHORT[roleOf(card)] ?? "") : ""}
                  </span>
                </button>
                <button
                  type="button"
                  className={bowlers.includes(id) ? "xi-toggle xi-toggle--on" : "xi-toggle"}
                  aria-pressed={bowlers.includes(id)}
                  aria-label={`${name} bowls`}
                  title="Bowls"
                  onClick={() => toggleBowler(id)}
                >
                  🏏
                </button>
                <button
                  type="button"
                  className={[
                    "xi-toggle",
                    keeper === id ? "xi-toggle--on" : "",
                    !isKeeperRole && keeper === id ? "xi-toggle--warn" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  aria-pressed={keeper === id}
                  aria-label={`${name} keeps wicket`}
                  title={isKeeperRole ? "Keeper" : "Not a keeper: −10 in the field"}
                  onClick={() => {
                    haptics.tap();
                    setKeeper(keeper === id ? null : id);
                  }}
                >
                  🧤
                </button>
                <span className="xi-move">
                  <button type="button" aria-label="Move up" onClick={() => move(id, -1)}>
                    ▲
                  </button>
                  <button type="button" aria-label="Move down" onClick={() => move(id, 1)}>
                    ▼
                  </button>
                </span>
                <button
                  type="button"
                  className="xi-remove"
                  aria-label={`Drop ${name} from the XI`}
                  onClick={() => toggleXi(id)}
                >
                  ×
                </button>
              </li>
            );
          })}
        </ol>
      )}

      <p className="hint roster-hint" role="status">
        {order.length === 0
          ? `Tap + XI on ${config.xiSize} cards, in batting order. Then mark your ${config.bowlerCount} bowlers 🏏 and your keeper 🧤 — or take the Auto XI.`
          : problem === null
            ? "Batting order top to bottom. 🏏 marks your five bowlers (in bowling order), 🧤 your keeper."
            : `Not yet: ${problem}.`}
      </p>

      <ul className="pool-list roster-bench" aria-label="Your squad">
        {squad
          .filter((id) => !order.includes(id))
          .map((id) => {
            const card = cards.get(id);
            if (card === undefined) return null;
            return (
              <CardRow
                key={id}
                card={card}
                editionId={editionId}
                config={config}
                onOpen={onOpen}
                action={
                  <button
                    type="button"
                    className="button button--sm pool-pick"
                    disabled={order.length >= config.xiSize}
                    data-testid={`xi-add-${id}`}
                    onClick={() => toggleXi(id)}
                  >
                    + XI
                  </button>
                }
              />
            );
          })}
      </ul>

      <div className="roster-actions">
        <button
          type="button"
          className="button button--primary submit-xi"
          disabled={problem !== null || sending}
          data-testid="submit-xi"
          onClick={() => void submit()}
        >
          {sending ? "Sending…" : "Submit XI"}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Results reveal
// ---------------------------------------------------------------------------

/** Which beat of the reveal is showing: a match's phase, a match's result, or the table. */
type Beat =
  | { kind: "phase"; match: number; phase: number }
  | { kind: "match"; match: number }
  | { kind: "table" };

function beats(matches: SquadMatchView[]): Beat[] {
  const out: Beat[] = [];
  matches.forEach((m, mi) => {
    m.phases.forEach((_, pi) => out.push({ kind: "phase", match: mi, phase: pi }));
    out.push({ kind: "match", match: mi });
  });
  out.push({ kind: "table" });
  return out;
}

function useReveal(
  state: SquadClientState,
  selfId: string | null,
): { beat: Beat | null; skip: () => void } {
  const setPresenting = useStore((s) => s.setPresenting);
  const [index, setIndex] = useState(0);
  const timer = useRef<number | null>(null);
  const league = state.league;
  const list = useMemo(() => (league === null ? [] : beats(league.matches)), [league]);
  const beat = list[index] ?? null;

  useEffect(() => {
    if (league === null) return;
    setPresenting(true);
    return () => setPresenting(false);
  }, [league, setPresenting]);

  useEffect(() => {
    if (beat === null) return;
    if (beat.kind === "phase") {
      const match = league?.matches[beat.match];
      const phase = match?.phases[beat.phase];
      if (phase?.winner === selfId && selfId !== null) sounds.roundWin();
      else sounds.flip();
    }
    const hold =
      beat.kind === "phase"
        ? squadRevealTiming.phaseMs
        : beat.kind === "match"
          ? squadRevealTiming.matchMs
          : squadRevealTiming.tableMs;
    timer.current = window.setTimeout(() => {
      if (index + 1 >= list.length) setPresenting(false);
      else setIndex(index + 1);
    }, hold);
    return () => {
      if (timer.current !== null) clearTimeout(timer.current);
    };
  }, [beat, index, list.length, league, selfId, setPresenting]);

  return {
    beat,
    skip: () => {
      if (timer.current !== null) clearTimeout(timer.current);
      setIndex(list.length);
      setPresenting(false);
    },
  };
}

function MatchCard({
  match,
  names,
  selfId,
  shownPhases,
  showResult,
}: {
  match: SquadMatchView;
  names: Record<string, string>;
  selfId: string | null;
  shownPhases: number;
  showResult: boolean;
}) {
  const who = (id: string) => (id === selfId ? "You" : (names[id] ?? "?"));
  return (
    <section className="panel match-card" data-testid="match-card">
      <header className="match-card-head">
        <strong className={match.result === "home" && showResult ? "match-side--won" : ""}>
          {who(match.home)}
        </strong>
        <span className="sub">v</span>
        <strong className={match.result === "away" && showResult ? "match-side--won" : ""}>
          {who(match.away)}
        </strong>
      </header>
      <ol className="phase-list">
        {match.phases.map((phase, i) => {
          const shown = i < shownPhases;
          return (
            <li key={phase.key} className={`phase-row ${shown ? "phase-row--shown" : ""}`.trim()}>
              <span
                className={`phase-score ${shown && phase.winner === match.home ? "phase-score--won" : ""}`.trim()}
              >
                {shown ? phase.home.toFixed(1) : "·"}
              </span>
              <span className="phase-name">
                <strong>{SQUAD_PHASE_INFO[phase.key].name}</strong>
                <span className="sub">{SQUAD_PHASE_INFO[phase.key].blurb}</span>
              </span>
              <span
                className={`phase-score ${shown && phase.winner === match.away ? "phase-score--won" : ""}`.trim()}
              >
                {shown ? phase.away.toFixed(1) : "·"}
              </span>
            </li>
          );
        })}
      </ol>
      {showResult && (
        <p className="match-result" role="status">
          {match.result === "draw"
            ? `Draw — ${match.homePhases}–${match.awayPhases} on phases, level on margin`
            : `${who(match.result === "home" ? match.home : match.away)} win${
                (match.result === "home" ? match.home : match.away) === selfId ? "" : "s"
              } ${Math.max(match.homePhases, match.awayPhases)}–${Math.min(match.homePhases, match.awayPhases)} on phases`}
          {" · "}margin {match.margin > 0 ? `+${match.margin}` : match.margin}
        </p>
      )}
    </section>
  );
}

function ResultsReveal({
  state,
  names,
  selfId,
}: {
  state: SquadClientState;
  names: Record<string, string>;
  selfId: string | null;
}) {
  const { beat, skip } = useReveal(state, selfId);
  const league = state.league;
  if (league === null || beat === null) return null;
  const matchIndex = beat.kind === "table" ? league.matches.length - 1 : beat.match;
  const match = league.matches[matchIndex];
  return (
    <div className="squad-reveal" data-testid="squad-reveal">
      {beat.kind === "table" ? (
        <section className="panel">
          <h2 className="panel-title">Final table</h2>
          <LeagueTable state={state} names={names} selfId={selfId} />
        </section>
      ) : (
        match !== undefined && (
          <>
            <p className="sub">
              Match {matchIndex + 1} of {league.matches.length}
            </p>
            <MatchCard
              match={match}
              names={names}
              selfId={selfId}
              shownPhases={beat.kind === "phase" ? beat.phase + 1 : match.phases.length}
              showResult={beat.kind === "match"}
            />
          </>
        )
      )}
      <button type="button" className="button button--ghost button--sm" onClick={skip}>
        Skip to the table
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The shell
// ---------------------------------------------------------------------------

export function SquadDraftTable({ room }: { room: RoomView }) {
  const selfId = useStore((s) => s.selfId);
  const spectator = useStore((s) => s.spectator);
  const state = useStore((s) => s.squad);
  const timer = useStore((s) => s.timer);
  const forfeit = useStore((s) => s.forfeit);
  const leaveRoom = useStore((s) => s.leaveRoom);
  const [menuOpen, setMenuOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const seconds = useCountdown(
    state !== null && !state.finished ? (timer?.deadline ?? null) : null,
  );

  const names: Record<string, string> = {};
  for (const p of room.players) names[p.id] = p.name;

  const picker = state === null ? null : onTheClock(state);
  const yourMove =
    state !== null &&
    !spectator &&
    selfId !== null &&
    ((state.phase === "drafting" && picker === selfId) ||
      (state.phase === "building" && state.active[selfId] && !state.submitted[selfId]));
  const nudged = useRef(false);
  useEffect(() => {
    if (yourMove && !nudged.current) {
      nudged.current = true;
      sounds.yourTurn();
      haptics.yourTurn();
    }
    if (!yourMove) nudged.current = false;
  }, [yourMove]);

  if (state === null) {
    return (
      <main className="screen table-screen squad-screen">
        <p className="hint">Laying out the pool…</p>
      </main>
    );
  }

  const { config } = state;
  const pick = currentPick(state);
  const total = state.pickOrder.length;
  const headline =
    state.phase === "drafting"
      ? yourMove
        ? "Your pick"
        : `${picker === null ? "…" : (names[picker] ?? "?")} is picking…`
      : state.phase === "building"
        ? yourMove
          ? "Name your XI"
          : "Waiting for the XIs…"
        : "Results";
  const progress =
    state.phase === "drafting"
      ? `Pick ${pick} of ${total}`
      : state.phase === "building"
        ? "Team sheets"
        : "Full time";

  return (
    <main
      className="screen table-screen squad-screen"
      data-testid="game-table"
      data-mode="squad-draft"
    >
      <header className="table-head">
        <span className="table-wordmark">
          Deck<span>XI</span>
        </span>
        <span className="round-chip" data-testid="round-chip">
          {progress}
        </span>
        <span
          className={`turn-timer ${seconds !== null && seconds <= 5 ? "turn-timer--urgent" : ""}`.trim()}
          {...(seconds !== null ? { role: "timer" } : {})}
        >
          {seconds !== null ? `${seconds}s` : GAME_MODE_INFO["squad-draft"].name}
        </span>
      </header>

      <div className="score-strip" aria-label="Squads">
        {config.players.map((id) => (
          <ScoreChip
            key={id}
            name={id === selfId ? "You" : (names[id] ?? id)}
            count={(state.squads[id] ?? []).length}
            mine={id === selfId}
            out={!state.active[id]}
            hot={id === picker}
            tag={
              !state.active[id]
                ? "out"
                : state.phase === "building"
                  ? state.submitted[id]
                    ? "XI in"
                    : "…"
                  : id === picker
                    ? "picking"
                    : undefined
            }
          />
        ))}
      </div>

      <div className="squad-body">
        <h1 className="squad-headline" data-testid="turn-line">
          {headline}
        </h1>
        {state.phase === "drafting" && (
          <DraftBoard
            state={state}
            selfId={selfId}
            spectator={spectator}
            names={names}
            onOpen={setPreview}
          />
        )}
        {state.phase === "building" &&
          (spectator || selfId === null || !state.active[selfId] ? (
            <p className="hint">
              {config.players
                .filter((id) => state.active[id])
                .map((id) => `${names[id] ?? id}: ${state.submitted[id] ? "XI in" : "building…"}`)
                .join(" · ")}
            </p>
          ) : (
            <RosterBuilder state={state} selfId={selfId} names={names} onOpen={setPreview} />
          ))}
        {state.phase === "finished" && state.league !== null && (
          <ResultsReveal state={state} names={names} selfId={spectator ? null : selfId} />
        )}
        {state.phase === "finished" && state.league === null && (
          <p className="hint">
            {state.winner === selfId
              ? "You win — everyone else left."
              : `${names[state.winner ?? ""] ?? "Someone"} wins.`}
          </p>
        )}
      </div>

      <div className="table-social">
        <MuteButton />
        <button
          type="button"
          className="icon-button"
          aria-label="How Squad Draft works"
          onClick={() => setRulesOpen(true)}
        >
          ?
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label="Menu"
          onClick={() => setMenuOpen(true)}
        >
          ⋯
        </button>
        <GameChat />
      </div>

      {preview !== null && (
        <Dialog
          title={getCardInfo(config.editionId, preview).player?.name ?? "Card"}
          onClose={() => setPreview(null)}
        >
          <div className="card-preview">
            <TrumpCard
              editionId={config.editionId}
              cardId={preview}
              size="full"
              stats={config.cards.find((c) => c.id === preview)?.stats}
            />
          </div>
          <button type="button" className="button" onClick={() => setPreview(null)}>
            Close
          </button>
        </Dialog>
      )}

      {rulesOpen && (
        <Dialog title="Squad draft" onClose={() => setRulesOpen(false)}>
          <ul className="power-legend">
            <li>
              <strong>Draft</strong>
              <span className="sub">
                Snake order, {config.squadSize} picks each. At most {config.nationCap} from one
                nation.
              </span>
            </li>
            <li>
              <strong>Name your XI</strong>
              <span className="sub">
                {config.xiSize} in batting order, {config.bowlerCount} who bowl, one keeper. A
                batter asked to bowl bowls at half strength; gloves on a non-keeper cost 10 in the
                field.
              </span>
            </li>
            {(["powerplay", "middle", "finish"] as const).map((key) => (
              <li key={key}>
                <strong>{SQUAD_PHASE_INFO[key].name}</strong>
                <span className="sub">{SQUAD_PHASE_INFO[key].blurb}</span>
              </li>
            ))}
            <li>
              <strong>League</strong>
              <span className="sub">
                Every XI plays every other. Two points a win, one a draw; margin breaks ties. Top of
                the table wins.
              </span>
            </li>
          </ul>
          <button type="button" className="button" onClick={() => setRulesOpen(false)}>
            Got it
          </button>
        </Dialog>
      )}

      {menuOpen && (
        <Dialog title="Game menu" onClose={() => setMenuOpen(false)}>
          {!spectator && !state.finished && (
            <button
              type="button"
              className="button button--danger"
              onClick={() => {
                setMenuOpen(false);
                void forfeit().catch(() => undefined);
              }}
            >
              Forfeit the game
            </button>
          )}
          <button
            type="button"
            className="button button--ghost"
            onClick={() => {
              setMenuOpen(false);
              void leaveRoom();
            }}
          >
            Leave room
          </button>
          <button type="button" className="button" onClick={() => setMenuOpen(false)}>
            Back to the game
          </button>
        </Dialog>
      )}
    </main>
  );
}
