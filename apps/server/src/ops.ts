/**
 * Live ops controls (#70): a maintenance notice and a per-mode kill switch,
 * held in one small DB-backed config row.
 *
 * **Why DB-backed and not env.** Everything else that configures this server
 * is an env var, because everything else changes when the code changes. These
 * two do not: "we're restarting in ten minutes" and "stop letting people start
 * Classic Trumps, it's broken" both need to take effect *now*, on a running
 * server, without a deploy — and a deploy is exactly what ends every live
 * game. That is the whole argument for a row in a table.
 *
 * It is cached in memory and written through, so reads cost nothing and the
 * game path never waits on Postgres. Without a database the flags still work,
 * they just don't survive a restart — which for a maintenance banner is
 * arguably correct.
 */
import { z } from "zod";
import type { Logger } from "./logging.js";
import { nullLogger } from "./logging.js";

export const MAX_NOTICE_LENGTH = 200;

export const opsFlagsSchema = z.object({
  /** Banner every connected client shows; null when all is well. */
  notice: z
    .object({
      text: z.string().trim().min(1).max(MAX_NOTICE_LENGTH),
      level: z.enum(["info", "warning"]),
    })
    .nullable(),
  /**
   * Per-mode kill switch. A mode absent from the map is enabled: a new mode
   * must not be dark on the day it ships because nobody remembered to add a
   * row for it.
   */
  modes: z.record(z.string(), z.boolean()),
});

export type OpsFlags = z.infer<typeof opsFlagsSchema>;

export const DEFAULT_FLAGS: OpsFlags = { notice: null, modes: {} };

export const CONFIG_KEY = "ops-flags";

/** Tiny key/value persistence; Postgres in a deployment, memory otherwise. */
export interface ConfigStore {
  read(key: string): Promise<unknown>;
  write(key: string, value: unknown): Promise<void>;
}

export class InMemoryConfigStore implements ConfigStore {
  private readonly values = new Map<string, unknown>();

  read(key: string): Promise<unknown> {
    return Promise.resolve(this.values.get(key) ?? null);
  }

  write(key: string, value: unknown): Promise<void> {
    this.values.set(key, value);
    return Promise.resolve();
  }
}

export type FlagsListener = (flags: OpsFlags) => void;

export class OpsConfig {
  private flags: OpsFlags = DEFAULT_FLAGS;
  private readonly listeners = new Set<FlagsListener>();

  constructor(
    private readonly store: ConfigStore,
    private readonly log: Logger = nullLogger,
  ) {}

  /**
   * Load persisted flags at boot. A corrupt or half-written row is ignored
   * rather than fatal: booting with a stale banner beats not booting.
   */
  async load(): Promise<void> {
    try {
      const stored = await this.store.read(CONFIG_KEY);
      if (stored === null || stored === undefined) return;
      const parsed = opsFlagsSchema.safeParse(stored);
      if (parsed.success) this.flags = parsed.data;
      else this.log.warn({ event: "ops.flags_invalid" }, "stored ops flags ignored");
    } catch (error) {
      this.log.error({ event: "ops.flags_load_failed", err: error }, "could not load ops flags");
    }
  }

  get current(): OpsFlags {
    return this.flags;
  }

  /** Absent means enabled — see the note on the schema. */
  isModeEnabled(mode: string): boolean {
    return this.flags.modes[mode] !== false;
  }

  /**
   * Patch semantics: a key left out keeps its value, and `notice: null`
   * clears the banner. An explicit `undefined` is treated as "left out" —
   * a JSON body cannot express it, and reading it as "clear" would make
   * `{}` mean something destructive.
   */
  async update(patch: {
    notice?: OpsFlags["notice"] | undefined;
    modes?: OpsFlags["modes"] | undefined;
  }): Promise<OpsFlags> {
    const next = opsFlagsSchema.parse({
      ...this.flags,
      ...(patch.notice !== undefined ? { notice: patch.notice } : {}),
      ...(patch.modes !== undefined ? { modes: patch.modes } : {}),
    });
    this.flags = next;
    this.log.info(
      {
        event: "ops.flags_changed",
        notice: next.notice?.text ?? null,
        disabled:
          Object.entries(next.modes)
            .filter(([, on]) => !on)
            .map(([mode]) => mode)
            .join(",") || null,
      },
      "ops flags changed",
    );
    for (const listener of this.listeners) listener(next);
    // Persist after announcing: the banner appearing is the urgent half, and
    // a slow (or failed) write must not delay or prevent it.
    try {
      await this.store.write(CONFIG_KEY, next);
    } catch (error) {
      this.log.error({ event: "ops.flags_save_failed", err: error }, "ops flags not persisted");
    }
    return next;
  }

  subscribe(listener: FlagsListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
