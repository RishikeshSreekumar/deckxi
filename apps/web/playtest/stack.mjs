/**
 * The stack a playtest runs against: a real game server with an in-memory
 * store and the built SPA served by vite preview — the same shape the e2e
 * suite uses, on its own ports so a playtest never collides with `pnpm dev`
 * or a Playwright run.
 *
 * Set PLAYTEST_REUSE=1 (or pass --web-url) to skip all of this and drive a
 * stack that is already up.
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

export const SERVER_PORT = 3902;
export const WEB_PORT = 4174;
export const SERVER_URL = `http://localhost:${SERVER_PORT}`;
export const WEB_URL = `http://localhost:${WEB_PORT}`;

const children = [];

function run(command, options) {
  const child = spawn(command, {
    shell: true,
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
  const tag = options.tag ?? "stack";
  child.stdout.on("data", (b) => process.stdout.write(`[${tag}] ${b}`));
  child.stderr.on("data", (b) => process.stderr.write(`[${tag}] ${b}`));
  children.push(child);
  return child;
}

async function waitFor(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // not up yet
    }
    await sleep(500);
  }
  throw new Error(`timed out waiting for ${url}`);
}

/** Build both halves, start them, resolve once both answer. */
export async function startStack(webRoot) {
  await new Promise((resolve, reject) => {
    const build = run("pnpm -w exec turbo run build --filter=@deckxi/server", {
      cwd: webRoot,
      tag: "build",
    });
    build.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`server build failed (${code})`)),
    );
  });

  run("node ../server/dist/index.js", {
    cwd: webRoot,
    tag: "server",
    env: {
      ...process.env,
      PORT: String(SERVER_PORT),
      HOST: "127.0.0.1",
      CORS_ORIGINS: WEB_URL,
    },
  });

  await new Promise((resolve, reject) => {
    const build = run("pnpm exec vite build", {
      cwd: webRoot,
      tag: "web-build",
      env: { ...process.env, VITE_API_URL: SERVER_URL },
    });
    build.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`web build failed (${code})`)),
    );
  });

  run(`pnpm exec vite preview --port ${WEB_PORT} --strictPort`, {
    cwd: webRoot,
    tag: "web",
  });

  await Promise.all([waitFor(`${SERVER_URL}/health`, 60_000), waitFor(WEB_URL, 60_000)]);
  return { serverUrl: SERVER_URL, webUrl: WEB_URL };
}

export function stopStack() {
  for (const child of children) child.kill("SIGTERM");
  children.length = 0;
}
