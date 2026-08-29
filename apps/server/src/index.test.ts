import { describe, expect, it } from "vitest";
import { serverInfo } from "./index.js";

describe("@deckxi/server", () => {
  it("reports server info", () => {
    expect(serverInfo()).toBe("DeckXI server (protocol v1)");
  });
});
