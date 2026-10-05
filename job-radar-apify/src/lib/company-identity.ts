// Identity keys for "is this the same employer / the same vacancy?" — the
// one definition every listing query (dashboard, /empresas directory,
// /empresas/:slug, company filter) compares with.
//
// Why this exists (2026-10-05, measured on prod): the old key was
// lower(trim(company)) / lower(trim(location)), so each source's spelling
// of the same employer became its own company and its own copy of every
// vacancy:
//   - "Accenture Colombia" (64) | "Accenture" (14) | "Accenture Ltda" | "ACCENTURE LTDA"
//   - "ACTIVOS S.A.S" (100) | "ACTIVOS S A S" (74)
//   - "Consultor SAP FI" @ "Medellín" (Glassdoor) and @ "Medellin, Antioquia,
//     Colombia" (LinkedIn) listed twice.
// The keys only fold formatting (case, accents, punctuation, legal suffixes,
// a trailing country, the region/country tail of a location). They never
// fold different words: "Grupo Falabella" vs "Falabella" stay separate, and
// the same title in two different cities stays two vacancies.
//
// Stored, not computed per read: Postgres regex costs 20-50µs per row, and
// computing these keys inside every canonical query took the directory from
// 0.25s to 14-27s on 60k rows. A BEFORE INSERT/UPDATE trigger (generated from
// the builders below — schema.sql block `company-identity`, applied by
// scripts/migrate-company-identity.ts) fills jobs.title_key / company_key /
// location_key once per write, whichever code path writes the row. Reads use
// the stored column and only fall back to the expression for a row the
// backfill hasn't reached yet (COALESCE is lazy, so that costs nothing once
// backfilled).
//
// Deliberately NOT used by content_fingerprint / canonicalSql / the sitemap
// stream / getJobById: those keep the strict key. That is safe because the
// row this looser key keeps is always the newest row of its strict group too,
// so nothing a listing shows is missing from the sitemap.

// lower() runs first, so only lowercase accented letters are listed.
const ACCENTED = "áàäâãåāéèëêēíìïîīóòöôõōúùüûūñç";
const PLAIN = "aaaaaaaeeeeeiiiiioooooouuuuunc";

function unaccentLowerSql(expr: string): string {
  return `translate(lower(${expr}), '${ACCENTED}', '${PLAIN}')`;
}

// Every builder references each intermediate step exactly once: Postgres
// does not share common subexpressions, so a step used twice runs twice.

// Legal-form tails, matched only as a chain anchored at the END of the name
// (after punctuation became single spaces): "S.A.S." -> " s a s", "E.S.P." ->
// " e s p". Never stripped mid-name, and never the whole name (the leading
// space is required).
const LEGAL_SUFFIX_TAIL = String.raw`( (s a s|sas|s a|sa|ltda|limitada|e s p|esp|bic|inc|llc|ltd|corp|s de r l|srl|ca|c a))+$`;
// A trailing country is the source's regional label ("Accenture Colombia",
// "Bavaria - Colombia") — but not in "Universidad Nacional de Colombia"
// (negative lookbehind), and never a name that is only the country.
const COUNTRY_TAIL = String.raw`(?<! de| del) (colombia|venezuela)$`;

/**
 * SQL expression: employer identity key. "Accenture Colombia", "ACCENTURE
 * LTDA" and "Accenture" all -> 'accenture'; NULL -> 'confidencial'.
 * Expensive — evaluate it on a parameter or inside the write trigger, never
 * per row in a read query (use storedCompanyKeySql() there).
 */
export function companyKeySql(column = "company"): string {
  const spaced = `trim(regexp_replace(${unaccentLowerSql(`COALESCE(${column}, 'confidencial')`)}, '[^a-z0-9]+', ' ', 'g'))`;
  const noSuffix = `regexp_replace(${spaced}, '${LEGAL_SUFFIX_TAIL}', '')`;
  const noCountry = `regexp_replace(${noSuffix}, '${COUNTRY_TAIL}', '')`;
  return `replace(regexp_replace(${noCountry}, '${LEGAL_SUFFIX_TAIL}', ''), ' ', '')`;
}

/**
 * SQL expression: location identity key — the city part only, so
 * "Medellín", "Medellin, Antioquia, Colombia" and "Medellín Metropolitan
 * Area" match, and "Bogota, D.C., Capital District, Colombia" matches
 * "Bogotá, D.C.". A country-only location ("Colombia") stays its own key and
 * never merges into a city. Empty/NULL location -> the country, as before.
 */
