/**
 * The playtest daemon: it owns the stack, one browser per playtester and a
 * shared blackboard, and exposes them over plain HTTP so agents can drive a
 * long-lived session with one-shot `curl` calls.
 *
 *   pnpm --filter @deckxi/web playtest            # boot stack + daemon
 *   pnpm --filter @deckxi/web playtest --reuse    # drive a stack already up
 *
 * API (all JSON, port 3910):
 *   GET  /health                       → { ok, webUrl, outDir, players }
 *   POST /players  {name, device}      → { id }              register a tester
 *   GET  /players/:id/observe          → screen text, screenshot path, controls
 *   POST /players/:id/click   {ref}
 *   POST /players/:id/type    {ref, text}
 *   POST /players/:id/select  {ref, value}
 *   POST /players/:id/goto    {path}
 *   POST /players/:id/wait    {ms}
 *   GET  /board/:key                   → { value }           shared blackboard
 *   POST /board/:key  {value}
 *   POST /notes  {player, kind, text}  → appended to notes.jsonl
 *   GET  /report                       → notes + per-player console/network problems
 *   POST /shutdown
 */
import http from "node:http";
import path from "node:path";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { launchBrowser, Player } from "./driver.mjs";
import { startStack, stopStack, WEB_URL } from "./stack.mjs";

const WEB_ROOT = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const PORT = Number(process.env["PLAYTEST_PORT"] ?? 3910);
const MAX_PLAYERS = Number(process.env["PLAYTEST_MAX_PLAYERS"] ?? 5);

const args = process.argv.slice(2);
const reuse = args.includes("--reuse") || process.env["PLAYTEST_REUSE"] === "1";
const webUrlArg = args.find((a) => a.startsWith("--web-url="))?.split("=")[1];

const runId = new Date().toISOString().replace(/[:.]/g, "-");
const outDir = path.join(WEB_ROOT, "playtest", "runs", runId);

const players = new Map();
const board = new Map();
let browser;
let webUrl = webUrlArg ?? WEB_URL;

async function note(entry) {
  await appendFile(
    path.join(outDir, "notes.jsonl"),
    JSON.stringify({ at: new Date().toISOString(), ...entry }) + "\n",
  );
}

function json(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, { "content-type": "application/json" });
  response.end(payload);
}

async function body(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString());
}

async function handle(request, response) {
  const url = new URL(request.url, "http://localhost");
  const segments = url.pathname.split("/").filter(Boolean);
  const input = request.method === "POST" ? await body(request) : {};

  if (segments[0] === "health") {
    return json(response, 200, {
      ok: true,
      webUrl,
      outDir,
      players: [...players.values()].map((p) => ({ id: p.id, name: p.name, device: p.device })),
    });
  }

  if (segments[0] === "players" && segments.length === 1 && request.method === "POST") {
    if (players.size >= MAX_PLAYERS) return json(response, 409, { error: "table full" });
    const id = String(input.name ?? `p${players.size + 1}`)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-");
    if (players.has(id)) return json(response, 200, { id, reused: true });
    const player = new Player({
      id,
      name: input.name ?? id,
      device: input.device ?? "desktop",
      webUrl,
      outDir,
    });
    await player.open(browser);
    players.set(id, player);
    await note({ player: id, kind: "joined", text: `${player.name} on ${player.device}` });
    return json(response, 200, { id });
  }

  if (segments[0] === "players" && segments.length === 3) {
    const player = players.get(segments[1]);
    if (player === undefined) return json(response, 404, { error: "unknown player" });
    const action = segments[2];
    try {
      if (action === "observe") return json(response, 200, await player.observe());
      if (action === "click") await player.click(input.ref);
      else if (action === "type") await player.type(input.ref, input.text);
      else if (action === "select") await player.select(input.ref, input.value);
      else if (action === "goto") await player.goto(input.path);
      else if (action === "wait")
        await player.page.waitForTimeout(Math.min(input.ms ?? 1000, 30_000));
      else return json(response, 404, { error: `unknown action ${action}` });
      // Every action answers with the screen it produced: one call per move.
      return json(response, 200, await player.observe());
    } catch (error) {
      return json(response, 200, {
        error: String(error).slice(0, 400),
        ...(await player.observe()),
      });
    }
  }

  if (segments[0] === "board" && segments.length === 2) {
    const key = segments[1];
    if (request.method === "POST") {
      board.set(key, input.value);
      return json(response, 200, { ok: true });
    }
    return json(response, 200, { value: board.get(key) ?? null });
  }

  if (segments[0] === "notes" && request.method === "POST") {
    await note({ player: input.player, kind: input.kind ?? "note", text: input.text });
    return json(response, 200, { ok: true });
  }

  if (segments[0] === "report") {
    const notes = await readFile(path.join(outDir, "notes.jsonl"), "utf8").catch(() => "");
    const report = {
      runId,
      outDir,
      notes: notes
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line)),
      problems: Object.fromEntries([...players.values()].map((p) => [p.id, p.problems])),
      /** Per player: did the console-error probe at open land in `problems`? */
      captureVerified: Object.fromEntries(
        [...players.values()].map((p) => [p.id, p.captureVerified === true]),
      ),
    };
    await writeFile(path.join(outDir, "report.json"), JSON.stringify(report, null, 2));
    return json(response, 200, report);
  }

  if (segments[0] === "shutdown") {
    json(response, 200, { ok: true });
    setTimeout(() => void shutdown(0), 100);
    return undefined;
  }

  return json(response, 404, { error: "no such route" });
}

async function shutdown(code) {
  for (const player of players.values()) await player.close().catch(() => undefined);
  await browser?.close().catch(() => undefined);
  stopStack();
  process.exit(code);
}

await mkdir(outDir, { recursive: true });
if (!reuse && webUrlArg === undefined) {
  const stack = await startStack(WEB_ROOT);
  webUrl = stack.webUrl;
}
browser = await launchBrowser();

const server = http.createServer((request, response) => {
  handle(request, response).catch((error) => json(response, 500, { error: String(error) }));
});
server.listen(PORT, "127.0.0.1", () => {
  console.log(`[playtest] ready on http://localhost:${PORT} — web ${webUrl} — out ${outDir}`);
});

process.on("SIGINT", () => void shutdown(0));
process.on("SIGTERM", () => void shutdown(0));
