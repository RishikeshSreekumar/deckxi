# ADR 0001 — Game modes are engine plugins behind one interface

Status: accepted (Phase 9, 2026-09-04)

## Context

Through Phase 8 the platform ran one state machine — trumps — with two variants. The server, the
socket layer, the replay debugger and the admin inspector all reached into `GameState` directly:
`state.leader`, `state.pot`, `state.players[i].hand`. Adding a second game with different shapes
(a draft has a pool and squads, not hands and a pot) meant either forking that plumbing per game
or teaching it every game's state.

## Decision

The engine exports a `GameMode<TState, TCommand, TEvent, TView>` interface (`packages/engine/src/mode.ts`)
and a registry (`modes/registry.ts`). A mode owns:

- **setup** (`deckSize`, `init`), **rules** (`apply`, `reduce`), **the platform's read-only
  view** (`status`: phase, finished, winner, round, `waitingOn`, `turnKey`, active players);
- **the host's commands** (`autoPlay`, `forfeit`) and **the client's** (`clientCommand`, from a
  payload validated against the shared `gameCommandSchema`);
- **redaction** (`redact`) — what a viewer may see is a rule of the game, so it moved out of the
  server into the mode;
- **a bot** and **an operator inspection** (`inspect`).

Above the engine, `GameInstance.state` is `unknown` and the room only ever threads it back into
the same mode's hooks (`AnyGameMode` is the one place the type is erased). Trumps (both variants)
is registered through a thin adapter over the existing engine; the flat trumps API stays exported
for the client's replay tooling and the existing tests.

The wire keeps the trumps messages (`game:selectStat`, `game:playCard`) and adds one generic
`game:command` whose payload is the discriminated union of every mode's client commands. The
protocol version bumped to 2.

## Consequences

- Adding a game is: a spec in `docs/games/`, a directory under `modes/`, one line in the
  registry, its wire types in `@deckxi/shared`, and its screens in the web app. Rooms, timers,
  persistence, reconnection, forfeits, kill switches, the admin API and metrics need no change —
  Squad Draft proved this: `rooms.ts` gained no mode-specific branch.
- Turn timers are driven by `status().turnKey` and `waitingOn`, which generalised the trumps
  "one clock per phase" rule instead of special-casing it.
- Per-mode kill switches, metrics (`deckxi_mode_games_total{mode}`) and user stats
  (`UserStats.byMode`) key on the mode id and need nothing from the mode itself.
- The client is deliberately _not_ generic: each mode ships its own screens and its own fold of
  its wire events. A UI that renders any game from a descriptor was considered and rejected — a
  draft board and a trumps table share nothing worth abstracting, and the descriptor would have to
  grow a feature for every screen anyway.
- Cost: the host loses static typing at the erasure boundary. The registry test drives every
  registered mode end to end through the interface alone, which is the check that replaces it.
