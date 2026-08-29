/**
 * CI gate: validate every edition against the schema and fail on balance
 * problems. Prints the balance report for the PR log.
 *
 *   pnpm --filter @deckxi/data check
 */
import { listEditionIds, loadEdition } from "../editions.js";
import { analyzeBalance, formatBalanceReport } from "../balance.js";

let failed = false;
for (const id of listEditionIds()) {
  try {
    const edition = loadEdition(id); // throws on schema violations
    const report = analyzeBalance(edition);
    console.log(formatBalanceReport(report));
    console.log("");
    if (report.problems.length > 0) failed = true;
  } catch (error) {
    console.error(`✗ ${id}: ${error instanceof Error ? error.message : String(error)}`);
    failed = true;
  }
}

if (failed) {
  console.error("edition check FAILED");
  process.exit(1);
}
console.log("all editions valid and balanced");
