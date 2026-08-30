/**
 * Metrics (#66) — in-process counters exposed on `/metrics` in Prometheus
 * text format.
 *
 * No metrics vendor and no Prometheus server: the whole thing is a few maps in
 * the process, and scraping is a curl away. Cost of that choice, stated
 * plainly: counters reset when the instance restarts, and there is no history.
 * For a single-instance server whose rooms already die on restart, that is the
 * honest boundary — the long-term view of "is it up" comes from the uptime
 * check, and the long-term view of "what happened" comes from the logs, which
 * are retained. Point any scraper at the endpoint later and history appears
 * without touching this file.
 */

export interface Labels {
  [key: string]: string;
}

interface Histogram {
  help: string;
  buckets: number[];
  counts: number[];
  sum: number;
  count: number;
}

/** Sorted so `{a:"1",b:"2"}` and `{b:"2",a:"1"}` are the same series. */
function labelKey(labels: Labels | undefined): string {
  if (labels === undefined) return "";
  return Object.keys(labels)
    .sort()
    .map((k) => `${k}="${escapeLabel(labels[k] ?? "")}"`)
    .join(",");
}

function escapeLabel(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

/** Game lengths, in seconds: seconds-long games are bugs, an hour is a stall. */
const DURATION_BUCKETS = [15, 30, 60, 120, 300, 600, 1800];

export class Metrics {
  private readonly counters = new Map<string, Map<string, number>>();
  private readonly counterHelp = new Map<string, string>();
  private readonly gauges = new Map<string, { help: string; read: () => number }>();
  private readonly histograms = new Map<string, Histogram>();

  constructor() {
    this.histograms.set("deckxi_game_duration_seconds", {
      help: "Wall-clock length of finished games",
      buckets: DURATION_BUCKETS,
      counts: new Array<number>(DURATION_BUCKETS.length + 1).fill(0),
      sum: 0,
      count: 0,
    });
  }

  /** Register a counter's help text up front so it appears even at zero. */
  declareCounter(name: string, help: string): void {
    this.counterHelp.set(name, help);
    if (!this.counters.has(name)) this.counters.set(name, new Map());
  }

  increment(name: string, labels?: Labels): void {
    let series = this.counters.get(name);
    if (series === undefined) {
      series = new Map();
      this.counters.set(name, series);
    }
    const key = labelKey(labels);
    series.set(key, (series.get(key) ?? 0) + 1);
  }

  /** Gauges are pull-based: the source of truth stays where it lives. */
  gauge(name: string, help: string, read: () => number): void {
    this.gauges.set(name, { help, read });
  }

  observeGameDuration(seconds: number): void {
    const histogram = this.histograms.get("deckxi_game_duration_seconds");
    if (histogram === undefined) return;
    histogram.sum += seconds;
    histogram.count++;
    const found = histogram.buckets.findIndex((upper) => seconds <= upper);
    const index = found === -1 ? histogram.buckets.length : found;
    histogram.counts[index] = (histogram.counts[index] ?? 0) + 1;
  }

  /** Prometheus text exposition (`text/plain; version=0.0.4`). */
  render(): string {
    const lines: string[] = [];

    for (const [name, help] of this.counterHelp) {
      const series = this.counters.get(name) ?? new Map<string, number>();
      lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} counter`);
      if (series.size === 0) lines.push(`${name} 0`);
      for (const [key, value] of series) {
        lines.push(key === "" ? `${name} ${value}` : `${name}{${key}} ${value}`);
      }
    }

    for (const [name, { help, read }] of this.gauges) {
      lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} gauge`, `${name} ${read()}`);
    }

    for (const [name, histogram] of this.histograms) {
      lines.push(`# HELP ${name} ${histogram.help}`, `# TYPE ${name} histogram`);
      let cumulative = 0;
      histogram.buckets.forEach((upper, i) => {
        cumulative += histogram.counts[i] ?? 0;
        lines.push(`${name}_bucket{le="${upper}"} ${cumulative}`);
      });
      cumulative += histogram.counts[histogram.buckets.length] ?? 0;
      lines.push(
        `${name}_bucket{le="+Inf"} ${cumulative}`,
        `${name}_sum ${histogram.sum}`,
        `${name}_count ${histogram.count}`,
      );
    }

    return `${lines.join("\n")}\n`;
  }
}

/**
 * The metric set, declared in one place so `/metrics` answers with every
 * series from boot — a counter that only appears after the first event is a
 * counter you cannot write an alert against.
 */
export function createMetrics(): Metrics {
  const metrics = new Metrics();
  metrics.declareCounter("deckxi_rooms_created_total", "Rooms created");
  metrics.declareCounter("deckxi_rooms_closed_total", "Rooms closed, by reason");
  metrics.declareCounter("deckxi_room_joins_total", "Players and spectators joining a room");
  metrics.declareCounter("deckxi_games_started_total", "Games started");
  metrics.declareCounter("deckxi_games_finished_total", "Games finished, by end reason");
  metrics.declareCounter("deckxi_socket_connections_total", "Socket connections accepted");
  metrics.declareCounter("deckxi_commands_total", "Client commands handled, by command");
  metrics.declareCounter("deckxi_command_rejections_total", "Commands refused, by error code");
  metrics.declareCounter("deckxi_command_failures_total", "Command handlers that threw");
  metrics.declareCounter("deckxi_chat_messages_total", "Chat messages relayed");
  metrics.declareCounter("deckxi_client_errors_total", "Browser error reports, by kind");
  metrics.declareCounter("deckxi_store_write_failures_total", "Persistence writes that failed");
  metrics.gauge("deckxi_uptime_seconds", "Process uptime", () => Math.round(process.uptime()));
  return metrics;
}
