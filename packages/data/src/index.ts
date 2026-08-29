/**
 * @deckxi/data — versioned card editions (players, teams, stat definitions)
 * and the content pipeline that maintains them.
 */
export const DATA_NAME = "@deckxi/data";

export {
  CURRENT_EDITION_ID,
  editionPath,
  editionsDir,
  listEditionIds,
  loadEdition,
} from "./editions.js";
export { computeRating, normalizedStat, regenerateRatings } from "./rating.js";
export { analyzeBalance, dominates, formatBalanceReport, type BalanceReport } from "./balance.js";
export { driftEdition, topMovers, type DriftResult } from "./drift.js";
export {
  addPlayer,
  regenAllRatings,
  removePlayer,
  setPlayerRarity,
  setPlayerStat,
} from "./admin.js";
