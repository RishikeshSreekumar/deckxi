export const meta = {
  name: "playtest",
  description: "Five agent playtesters play a real DeckXI game in real browsers and report on it",
  whenToUse:
    "Run after a gameplay or UI change to get human-shaped feedback: five personas play one match end to end through the built app, then a reporter turns their notes plus console/network errors into a findings report.",
  phases: [
    { title: "Play", detail: "five personas drive one browser each through a full match" },
    { title: "Report", detail: "one agent synthesises notes, findings and runtime errors" },
  ],
};

const DAEMON = "http://localhost:3910";

// Personas are the point: identical testers find identical things. Each one has
// a different device, a different reason to be here, and a different tolerance
// for confusion.
const PERSONAS = [
  {
    id: "priya",
    name: "Priya",
    device: "desktop",
    role: "host",
    brief:
      "Confident host who has played card games online before but never this one. Sets up the table, cares about whether the rules are discoverable and whether the room feels ready to start. Impatient with anything that takes more than two clicks.",
  },
  {
    id: "sam",
    name: "Sam",
    device: "mobile",
    role: "guest",
    brief:
      "On a phone, one-handed, half-watching TV. Knows nothing about cricket stats. Judges everything by whether it is obvious what to tap next and whether text is readable at a glance. Complains loudly about small tap targets and cramped layouts.",
  },
  {
    id: "arjun",
    name: "Arjun",
    device: "desktop",
    role: "guest",
    brief:
      "Cricket nerd and competitive player. Wants to know exactly why a round was won or lost, whether the stat he picked was actually the right call, and whether the game rewards skill or is pure luck. Will call out anything that feels unfair or opaque.",
  },
  {
    id: "mei",
    name: "Mei",
    device: "tablet",
    role: "guest",
    brief:
      "Total newcomer, cautious, reads everything before clicking. Represents the player who bounces if the first thirty seconds are confusing. Reports every moment she was unsure what the game wanted from her.",
  },
  {
    id: "dev",
    name: "Dev",
    device: "desktop",
    role: "guest",
    brief:
      "Restless prodder. Clicks the chat, the emotes, the menu, the rules sheet mid-round, and generally pokes at anything not on the happy path — while still taking his turns. Looks for things that break, stall, or look wrong when used out of order.",
  },
];

const FINDINGS_SCHEMA = {
  type: "object",
  properties: {
    persona: { type: "string" },
    reachedResults: { type: "boolean", description: "true if this player saw the results screen" },
    funRating: { type: "integer", description: "1-10, how much this persona enjoyed the match" },
    funReason: { type: "string" },
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          severity: { type: "string", description: "blocker | major | minor | polish" },
          area: { type: "string", description: "e.g. lobby, table, reveal, results, chat, rules" },
          summary: { type: "string" },
          detail: {
            type: "string",
            description: "what happened, what was expected, screenshot path if any",
          },
        },
        required: ["severity", "area", "summary", "detail"],
      },
    },
    quotes: {
      type: "array",
      description: "in-character reactions worth quoting in the report",
      items: { type: "string" },
    },
  },
  required: ["persona", "reachedResults", "funRating", "funReason", "findings", "quotes"],
};

