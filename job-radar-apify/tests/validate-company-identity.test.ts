import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  companyIdentityBackfillBatchSql,
  companyIdentitySchemaSql,
  vacancyIdentityColumnsSql
} from "../src/lib/company-identity.js";

/**
 * Company/vacancy identity keys (bug 2026-10-05: the same employer and the
 * same vacancy repeated once per source spelling). Offline only — the key
 * semantics are exercised against Postgres by validate-companies-search.ts.
 */

test("schema.sql's company-identity block is exactly the generated DDL", () => {
  const schema = readFileSync(new URL("../src/db/schema.sql", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const block = /-- BEGIN company-identity\n([\s\S]*?)-- END company-identity/.exec(schema)?.[1];
  assert.ok(block, "schema.sql no contiene el bloque company-identity");
  const ddl = block
    .split("\n")
    .filter((line) => !line.startsWith("-- "))
    .join("\n")
    .trim();
  assert.equal(ddl, companyIdentitySchemaSql());
});

test("the migration is additive: nullable columns, no rewrite, no destructive DDL", () => {
  const ddl = companyIdentitySchemaSql();
  assert.equal((ddl.match(/ADD COLUMN IF NOT EXISTS \w+ TEXT;/g) || []).length, 3);
  assert.doesNotMatch(ddl, /\b(DROP (TABLE|COLUMN)|DELETE|TRUNCATE|GENERATED|NOT NULL|DEFAULT)\b/i);
});

test("read path reads the stored keys and only falls back per NULL row", () => {
  const select = vacancyIdentityColumnsSql();
  assert.match(select, /COALESCE\(title_key, /);
  assert.match(select, /COALESCE\(company_key, /);
  assert.match(select, /COALESCE\(location_key, /);
});

test("backfill batches are bounded", () => {
  assert.match(companyIdentityBackfillBatchSql(10_000_000), /LIMIT 50000\b/);
  assert.match(companyIdentityBackfillBatchSql(0), /LIMIT 1\b/);
});
