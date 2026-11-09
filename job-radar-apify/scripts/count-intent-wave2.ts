/**
 * seo-intent-wave2, task 1: READ-ONLY inventory count before any code.
 *
 * Same method as scripts/count-intent-inventory.ts (seo-intent-pages):
 * "apta" = canonical row of its identity group (the sitemap's DISTINCT ON)
 * with seo_ready, active and valid. Country "page" = `country IS NULL OR
 * country = X`, the filter the pages use.
 *
 * Counts, per country (CO, VE):
 *   - "sin experiencia" (current D3 classifier) in Medellín and Cali;
 *   - every candidate intent (fines de semana, medio tiempo, por días,
 *     temporada), split by WHERE the explicit phrase appears: title only,
 *     strict description phrases, and any description mention (broad), plus
 *     the negations that would exclude a row;
 *   - employment_type values among aptas (the column stores Spanish labels,
 *     e.g. 'Medio tiempo', not schema.org tokens);
 *   - Ciudad Guayana / Puerto Ordaz / San Félix locations.
 * Then prints up to 15 recent sample titles per candidate (public job
 * titles only, no ids, no descriptions) so precision can be judged, and an
 * EXPLAIN of the costliest candidate predicate.
 *
 * Safety: one transaction, BEGIN READ ONLY, SET LOCAL statement_timeout,
 * ROLLBACK at the end. Nothing can be written from this connection.
 *
 *   cd job-radar-apify && npx tsx scripts/count-intent-wave2.ts
 */
import dotenv from "dotenv";
dotenv.config();

const { pool } = await import("../src/db/client.js");
const { sqlJobModality } = await import("../src/lib/job-modality.js");
const { sqlSinExperiencia } = await import("../src/lib/job-experience.js");
const { sqlSearchTitle } = await import("../src/lib/job-search-intent.js");

const T = sqlSearchTitle("j.title");
const D = sqlSearchTitle("j.description");
const any = (expr: string, phrases: string[]) =>
  `(${expr} LIKE ANY (ARRAY[${phrases.map((p) => `'% ${p.replace(/'/g, "''")} %'`).join(", ")}]::text[]))`;
const fold = (col: string) => `LOWER(TRANSLATE(COALESCE(${col}, ''), 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunAEIOUUN'))`;

// Candidate phrases, normalized like searchTitleText() (lowercase, no
// accents, punctuation -> one space). Fixed before the count (design D2).
const P = {
  fdsTitle: ["fin de semana", "fines de semana", "sabados y domingos", "sabado y domingo", "sabados domingos y festivos", "weekend", "weekends"],
  fdsDescStrict: [
    "solo fines de semana", "solo los fines de semana", "solamente fines de semana", "unicamente fines de semana",
    "unicamente los fines de semana", "exclusivamente fines de semana", "solo sabados y domingos",
    "unicamente sabados y domingos", "trabajo de fin de semana", "trabajo los fines de semana",
    "turnos de fin de semana", "turno de fin de semana", "para fines de semana", "por fines de semana"
  ],
  fdsNegation: [
    "no fines de semana", "sin fines de semana", "excepto fines de semana", "fines de semana libres",
    "libre los fines de semana", "libres los fines de semana", "no se trabaja fines de semana",
    "no trabaja fines de semana", "no se labora fines de semana"
  ],
  mtTitle: ["medio tiempo", "tiempo parcial", "part time", "media jornada", "jornada parcial", "medio turno"],
  mtNegation: ["no es medio tiempo", "no es tiempo parcial", "no es part time"],
  pdTitle: ["por dias", "por dia", "trabajo por dias", "pago diario", "pago por dia", "jornal", "jornales"],
  tempTitle: ["temporada", "por temporada", "temporada navidena", "temporada decembrina", "temporada alta", "navidad", "navideno", "navidena", "decembrino", "decembrina"],
  temporalTitle: ["temporal", "temporales"]
};

const canonicalReady = `
  SELECT canonical.id
  FROM (
    SELECT DISTINCT ON (lower(trim(title)), lower(trim(COALESCE(company, 'confidencial'))), lower(trim(COALESCE(location, CASE country WHEN 'VE' THEN 'venezuela' ELSE 'colombia' END))))
           id, seo_ready
    FROM jobs
    WHERE is_active = TRUE AND published_at >= NOW() - INTERVAL '30 days' AND (valid_through IS NULL OR valid_through > NOW())
    ORDER BY lower(trim(title)), lower(trim(COALESCE(company, 'confidencial'))), lower(trim(COALESCE(location, CASE country WHEN 'VE' THEN 'venezuela' ELSE 'colombia' END))), published_at DESC, id DESC
  ) canonical
  WHERE canonical.seo_ready = TRUE`;

