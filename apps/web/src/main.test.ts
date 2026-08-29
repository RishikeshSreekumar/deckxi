import { describe, expect, it } from "vitest";
import { appTitle } from "./main.js";

describe("@deckxi/web", () => {
  it("has an app title", () => {
    expect(appTitle()).toBe("DeckXI");
  });
});
