import { describe, expect, it } from "vitest";
import {
  chatSendSchema,
  clientMessageSchemas,
  createRoomSchema,
  joinCodeSchema,
  joinRoomSchema,
  MAX_CHAT_LENGTH,
  roomSettingsPatchSchema,
  roomSettingsSchema,
  selectStatSchema,
} from "./protocol.js";

describe("protocol schemas", () => {
  it("normalises join codes to uppercase", () => {
    expect(joinCodeSchema.parse("abcdef")).toBe("ABCDEF");
  });

  it("rejects join codes with ambiguous characters", () => {
    for (const code of ["ABC0EF", "ABCO1F", "ABC", "ABCDEFG"]) {
      expect(joinCodeSchema.safeParse(code).success, code).toBe(false);
    }
  });

  it("validates room creation", () => {
    expect(createRoomSchema.safeParse({ name: "Rishi" }).success).toBe(true);
    expect(createRoomSchema.safeParse({ name: "  " }).success).toBe(false);
    expect(createRoomSchema.safeParse({ name: "x".repeat(25) }).success).toBe(false);
    expect(
      createRoomSchema.safeParse({ name: "ok", settings: { cardsPerPlayer: 7 } }).success,
    ).toBe(true);
  });

  it("rejects control characters in names", () => {
    expect(joinRoomSchema.safeParse({ code: "ABCDEF", name: "a\u0000b" }).success).toBe(false);
  });

  it("bounds room settings", () => {
    const full = {
      gameMode: "classic-trumps",
      editionId: "edition-2026-q3",
      cardsPerPlayer: 5,
      turnTimerSeconds: 20,
      maxRounds: 200,
    };
    expect(roomSettingsSchema.safeParse(full).success).toBe(true);
    expect(roomSettingsPatchSchema.safeParse({ turnTimerSeconds: 3 }).success).toBe(false);
    expect(roomSettingsPatchSchema.safeParse({ cardsPerPlayer: 12 }).success).toBe(false);
    expect(roomSettingsPatchSchema.safeParse({ editionId: "not-an-edition" }).success).toBe(false);
  });

  it("caps chat length", () => {
    expect(chatSendSchema.safeParse({ text: "hi" }).success).toBe(true);
    expect(chatSendSchema.safeParse({ text: "x".repeat(MAX_CHAT_LENGTH + 1) }).success).toBe(false);
    expect(chatSendSchema.safeParse({ text: "   " }).success).toBe(false);
  });

  it("validates stat keys as camelCase", () => {
    expect(selectStatSchema.safeParse({ stat: "battingAverage" }).success).toBe(true);
    expect(selectStatSchema.safeParse({ stat: "DROP TABLE" }).success).toBe(false);
  });

  it("has a schema for every inbound message", () => {
    expect(Object.keys(clientMessageSchemas).sort()).toEqual(
      [
        "chat:react",
        "chat:send",
        "game:forfeit",
        "game:selectStat",
        "room:create",
        "room:join",
        "room:leave",
        "room:ready",
        "room:rematch",
        "room:resume",
        "room:settings",
        "room:start",
      ].sort(),
    );
  });
});
