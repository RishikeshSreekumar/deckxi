# Agent playtests

The e2e suite proves a game _can_ be played. A playtest asks whether it is worth
playing: five LLM agents, each with a persona and a device, drive five real
browsers through one live match and report what confused, annoyed or delighted
them — plus every console error and failed request they walked past without
noticing.

## Pieces

| Path                             | What it is                                                          |
| -------------------------------- | ------------------------------------------------------------------- |
| `apps/web/playtest/stack.mjs`    | Builds and starts a server (:3902) and a preview SPA (:4174)        |
| `apps/web/playtest/driver.mjs`   | One playtester's browser context, screenshots and problem capture   |
| `apps/web/playtest/daemon.mjs`   | HTTP control plane on :3910 — the only thing agents talk to         |
| `.claude/workflows/playtest.mjs` | The workflow: five persona agents, then a reporter                  |
| `apps/web/playtest/runs/<id>/`   | Screenshots, `notes.jsonl`, `report.json`, `report.md` (gitignored) |

The daemon deliberately gives an agent only what a human has — a screenshot, the
text on screen, and the list of things that can be clicked. There is no hook into
game state, so anything an agent cannot work out from the screen is a genuine
usability finding rather than an artefact of the harness.

## Running one

```sh
pnpm --filter @deckxi/web playtest            # builds the stack, then serves :3910
pnpm --filter @deckxi/web playtest --reuse    # drive a stack that is already up
PLAYTEST_HEADED=1 pnpm --filter @deckxi/web playtest   # watch the browsers
```

Then, in Claude Code:

```
run the playtest workflow
```

The workflow needs the daemon already listening on :3910; it does not start it.
Pass a focus for the run with the workflow's `args`, e.g.
`{ "focus": "the new power-card row" }`.

## The daemon API

```
GET  /health                        → { ok, webUrl, outDir, players }
POST /players   {name, device}      → { id }         device: desktop | mobile | tablet
GET  /players/:id/observe           → { url, screenshot, text, controls[], newProblems[] }
POST /players/:id/click   {ref}
POST /players/:id/type    {ref,text}
POST /players/:id/select  {ref,value}
POST /players/:id/goto    {path}
POST /players/:id/wait    {ms}
GET  /board/:key                    → { value }      shared blackboard (the room code)
POST /board/:key {value}
POST /notes {player, kind, text}    → appended to notes.jsonl
GET  /report                        → notes + captured problems + captureVerified; writes report.json
POST /shutdown
```

Every action answers with the screen it produced, so one call is one move. Refs
are regenerated on each observation — an agent must observe before it acts.

Each browser proves its console capture on open: the driver throws one marked
`console.error` and checks it arrives in `problems` before removing it.
`captureVerified` in the report says whether that worked per player, so an
empty problem list can be read as a clean match rather than a dead listener.
The app also logs `[deckxi invariant]` errors when a reveal cannot be right
(a live player missing from it, a winner whose value is not the best), which
the capture picks up.

## Personas

Defined at the top of `.claude/workflows/playtest.mjs`: a host who wants to get
the table going, a distracted mobile player, a competitive cricket nerd, a
cautious newcomer, and a prodder who clicks things out of order. Editing that
array is the intended way to aim a run — five identical testers find one
person's worth of bugs.

## Reading the output

`report.md` in the run directory is the deliverable: verdict, deduped blockers
and majors with screenshot paths, per-screen friction, runtime errors flagged by
whether a player noticed, a first-30-seconds read, and five ranked changes. The
raw `notes.jsonl` and screenshots stay next to it for anything the report
compresses away.
