/**
 * Structured logging (#65).
 *
 * One JSON line per event on stdout, which is the whole log pipeline: Cloud
 * Run ships container stdout to Cloud Logging for free (the first 50 GiB a
 * month), and that is the drain. No hosted log vendor, no agent, no cost —
 * see docs/runbook.md → "Logs".
 *
 * Two things make those lines useful rather than merely present:
 *
 *  1. **Google's field names.** Cloud Logging keys off `severity` and
 *     `message`; pino's defaults (`level: 30`, `msg`) leave every line at
 *     DEFAULT severity, so an error is indistinguishable from a heartbeat in
 *     the console. The formatters below translate.
 *  2. **Correlation.** Every line carries the ids that let you follow one
 *     player through one game: `reqId` on HTTP, `socketId`/`userId` on a
 *     connection, `roomId`/`matchId` once they are in a room. They are bound
 *     to child loggers at the point the id becomes known, so no call site has
 *     to remember to pass them.
 */
import type { FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";

/**
 * The slice of pino the app actually uses. Structural, so a Fastify logger, a
 * bare pino instance and a test double are all interchangeable — and no module
 * outside this one has to import pino.
 */
export interface Logger {
  debug(obj: object, msg?: string): void;
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
  child(bindings: Record<string, unknown>): Logger;
}

/** A logger that drops everything — the default for tests and library use. */
export const nullLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => nullLogger,
};

/** pino level label → Cloud Logging severity. */
const SEVERITY: Record<string, string> = {
  trace: "DEBUG",
  debug: "DEBUG",
  info: "INFO",
  warn: "WARNING",
  error: "ERROR",
  fatal: "CRITICAL",
};

export interface LoggerConfig {
  level: string;
  appEnv: string;
  /** Build identifier (git sha) so a log line can be tied to code. */
  release: string | undefined;
}

/**
 * Fastify logger options. Passed as `buildApp({ logger })`; `true` (plain pino
 * defaults) and `false` (silent) remain valid for local use and tests.
 */
export function loggerOptions(config: LoggerConfig): Record<string, unknown> {
  return {
    level: config.level,
    base: {
      service: "deckxi-server",
      env: config.appEnv,
      ...(config.release !== undefined ? { release: config.release } : {}),
    },
    messageKey: "message",
    formatters: {
      level: (label: string) => ({ severity: SEVERITY[label] ?? "DEFAULT", level: label }),
    },
    // Cookies carry session tokens and Authorization carries the admin token;
    // neither belongs in a log that a third party may one day read.
    redact: {
      paths: [
        "req.headers.cookie",
        "req.headers.authorization",
        'res.headers["set-cookie"]',
        "headers.cookie",
        "headers.authorization",
      ],
      censor: "[redacted]",
    },
    serializers: {
      req: (request: FastifyRequest) => ({
        method: request.method,
        url: request.url,
        reqId: request.id,
      }),
    },
  };
}

/**
 * Correlation id for one HTTP request. Prefers an id the caller already has —
 * `x-request-id` from a proxy, or the trace id Cloud Run stamps on every
 * inbound request — so a line here can be joined to a line upstream.
 */
export function requestId(headers: Record<string, string | string[] | undefined>): string {
  const explicit = headers["x-request-id"];
  if (typeof explicit === "string" && explicit.length > 0 && explicit.length <= 128) {
    return explicit;
  }
  const trace = headers["x-cloud-trace-context"];
  if (typeof trace === "string" && trace.length > 0) {
    // Format: TRACE_ID/SPAN_ID;o=1 — the trace id is the joinable part.
    const [traceId] = trace.split("/");
    if (traceId !== undefined && traceId.length > 0) return traceId;
  }
  return randomUUID();
}
