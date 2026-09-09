import { describe, expect, it } from "vitest";
import {
  POWER_INFO,
  powerInfo,
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
      choiceDepth: 2,
      powerRecharge: "each-cycle",
      deckId: "legends",
    };
    // A deck id is a slug (#142): the catalogue, not the schema, says which
    // slugs exist, so the wire only refuses ones that cannot be an id at all.
    expect(roomSettingsPatchSchema.safeParse({ deckId: "kitchen-sink" }).success).toBe(true);
    expect(roomSettingsPatchSchema.safeParse({ deckId: "Kitchen Sink" }).success).toBe(false);
    expect(roomSettingsPatchSchema.safeParse({ deckId: "-nope-" }).success).toBe(false);
    expect(roomSettingsPatchSchema.safeParse({ powerRecharge: "sometimes" }).success).toBe(false);
    expect(roomSettingsSchema.safeParse(full).success).toBe(true);
    expect(roomSettingsPatchSchema.safeParse({ choiceDepth: 4 }).success).toBe(false);
    expect(roomSettingsPatchSchema.safeParse({ choiceDepth: 0 }).success).toBe(false);
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
        "game:command",
        "game:forfeit",
        "game:playCard",
        "game:selectStat",
        "queue:join",
        "queue:leave",
        "voice:signal",
        "voice:state",
        "room:create",
        "room:join",
        "room:leave",
        "room:ready",
        "room:rematch",
        "room:resume",
        "room:addBot",
        "room:removeBot",
        "room:settings",
        "room:start",
      ].sort(),
    );
  });
});

describe("power copy", () => {
  it("prints the defaults when the edition renames nothing", () => {
    expect(powerInfo(null, "powerplay").name).toBe(POWER_INFO.powerplay.name);
    expect(powerInfo({ powers: undefined }, "drs")).toEqual(POWER_INFO.drs);
  });

  it("takes the edition's words when it has its own (#143)", () => {
    const edition = {
      powers: {
        powerplay: {
          name: "Run-In",
          short: "RUN",
          tag: "the numbers game",
          blurb: "Help arrives.",
          when: "With your card.",
          win: "One extra from everyone you beat.",
          fail: "Give one extra away.",
        },
      },
    };
    expect(powerInfo(edition, "powerplay").name).toBe("Run-In");
    expect(powerInfo(edition, "powerplay").short).toBe("RUN");
    // A power it says nothing about keeps the original.
    expect(powerInfo(edition, "super-over").name).toBe(POWER_INFO["super-over"].name);
  });
});
