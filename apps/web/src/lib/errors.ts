/**
 * Client error reporting (#64).
 *
 * ~40 lines and no dependency, instead of a Sentry SDK that would cost about
 * 30 KB gzipped against a mobile budget CI enforces (#107). Reports go to the
 * game server, which logs them into the same structured stream as everything
 * else — see apps/server/src/errors.ts for why that trade was made.
 *
 * Three rules keep a broken build from turning into a self-inflicted DDoS:
 * duplicates are dropped, the session is capped, and a failed report is
 * forgotten rather than retried.
 */
import { API_URL } from "./socket.js";

/** Stamped in at build time (VITE_RELEASE=$GITHUB_SHA); "dev" locally. */
export const RELEASE: string = (import.meta.env.VITE_RELEASE as string | undefined) ?? "dev";

/** One noisy render loop shouldn't post a thousand times. */
const MAX_REPORTS_PER_SESSION = 10;

const seen = new Set<string>();
let sent = 0;

export interface ReportedError {
  message: string;
  stack?: string | undefined;
  kind: "error" | "unhandledrejection" | "boundary";
}

export function reportError({ message, stack, kind }: ReportedError): void {
  const key = `${kind}:${message}:${stack?.slice(0, 200) ?? ""}`;
  if (seen.has(key) || sent >= MAX_REPORTS_PER_SESSION) return;
  seen.add(key);
  sent++;

  const body = JSON.stringify({
    message: message.slice(0, 500),
    ...(stack !== undefined ? { stack: stack.slice(0, 4000) } : {}),
    // Path only: a join code in the query string is not ours to log.
    url: location.pathname,
    release: RELEASE,
    kind,
  });

  // keepalive so a report fired during a navigation still leaves the tab.
  void fetch(`${API_URL}/api/telemetry/error`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => {
    // The server is the thing that's down. Nothing useful left to do.
  });
}

function messageOf(reason: unknown): { message: string; stack?: string | undefined } {
  if (reason instanceof Error) {
    return { message: reason.message, ...(reason.stack !== undefined && { stack: reason.stack }) };
  }
  return { message: typeof reason === "string" ? reason : "Non-error thrown" };
}

let installed = false;

/** Catch what React never sees: async throws and rejected promises. */
export function initErrorReporting(): void {
  if (installed) return;
  installed = true;
  window.addEventListener("error", (event) => {
    reportError({ ...messageOf(event.error ?? event.message), kind: "error" });
  });
  window.addEventListener("unhandledrejection", (event) => {
    reportError({ ...messageOf(event.reason), kind: "unhandledrejection" });
  });
}

/** Test seam — reporting is deliberately stateful across a session. */
export function resetErrorReporting(): void {
  seen.clear();
  sent = 0;
}
