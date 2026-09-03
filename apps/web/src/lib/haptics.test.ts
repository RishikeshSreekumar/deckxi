import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Unit tests run in node: stand in for the two browser globals the module touches. */
function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
    key: () => null,
    get length() {
      return map.size;
    },
  };
}

describe("haptics", () => {
  const vibrate = vi.fn(() => true);

  beforeEach(() => {
    vi.resetModules();
    vibrate.mockClear();
    vi.stubGlobal("localStorage", memoryStorage());
    vi.stubGlobal("navigator", { vibrate });
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("pulses when supported and enabled (the default)", async () => {
    const { haptics, hapticsEnabled, hapticsSupported } = await import("./haptics.js");
    expect(hapticsSupported()).toBe(true);
    expect(hapticsEnabled()).toBe(true);
    haptics.win();
    expect(vibrate).toHaveBeenCalledWith(30);
  });

  it("is silent once the setting is off, and remembers that", async () => {
    const first = await import("./haptics.js");
    first.setHapticsEnabled(false);
    first.haptics.tap();
    expect(vibrate).not.toHaveBeenCalled();

    vi.resetModules();
    const second = await import("./haptics.js");
    expect(second.hapticsEnabled()).toBe(false);
  });

  it("degrades silently where the API is missing", async () => {
    vi.stubGlobal("navigator", {});
    const { haptics, hapticsSupported } = await import("./haptics.js");
    expect(hapticsSupported()).toBe(false);
    expect(() => haptics.yourTurn()).not.toThrow();
  });

  it("respects prefers-reduced-motion", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const { haptics } = await import("./haptics.js");
    haptics.win();
    expect(vibrate).not.toHaveBeenCalled();
  });
});