function protocol(persona) {
  return `You are a HUMAN PLAYTESTER of DeckXI, a cricket trump-card game. You are ${persona.name}, on ${persona.device}.

Who you are: ${persona.brief}

You drive a real browser through a local HTTP daemon at ${DAEMON}. Use Bash + curl only — never Playwright, never the repo source. You are a player, not a developer: if you cannot work something out from the screen, that IS the finding. Do not read the codebase to understand the game.

Register first (once):
  curl -s -X POST ${DAEMON}/players -H 'content-type: application/json' -d '{"name":"${persona.name}","device":"${persona.device}"}'

Every call below returns the screen after the action: { url, screenshot, text, controls[], newProblems[] }.
  curl -s ${DAEMON}/players/${persona.id}/observe
  curl -s -X POST ${DAEMON}/players/${persona.id}/click  -H 'content-type: application/json' -d '{"ref":"7"}'
  curl -s -X POST ${DAEMON}/players/${persona.id}/type   -H 'content-type: application/json' -d '{"ref":"2","text":"${persona.name}"}'
  curl -s -X POST ${DAEMON}/players/${persona.id}/select -H 'content-type: application/json' -d '{"ref":"5","value":"3"}'
  curl -s -X POST ${DAEMON}/players/${persona.id}/goto   -H 'content-type: application/json' -d '{"path":"/join/ABC123"}'
  curl -s -X POST ${DAEMON}/players/${persona.id}/wait   -H 'content-type: application/json' -d '{"ms":2500}'

Refs are regenerated on every observation — always act on refs from your MOST RECENT response.

Read the screenshot with the Read tool at least at these moments: the first screen, the lobby, your first turn at the table, one reveal, and the results screen. Judge the visuals, not just the text — spacing, contrast, whether the important thing is the thing your eye lands on.

Shared blackboard (the only way you and the other players coordinate):
  curl -s ${DAEMON}/board/roomCode                 → {"value": "..."} or {"value": null}
  curl -s -X POST ${DAEMON}/board/roomCode -H 'content-type: application/json' -d '{"value":"ABC123"}'

Log reactions as you go (they land in the report, so keep them in character and specific):
  curl -s -X POST ${DAEMON}/notes -H 'content-type: application/json' -d '{"player":"${persona.id}","kind":"reaction","text":"..."}'

Rules of engagement:
- Play the whole match to the results screen. Take your turn whenever the screen says it is your pick.
- If nothing is asked of you, wait 2-3s and observe again rather than clicking at random.
- Never click anything that could delete an account or leave the table before the game ends.
- If you are stuck for more than 8 straight observations with no progress, note it as a blocker and stop.
- Budget roughly 60 actions. Stop and report if you exceed that.`;
}

const HOST_STEPS = `Your job as host, in order:
1. From the landing screen, enter your name and create a table.
2. Open "Match settings" and set a SHORT match: 5 cards per player (never fewer cards than players — the last seats would be out before their first call), 10 rounds max, 30s turn timer. Close the sheet.
3. Read the room code off the lobby and post it to the blackboard key roomCode immediately — the other four players are blocked waiting on it.
4. Wait until all five names appear in the player list and everyone is ready, then start the match. Poll with wait+observe; do not start short-handed unless someone never arrives after ~2 minutes (note that as a finding).
5. Play your turns to the results screen.`;

const GUEST_STEPS = `Your job as guest, in order:
1. Poll ${DAEMON}/board/roomCode (wait 3000ms between polls) until it returns a code. Do not touch the UI before that except to look at the landing screen once and react to it.
2. Go to /join/<code>, enter your name, join the table, and mark yourself ready.
3. Play your turns to the results screen. The host starts the match.`;

phase("Play");

const reports = await parallel(
  PERSONAS.map(
    (persona) => () =>
      agent(
        `${protocol(persona)}\n\n${persona.role === "host" ? HOST_STEPS : GUEST_STEPS}\n\n` +
          `When the match is over (or you are blocked), look at the results screen, log a final reaction, and return your findings. Severity: blocker = could not proceed or the game broke; major = would make a real player quit or misplay; minor = friction; polish = cosmetic. Only report what you actually saw on screen.` +
          (args && args.focus ? `\n\nExtra focus for this run: ${args.focus}` : ""),
        { label: `play:${persona.id}`, phase: "Play", schema: FINDINGS_SCHEMA },
      ),
  ),
);

const played = reports.filter(Boolean);
log(`${played.length}/${PERSONAS.length} playtesters reported back`);

phase("Report");

const summary = await agent(
  `Five agent playtesters just played one match of DeckXI end to end in real browsers. Write the findings report.

Their structured reports:
${JSON.stringify(played, null, 2)}

Also pull the raw run data — notes and captured console errors, exceptions and failed requests — from the daemon:
  curl -s ${DAEMON}/report
It answers with { runId, outDir, notes, problems } and writes report.json into outDir. Runtime errors that no player noticed still matter: cross-reference them against what players reported.

Write the report to <outDir>/report.md and return its path plus a 10-line executive summary. The report must have:
1. Verdict — did five people actually complete a game, and was it fun? Use the fun ratings and quote players.
2. Blockers and majors, deduped across players, each with who hit it, what they expected, and the screenshot path.
3. Minor friction and polish, grouped by screen.
4. Runtime errors from the console/network capture, with a note on whether each is player-visible.
5. First-30-seconds read — what the newcomer and the mobile player understood versus what the game assumed.
6. Top 5 changes ranked by (player pain × how cheap it looks to fix), each phrased as a concrete change to make.

Be concrete and quote players. Do not invent findings that are not in the data, and do not soften a blocker.`,
  { label: "report", phase: "Report" },
);

return { players: played.length, summary };
