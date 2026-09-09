/**
 * An edition declares the modes it can be played in (#143). Squad Draft reads
 * roles, bowling and overs, so an edition of another sport says it plays the
 * trumps modes only — and the server, not just the lobby, holds that line.
 */
import { describe, expect, it, vi } from "vitest";
import type * as DataModule from "@deckxi/data";

/** The fixture edition, re-declared as a trumps-only one for these tests. */
const TRUMPS_ONLY = "edition-fixture";

vi.mock("@deckxi/data", async (importOriginal) => {
  const actual = await importOriginal<typeof DataModule>();
  return {
    ...actual,
    loadEdition: (id?: string) => {
      const edition = actual.loadEdition(id);
      return id === TRUMPS_ONLY
        ? { ...edition, supportedModes: ["classic-trumps", "power-trumps"] }
        : edition;
    },
  };
});

const { RoomManager } = await import("./rooms.js");
const observer = {
  roomState: () => undefined,
  roomClosed: () => undefined,
  gameEvents: () => undefined,
  timer: () => undefined,
};

describe("edition supportedModes", () => {
  it("refuses a room in a mode the edition does not play", () => {
    const manager = new RoomManager(observer);
    expect(() =>
      manager.createRoom("Host", { gameMode: "squad-draft", editionId: TRUMPS_ONLY }),
    ).toThrow(/not played in squad-draft/);
  });

  it("refuses to switch a room onto one, and takes the modes it does play", () => {
    const manager = new RoomManager(observer);
    const { room, session } = manager.createRoom("Host", { editionId: TRUMPS_ONLY });
    expect(() => manager.updateSettings(session.id, { gameMode: "squad-draft" })).toThrow(
      /not played in squad-draft/,
    );
    manager.updateSettings(session.id, { gameMode: "power-trumps" });
    expect(room.settings.gameMode).toBe("power-trumps");
  });

  it("leaves the cricket edition playing everything", () => {
    const manager = new RoomManager(observer);
    const { room } = manager.createRoom("Host", { gameMode: "squad-draft" });
    expect(room.settings.gameMode).toBe("squad-draft");
  });
});
