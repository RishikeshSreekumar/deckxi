/**
 * Admin CLI for dataset curation.
 *
 *   pnpm --filter @deckxi/data cli <command> [...args] [--edition <id>]
 *
 * Commands:
 *   list [teamId]                       players (id, role, rarity, rating)
 *   show <playerId>                     full card
 *   set-stat <playerId> <stat> <value>  edit one stat value
 *   set-rarity <playerId> <rarity>      regular | star | legend
 *   add-player <json>                   player JSON without `rating`
 *   remove-player <playerId>
 *   regen-ratings                       re-derive all ratings
 *
 * Every write bumps the edition version, re-derives ratings and validates
 * against the schema before saving.
 */
import { writeFileSync } from "node:fs";
import type { Edition, Player, Rarity } from "@deckxi/shared";
import {
  addPlayer,
  regenAllRatings,
  removePlayer,
  setPlayerRarity,
  setPlayerStat,
} from "../admin.js";
import { CURRENT_EDITION_ID, editionPath, loadEdition } from "../editions.js";

const args = process.argv
  .slice(2)
  .filter((a, i, all) => a !== "--edition" && all[i - 1] !== "--edition");
const editionFlag = process.argv.indexOf("--edition");
const editionId =
  editionFlag === -1 ? CURRENT_EDITION_ID : (process.argv[editionFlag + 1] ?? CURRENT_EDITION_ID);
const [command, ...rest] = args;

function save(edition: Edition): void {
  writeFileSync(editionPath(editionId), JSON.stringify(edition, null, 2) + "\n");
  console.log(`saved ${editionId} v${edition.version}`);
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const edition = loadEdition(editionId);

switch (command) {
  case "list": {
    const teamId = rest[0];
    const players = edition.players.filter((p) => teamId === undefined || p.teamId === teamId);
    for (const p of players) {
      console.log(
        `${p.id.padEnd(24)} ${p.role.padEnd(11)} ${p.rarity.padEnd(7)} ${String(p.rating).padStart(5)}  ${p.name}`,
      );
    }
    break;
  }
  case "show": {
    const player = edition.players.find((p) => p.id === rest[0]);
    if (player === undefined) fail(`no such player: ${rest[0]}`);
    console.log(JSON.stringify(player, null, 2));
    break;
  }
  case "set-stat": {
    const [playerId, stat, value] = rest;
    if (playerId === undefined || stat === undefined || Number.isNaN(Number(value))) {
      fail("usage: set-stat <playerId> <stat> <value>");
    }
    save(setPlayerStat(edition, playerId, stat, Number(value)));
    break;
  }
  case "set-rarity": {
    const [playerId, rarity] = rest;
    if (playerId === undefined || !["regular", "star", "legend"].includes(rarity ?? "")) {
      fail("usage: set-rarity <playerId> <regular|star|legend>");
    }
    save(setPlayerRarity(edition, playerId, rarity as Rarity));
    break;
  }
  case "add-player": {
    if (rest[0] === undefined) fail("usage: add-player '<json>'");
    save(addPlayer(edition, JSON.parse(rest[0]) as Omit<Player, "rating">));
    break;
  }
  case "remove-player": {
    if (rest[0] === undefined) fail("usage: remove-player <playerId>");
    save(removePlayer(edition, rest[0]));
    break;
  }
  case "regen-ratings": {
    save(regenAllRatings(edition));
    break;
  }
  default:
    fail(`unknown command: ${command ?? "(none)"} — see the header of this file for usage`);
}
