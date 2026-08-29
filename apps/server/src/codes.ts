/**
 * Join codes: 6 chars from an unambiguous alphabet (32^6 ≈ 1B codes),
 * generated with rejection against the live set.
 */
import { randomInt } from "node:crypto";
import { JOIN_CODE_ALPHABET, JOIN_CODE_LENGTH } from "@deckxi/shared";

export function generateJoinCode(inUse: ReadonlySet<string>): string {
  // With ≤ a few hundred live rooms collisions are vanishingly rare; the cap
  // turns a broken caller (a full code space) into an error instead of a hang.
  for (let attempt = 0; attempt < 100; attempt++) {
    let code = "";
    for (let i = 0; i < JOIN_CODE_LENGTH; i++) {
      code += JOIN_CODE_ALPHABET[randomInt(JOIN_CODE_ALPHABET.length)];
    }
    if (!inUse.has(code)) return code;
  }
  throw new Error("could not generate a unique join code");
}