export function locationKeySql(locationColumn = "location", countryColumn = "country"): string {
  const raw = `COALESCE(NULLIF(trim(${locationColumn}), ''), CASE ${countryColumn} WHEN 'VE' THEN 'venezuela' ELSE 'colombia' END)`;
  const city = `split_part(${unaccentLowerSql(raw)}, ',', 1)`;
  const spaced = `trim(regexp_replace(${city}, '[^a-z0-9]+', ' ', 'g'))`;
  return `replace(regexp_replace(${spaced}, '^(greater |area metropolitana (de |del )?)| (metropolitan area|area metropolitana|d c)$', '', 'g'), ' ', '')`;
}

/** SQL expression: title identity key (case, accents and punctuation folded). */
export function titleKeySql(column = "title"): string {
  return `regexp_replace(${unaccentLowerSql(`COALESCE(${column}, '')`)}, '[^a-z0-9]+', '', 'g')`;
}

/**
 * SQL predicate over an already-computed company key: the employer name is
 * a placeholder for an undisclosed employer ("Empresa Confidencial",
 * "-Confidencial-", "CONFIDENCIAL", "Anonima"), not a real company. These
 * must never appear in the company directory as if they were one employer.
 */
export function isPlaceholderCompanyKeySql(keyExpr: string): string {
  return `(${keyExpr} LIKE '%confidencial%' OR ${keyExpr} IN ('', 'anonima', 'anonimo', 'reservado', 'nodisponible', 'noespecificado'))`;
}

/** Read-path employer key of a `jobs` row: the stored column, cheap. */
export function storedCompanyKeySql(): string {
  return `COALESCE(company_key, ${companyKeySql()})`;
}

/** Column list naming the three identity keys (for DISTINCT ON / ORDER BY). */
export const VACANCY_IDENTITY_KEYS = "identity_title, identity_company, identity_location";

/**
 * Select-list fragment over `jobs` columns giving the three vacancy keys,
 * e.g.
 *   SELECT DISTINCT ON (VACANCY_IDENTITY_KEYS) ...
 *   FROM (SELECT jobs.*, ${vacancyIdentityColumnsSql()} FROM jobs WHERE ...) jobs
 *   ORDER BY VACANCY_IDENTITY_KEYS, published_at DESC, id DESC
 * Confidential employers keep the previous exact-spelling behavior inside
 * the vacancy key: two different anonymous employers posting the same title
 * in the same city must not collapse into one row.
 */
export function vacancyIdentityColumnsSql(): string {
  return (
    `COALESCE(title_key, ${titleKeySql()}) AS identity_title, ` +
    `(CASE WHEN lower(COALESCE(company, '')) LIKE '%confidencial%' THEN lower(trim(company)) ` +
    `ELSE ${storedCompanyKeySql()} END) AS identity_company, ` +
    `COALESCE(location_key, ${locationKeySql()}) AS identity_location`
  );
}

/** JS twin of the search folding (accents + case) for user-typed queries. */
export function foldSearchText(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

export function foldedCompanySql(column = "company"): string {
  return unaccentLowerSql(`COALESCE(${column}, '')`);
}

/**
 * DDL for schema.sql's `company-identity` block (kept byte-identical by
 * tests/validate-company-identity.test.ts): three nullable key columns —
 * metadata-only ADD COLUMN, no table rewrite — and the trigger that fills
 * them on every write that touches title/company/location/country.
 */
export function companyIdentitySchemaSql(): string {
  return [
    "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS title_key TEXT;",
    "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS company_key TEXT;",
    "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS location_key TEXT;",
    "CREATE OR REPLACE FUNCTION jobs_set_identity_keys() RETURNS trigger LANGUAGE plpgsql AS $fn$",
    "BEGIN",
    `  NEW.title_key := ${titleKeySql("NEW.title")};`,
    `  NEW.company_key := ${companyKeySql("NEW.company")};`,
    `  NEW.location_key := ${locationKeySql("NEW.location", "NEW.country")};`,
    "  RETURN NEW;",
    "END",
    "$fn$;",
    "DROP TRIGGER IF EXISTS trg_jobs_identity_keys ON jobs;",
    "CREATE TRIGGER trg_jobs_identity_keys",
    "  BEFORE INSERT OR UPDATE OF title, company, location, country ON jobs",
    "  FOR EACH ROW EXECUTE FUNCTION jobs_set_identity_keys();"
  ].join("\n");
}

/**
 * One backfill batch for rows written before the trigger existed. Returns
 * the number of rows it filled; 0 means done. Idempotent.
 */
export function companyIdentityBackfillBatchSql(batchSize: number): string {
  const size = Math.min(Math.max(Math.trunc(batchSize), 1), 50_000);
  return `UPDATE jobs SET
      title_key = ${titleKeySql()},
      company_key = ${companyKeySql()},
      location_key = ${locationKeySql()}
    WHERE id IN (
      SELECT id FROM jobs
      WHERE title_key IS NULL OR company_key IS NULL OR location_key IS NULL
      LIMIT ${size}
    )`;
}