const rowsCte = `
  WITH ready AS MATERIALIZED (${canonicalReady}),
  r AS MATERIALIZED (
    SELECT j.country, j.title, j.published_at, j.employment_type,
           ${fold("j.location")} AS loc,
           ${sqlSinExperiencia("j.title", "j.description")} AS sin_exp,
           ${sqlJobModality()} AS modality,
           ${any(T, P.fdsTitle)} AS fds_title,
           ${any(D, P.fdsDescStrict)} AS fds_desc_strict,
           ${any(D, P.fdsTitle)} AS fds_desc_any,
           (${any(T, P.fdsNegation)} OR ${any(D, P.fdsNegation)}) AS fds_neg,
           ${any(T, P.mtTitle)} AS mt_title,
           ${any(D, P.mtTitle)} AS mt_desc,
           (${any(T, P.mtNegation)} OR ${any(D, P.mtNegation)}) AS mt_neg,
           ${any(T, ["tiempo completo", "full time"])} AS ft_title,
           ${any(T, P.pdTitle)} AS pd_title,
           ${any(D, P.pdTitle)} AS pd_desc,
           ${any(T, P.tempTitle)} AS temp_title,
           ${any(D, P.tempTitle)} AS temp_desc,
           ${any(T, P.temporalTitle)} AS temporal_title
    FROM ready JOIN jobs j ON j.id = ready.id
  )`;

const page = "(country IS NULL OR country = c.code)";

