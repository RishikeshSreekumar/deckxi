import { describe, expect, it } from "vitest";
import { DATA_NAME } from "./index.js";

describe("@deckxi/data", () => {
  it("loads", () => {
    expect(DATA_NAME).toBe("@deckxi/data");
  });
});
