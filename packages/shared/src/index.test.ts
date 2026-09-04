import { describe, expect, it } from "vitest";
import { APP_NAME, PROTOCOL_VERSION } from "./index.js";

describe("@deckxi/shared", () => {
  it("exposes app constants", () => {
    expect(APP_NAME).toBe("DeckXI");
    expect(PROTOCOL_VERSION).toBe(2);
  });
});