const client = await pool.connect();
try {
  await client.query("BEGIN READ ONLY");
  await client.query("SET LOCAL statement_timeout = '60s'");

  const started = Date.now();
  const { rows } = await client.query(`${rowsCte}
    SELECT c.code,
      COUNT(*) FILTER (WHERE ${page}) AS ready_page,
      COUNT(*) FILTER (WHERE ${page} AND sin_exp AND loc LIKE '%medellin%') AS sin_exp_medellin,
      COUNT(*) FILTER (WHERE ${page} AND sin_exp AND loc LIKE '%cali%') AS sin_exp_cali,
      COUNT(*) FILTER (WHERE ${page} AND sin_exp AND loc ~ '(^|[^a-z])cali([^a-z]|$)') AS sin_exp_cali_word,
      COUNT(*) FILTER (WHERE ${page} AND fds_title) AS fds_title,
      COUNT(*) FILTER (WHERE ${page} AND fds_title AND NOT fds_neg) AS fds_title_no_neg,
      COUNT(*) FILTER (WHERE ${page} AND fds_desc_strict AND NOT fds_title) AS fds_desc_strict_only,
      COUNT(*) FILTER (WHERE ${page} AND (fds_title OR fds_desc_strict) AND NOT fds_neg) AS fds_candidate,
      COUNT(*) FILTER (WHERE ${page} AND fds_desc_any) AS fds_desc_any,
      COUNT(*) FILTER (WHERE ${page} AND fds_neg) AS fds_neg,
      COUNT(*) FILTER (WHERE ${page} AND employment_type = 'Medio tiempo') AS mt_type,
      COUNT(*) FILTER (WHERE ${page} AND employment_type = 'Medio tiempo' AND modality = 'remoto') AS mt_type_remoto,
      COUNT(*) FILTER (WHERE ${page} AND employment_type = 'Medio tiempo' AND country IS NULL) AS mt_type_sin_pais,
      COUNT(*) FILTER (WHERE ${page} AND mt_title) AS mt_title,
      COUNT(*) FILTER (WHERE ${page} AND mt_title AND ft_title) AS mt_title_and_full_time,
      COUNT(*) FILTER (WHERE ${page} AND mt_desc AND NOT mt_title) AS mt_desc_only,
      COUNT(*) FILTER (WHERE ${page} AND (mt_title OR employment_type = 'Medio tiempo') AND NOT mt_neg) AS mt_candidate,
      COUNT(*) FILTER (WHERE ${page} AND (mt_title OR employment_type = 'Medio tiempo') AND NOT mt_neg AND modality = 'remoto') AS mt_candidate_remoto,
      COUNT(*) FILTER (WHERE ${page} AND pd_title) AS pd_title,
      COUNT(*) FILTER (WHERE ${page} AND pd_desc AND NOT pd_title) AS pd_desc_only,
      COUNT(*) FILTER (WHERE ${page} AND employment_type = 'Por día') AS pd_type,
      COUNT(*) FILTER (WHERE ${page} AND temp_title) AS temp_title,
      COUNT(*) FILTER (WHERE ${page} AND temp_desc AND NOT temp_title) AS temp_desc_only,
      COUNT(*) FILTER (WHERE ${page} AND temporal_title) AS temporal_title,
      COUNT(*) FILTER (WHERE ${page} AND employment_type = 'Temporal') AS temporal_type,
      COUNT(*) FILTER (WHERE ${page} AND loc LIKE '%puerto ordaz%') AS loc_puerto_ordaz,
      COUNT(*) FILTER (WHERE ${page} AND loc LIKE '%ciudad guayana%') AS loc_ciudad_guayana,
      COUNT(*) FILTER (WHERE ${page} AND (loc LIKE '%puerto ordaz%' OR loc LIKE '%ciudad guayana%')) AS loc_po_or_cg,
      COUNT(*) FILTER (WHERE ${page} AND loc LIKE '%san felix%') AS loc_san_felix,
      COUNT(*) FILTER (WHERE country = c.code AND (loc LIKE '%puerto ordaz%' OR loc LIKE '%ciudad guayana%')) AS loc_po_or_cg_strict
    FROM r CROSS JOIN (VALUES ('CO'), ('VE')) AS c(code)
    GROUP BY c.code ORDER BY c.code`);
  console.log(JSON.stringify({ measuredAt: new Date().toISOString(), elapsedMs: Date.now() - started, counts: rows }, null, 2));

  const types = await client.query(`${rowsCte}
    SELECT COALESCE(country, '(null)') AS country, COALESCE(employment_type, '(null)') AS employment_type, COUNT(*) AS n
    FROM r GROUP BY 1, 2 ORDER BY 1, 3 DESC`);
  console.log(JSON.stringify({ employmentTypes: types.rows }, null, 2));

  // Precision check: recent public titles per candidate (CO page filter,
  // then VE). Titles only.
  const samples: Record<string, string> = {
    fds_title: "fds_title AND NOT fds_neg",
    fds_desc_strict_only: "fds_desc_strict AND NOT fds_title AND NOT fds_neg",
    fds_desc_any_only: "fds_desc_any AND NOT fds_title AND NOT fds_desc_strict",
    mt_title: "mt_title AND NOT mt_neg",
    mt_type_only: "employment_type = 'Medio tiempo' AND NOT mt_title",
    mt_desc_only: "mt_desc AND NOT mt_title AND employment_type IS DISTINCT FROM 'Medio tiempo'",
    pd_title: "pd_title",
    temp_title: "temp_title",
    temporal_title: "temporal_title",
    po_or_cg: "(loc LIKE '%puerto ordaz%' OR loc LIKE '%ciudad guayana%')"
  };
  for (const code of ["CO", "VE"]) {
    for (const [name, where] of Object.entries(samples)) {
      const sample = await client.query(
        `${rowsCte} SELECT title, loc, employment_type FROM r
         WHERE (country IS NULL OR country = $1) AND ${where}
         ORDER BY published_at DESC LIMIT 15`,
        [code]
      );
      console.log(JSON.stringify({ country: code, sample: name, rows: sample.rows }));
    }
  }

  // Cost of the costliest candidate predicate (description scan), as a page
  // would probe it per canonical row by primary key.
  const explain = await client.query(`
    EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
    WITH ready AS MATERIALIZED (${canonicalReady})
    SELECT COUNT(*) FROM ready
    WHERE EXISTS (SELECT 1 FROM jobs j WHERE j.id = ready.id AND (j.country IS NULL OR j.country = 'CO')
      AND (${any(T, P.fdsTitle)} OR ${any(D, P.fdsDescStrict)}) AND NOT (${any(T, P.fdsNegation)} OR ${any(D, P.fdsNegation)}))`);
  const root = (explain.rows[0]["QUERY PLAN"] as Array<{ "Execution Time": number; Plan: { "Shared Hit Blocks": number; "Shared Read Blocks": number } }>)[0];
  console.log(JSON.stringify({ explain: "fines de semana (CO)", executionMs: Math.round(root["Execution Time"]), sharedHit: root.Plan["Shared Hit Blocks"], sharedRead: root.Plan["Shared Read Blocks"] }));
} finally {
  await client.query("ROLLBACK").catch(() => undefined);
  client.release();
  await pool.end();
}
