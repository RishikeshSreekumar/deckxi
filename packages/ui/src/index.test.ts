import { describe, expect, it } from "vitest";
import { UI_NAME } from "./index.js";

describe("@deckxi/ui", () => {
  it("loads", () => {
    expect(UI_NAME).toBe("@deckxi/ui");
  });
});
