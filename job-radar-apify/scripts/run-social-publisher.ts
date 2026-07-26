import dotenv from "dotenv";
import { publishPendingDigests } from "../src/social/publisher.js";
import { pool } from "../src/db/client.js";

dotenv.config();

// Real script file instead of `tsx -e "..."` inline eval — tsx's `.js` ->
// `.ts` relative-import resolution (used everywhere else in this repo, e.g.
// `tsx src/server.ts` importing `./db/job-repository.js`) doesn't apply the
// same way to code passed via `-e` with no real file backing it, which is
// why the GitHub Actions step failed with "Cannot find module
// './src/social/publisher.js'" on every run.
async function main() {
  const result = await publishPendingDigests();
  console.log("Publish result:", result);
  await pool.end();
}

main().catch(async (err) => {
  console.error("❌ [SocialPublisher] Error inesperado:", err?.message || err);
  await pool.end();
  process.exit(1);
});
