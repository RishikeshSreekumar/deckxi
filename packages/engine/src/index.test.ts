import { describe, expect, it } from "vitest";
import { ENGINE_NAME } from "./index.js";

describe("@deckxi/engine", () => {
  it("loads", () => {
    expect(ENGINE_NAME).toBe("@deckxi/engine");
  });
});
