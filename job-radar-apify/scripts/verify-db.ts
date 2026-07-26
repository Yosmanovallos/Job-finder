import dotenv from "dotenv";
import { pool } from "../src/db/client.js";
dotenv.config();

async function verify() {
  const active = await pool.query("SELECT COUNT(*) as total FROM jobs WHERE is_active = TRUE");
  console.log("✅ Active jobs:", active.rows[0].total);

  const deactivated = await pool.query("SELECT COUNT(*) as total FROM jobs WHERE is_active = FALSE");
  console.log("🗑️  Deactivated dupes:", deactivated.rows[0].total);

  const withFp = await pool.query("SELECT COUNT(*) as total FROM jobs WHERE content_fingerprint IS NOT NULL AND is_active = TRUE");
  console.log("🔑 With fingerprint:", withFp.rows[0].total);

  const remaining = await pool.query(`
    SELECT lower(trim(title)) AS t, lower(trim(COALESCE(company, 'confidencial'))) AS c, COUNT(*) AS copies
    FROM jobs WHERE is_active = TRUE
    GROUP BY t, c HAVING COUNT(*) > 1
    ORDER BY copies DESC LIMIT 5
  `);
  
  if (remaining.rows.length === 0) {
    console.log("🎉 ZERO remaining duplicates by title+company!");
  } else {
    console.log("⚠️  Remaining duplicates (by title+company only, location may differ):");
    for (const r of remaining.rows) {
      console.log(`   "${r.t}" @ "${r.c}" — ${r.copies} copies`);
    }
  }

  await pool.end();
}

verify().catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
