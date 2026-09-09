/**
 * One playtester's browser. The driver deliberately exposes only what a human
 * has: a picture of the screen, the text on it, and the list of things that
 * can be clicked or typed into. Nothing reaches into app state, so whatever an
 * agent cannot work out from the screen is a real usability finding.
 */
import { chromium, devices } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const DEVICES = {
  desktop: { viewport: { width: 1280, height: 860 } },
  mobile: devices["iPhone 14"],
  tablet: devices["iPad (gen 7)"],
};

/**
 * Runs in the page: tag every interactive element with a ref the agent can
 * name. Refs are regenerated on every observation — an agent must observe
 * before it acts.
 */
function collect() {
  const selector =
    'button, a[href], input, select, textarea, [role="button"], [role="tab"], [contenteditable="true"]';
  for (const tagged of document.querySelectorAll("[data-playtest-ref]")) {
    tagged.removeAttribute("data-playtest-ref");
  }
  const controls = [];
  for (const node of document.querySelectorAll(selector)) {
    const box = node.getBoundingClientRect();
    if (box.width === 0 && box.height === 0) continue;
    if (getComputedStyle(node).visibility === "hidden") continue;
    const ref = String(controls.length + 1);
    node.setAttribute("data-playtest-ref", ref);
    const text = (node.innerText ?? "").trim().slice(0, 60);
    controls.push({
      ref,
      tag: node.tagName.toLowerCase(),
      type: node.getAttribute("type") ?? undefined,
      label:
        node.getAttribute("aria-label") ??
        node.getAttribute("placeholder") ??
        (text === "" ? (node.getAttribute("title") ?? "") : text),
      testid: node.getAttribute("data-testid") ?? undefined,
      value: "value" in node ? String(node.value ?? "").slice(0, 60) : undefined,
      options: node.tagName === "SELECT" ? Array.from(node.options).map((o) => o.value) : undefined,
      disabled: node.disabled === true,
    });
  }
  return {
    text: document.body.innerText.replace(/\n{3,}/g, "\n\n").slice(0, 6000),
    controls,
  };
}

export class Player {
  constructor({ id, name, device, webUrl, outDir }) {
    this.id = id;
    this.name = name;
    this.device = device;
    this.webUrl = webUrl;
    this.outDir = outDir;
    this.shotCount = 0;
    /** Console errors, uncaught exceptions and failed requests, for the report. */
    this.problems = [];
  }

  async open(browser) {
    this.context = await browser.newContext(DEVICES[this.device] ?? DEVICES.desktop);
    this.page = await this.context.newPage();
    this.page.on("console", (message) => {
      if (message.type() === "error") this.problem("console", message.text());
    });
    this.page.on("pageerror", (error) => this.problem("exception", String(error)));
    this.page.on("requestfailed", (request) =>
      this.problem(
        "network",
        `${request.method()} ${request.url()} — ${request.failure()?.errorText}`,
      ),
    );
    await mkdir(path.join(this.outDir, "shots"), { recursive: true });
    await this.page.goto(this.webUrl);
    await this.proveCapture();
  }

  /**
   * An empty problem list is only good news if the hooks are wired: the
   * first run returned zero problems for five browsers and nobody could say
   * whether that meant a clean match or a dead listener. So every player
   * starts by throwing one deliberate console error and checking it landed.
   * The probe is removed again; `captureVerified` goes in the report.
   */
  async proveCapture() {
    const marker = `playtest-capture-probe-${this.id}`;
    await this.page.evaluate((m) => console.error(m), marker);
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      if (this.problems.some((p) => p.kind === "console" && p.detail.includes(marker))) break;
      await this.page.waitForTimeout(50);
    }
    const index = this.problems.findIndex((p) => p.detail.includes(marker));
    this.captureVerified = index !== -1;
    if (index !== -1) this.problems.splice(index, 1);
    if (!this.captureVerified) {
      this.problem("harness", "console capture did not receive the probe error");
    }
  }

  problem(kind, detail) {
    this.problems.push({ at: new Date().toISOString(), kind, detail: detail.slice(0, 500) });
  }

  async observe({ screenshot = true } = {}) {
    // Let an in-flight reveal animation or route change settle first.
    await this.page.waitForTimeout(400);
    const { text, controls } = await this.page.evaluate(collect);
    let shot;
    if (screenshot) {
      this.shotCount += 1;
      const file = `${this.id}-${String(this.shotCount).padStart(3, "0")}.png`;
      shot = path.join(this.outDir, "shots", file);
      await this.page.screenshot({ path: shot });
    }
    return {
      player: this.id,
      url: this.page.url(),
      screenshot: shot,
      text,
      controls,
      newProblems: this.problems.slice(-5),
    };
  }

  target(ref) {
    return this.page.locator(`[data-playtest-ref="${ref}"]`);
  }

  async click(ref) {
    await this.target(ref).click({ timeout: 5000 });
  }

  async type(ref, text) {
    await this.target(ref).fill(text, { timeout: 5000 });
  }

  async select(ref, value) {
    await this.target(ref).selectOption(value, { timeout: 5000 });
  }

  async goto(pathname) {
    await this.page.goto(new URL(pathname, this.webUrl).toString());
  }

  async close() {
    await this.context?.close();
  }
}

export async function launchBrowser() {
  return chromium.launch({ headless: process.env["PLAYTEST_HEADED"] !== "1" });
}
