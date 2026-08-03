/**
 * Search Console sitemap check/submit (SEO Fase 6 follow-up, see
 * docs/SEO-PLAN.md §5.7). Reuses the same GOOGLE_INDEXING_CLIENT_EMAIL/
 * GOOGLE_INDEXING_PRIVATE_KEY service account as the Indexing API
 * (google-indexing.ts) — it was granted Owner on the buscotrabajo.co
 * property specifically so it could publish JobPosting URLs (docs/
 * SEO-PLAN.md §7.2), and Owner on a Search Console property also grants
 * full Search Console API access, sitemaps included. No new credential to
 * set up.
 *
 * Read-only by default (AGENTS.md #10 — every external write-capable
 * operation supports --dry-run; here dry-run IS the default, matching
 * notion:sync's "dry-run-first" convention): lists verified properties and
 * their sitemap status. Only actually submits (PUT) when run with
 * --submit, and only after confirming the property/siteUrl format via
 * sites.list — guessing the siteUrl format wrong (URL-prefix vs
 * sc-domain:) produces a 403 that looks like a permissions failure but
 * isn't one.
 *
 * --inspect: per-URL indexing diagnostics via urlInspection.index.inspect.
 * There is NO bulk "list all indexed/unindexed URLs" endpoint in the
 * Search Console API — sitemaps.list only gives aggregate counts
 * (submitted/indexed) per sitemap, not which specific URLs fall into which
 * bucket. That full breakdown only exists in the Search Console UI
 * (Indexación → Páginas), which has no API equivalent. What IS possible:
 * inspecting individual URLs one at a time to see WHY Google hasn't
 * indexed them (coverageState), which is more actionable than a raw list
 * anyway. Kept to a small fixed sample — this endpoint has a real daily
 * quota, this is a diagnostic spot-check, not a crawl.
 */
import dotenv from "dotenv";
import { buildJwtAssertion, readCredentials } from "../src/lib/google-indexing.js";

dotenv.config();

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SITEMAP_URL = "https://buscotrabajo.co/sitemap.xml";
const INSPECT_URL = "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect";

// Representative sample: static top-of-funnel pages (both countries),
// plus one city and one role category page per country (city vs role
// category pages follow different prefix rules — see job-seo.ts) — these
// are the pages the user wants people to land on from search, per their
// explicit ask this session ("la idea es que la gente llegue a la
// plataforma por las vacantes"). No job-detail URLs here since those
// churn (jobs age out) and would go stale as a hardcoded list.
const SAMPLE_URLS = [
  "https://buscotrabajo.co/",
  "https://buscotrabajo.co/ve",
  "https://buscotrabajo.co/dashboard",
  "https://buscotrabajo.co/ve/dashboard",
  "https://buscotrabajo.co/empleos/bogota",
  "https://buscotrabajo.co/empleos/caracas",
  "https://buscotrabajo.co/empleos/project-manager",
  "https://buscotrabajo.co/ve/empleos/project-manager",
  "https://buscotrabajo.co/empresas"
];

async function getAccessToken(scope: string): Promise<string> {
  const { clientEmail, privateKey } = readCredentials();
  const now = Math.floor(Date.now() / 1000);
  const assertion = buildJwtAssertion(clientEmail, privateKey, now, scope);

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Google OAuth token exchange failed (${response.status}): ${body}`);
  }

  const data = (await response.json()) as { access_token: string };
  return data.access_token;
}

type InspectResult = {
  verdict?: string;
  coverageState?: string;
  robotsTxtState?: string;
  pageFetchState?: string;
  lastCrawlTime?: string;
};

async function inspectOne(
  token: string,
  siteUrl: string,
  inspectionUrl: string
): Promise<InspectResult | null> {
  const res = await fetch(INSPECT_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ inspectionUrl, siteUrl })
  });
  if (!res.ok) {
    console.error(`     ❌ inspect failed (${res.status}): ${await res.text()}`);
    return null;
  }
  const data = (await res.json()) as {
    inspectionResult?: {
      indexStatusResult?: {
        verdict?: string;
        coverageState?: string;
        robotsTxtState?: string;
        pageFetchState?: string;
        lastCrawlTime?: string;
      };
    };
  };
  return data.inspectionResult?.indexStatusResult ?? null;
}

async function runInspectSample(readToken: string, siteUrl: string) {
  console.log(
    `\n🔬 [check-search-console] Inspecting ${SAMPLE_URLS.length} representative URLs via urlInspection.index.inspect...`
  );
  console.log(
    "   (No bulk 'list all indexed/unindexed URLs' endpoint exists in the Search Console API — " +
      "that per-URL breakdown only lives in the UI at Indexación → Páginas. This checks a fixed " +
      "sample one-by-one to see the actual reason, since the endpoint has a daily quota.)\n"
  );
  for (const url of SAMPLE_URLS) {
    const result = await inspectOne(readToken, siteUrl, url);
    if (!result) continue;
    console.log(`   ${url}`);
    console.log(
      `     verdict=${result.verdict ?? "—"}  coverageState="${result.coverageState ?? "—"}"`
    );
    console.log(
      `     robotsTxtState=${result.robotsTxtState ?? "—"}  pageFetchState=${result.pageFetchState ?? "—"}  lastCrawlTime=${result.lastCrawlTime ?? "—"}`
    );
  }
}

async function main() {
  const submit = process.argv.includes("--submit");
  const inspect = process.argv.includes("--inspect");

  if (!process.env.GOOGLE_INDEXING_CLIENT_EMAIL || !process.env.GOOGLE_INDEXING_PRIVATE_KEY) {
    console.log("⏭️  [check-search-console] Google credentials not configured — nothing to do.");
    return;
  }

  console.log("🔍 [check-search-console] Listing properties the service account can see...");
  const readToken = await getAccessToken("https://www.googleapis.com/auth/webmasters.readonly");
  const sitesRes = await fetch("https://www.googleapis.com/webmasters/v3/sites", {
    headers: { Authorization: `Bearer ${readToken}` }
  });
  if (!sitesRes.ok) {
    console.error(`❌ sites.list failed (${sitesRes.status}): ${await sitesRes.text()}`);
    return;
  }
  const sitesData = (await sitesRes.json()) as {
    siteEntry?: { siteUrl: string; permissionLevel: string }[];
  };
  const entries = sitesData.siteEntry || [];
  if (entries.length === 0) {
    console.log(
      "⚠️  No properties visible to this service account. Owner was granted for the Indexing API " +
        "specifically — it may not carry over to the Search Console API's own permission model. " +
        "This has to be confirmed/fixed manually in Search Console → Configuración → Usuarios y permisos, " +
        "not from here."
    );
    return;
  }

  console.log(`   Found ${entries.length} propert${entries.length === 1 ? "y" : "ies"}:`);
  const match = entries.find((e) => e.siteUrl.includes("buscotrabajo.co"));
  for (const e of entries) {
    console.log(
      `   - ${e.siteUrl} (${e.permissionLevel})${e === match ? "  ← buscotrabajo.co" : ""}`
    );
  }

  if (!match) {
    console.log("⚠️  No property matching buscotrabajo.co found — stopping here.");
    return;
  }

  const siteUrl = match.siteUrl;

  if (inspect) {
    await runInspectSample(readToken, siteUrl);
    return;
  }

  console.log(`\n📄 [check-search-console] Checking known sitemaps for ${siteUrl}...`);
  const sitemapsRes = await fetch(
    `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/sitemaps`,
    { headers: { Authorization: `Bearer ${readToken}` } }
  );
  if (!sitemapsRes.ok) {
    console.error(`❌ sitemaps.list failed (${sitemapsRes.status}): ${await sitemapsRes.text()}`);
    return;
  }
  const sitemapsData = (await sitemapsRes.json()) as {
    sitemap?: {
      path: string;
      lastSubmitted?: string;
      lastDownloaded?: string;
      isPending?: boolean;
      errors?: { count: string }[];
      contents?: { type: string; submitted: string; indexed?: string }[];
    }[];
  };
  const known = sitemapsData.sitemap || [];
  if (known.length === 0) {
    console.log("   No sitemaps known to Search Console yet for this property.");
  }
  for (const sm of known) {
    console.log(`   - ${sm.path}`);
    console.log(
      `     lastSubmitted: ${sm.lastSubmitted ?? "—"}  lastDownloaded: ${sm.lastDownloaded ?? "—"}  pending: ${sm.isPending ?? "—"}`
    );
    if (sm.contents) {
      for (const c of sm.contents) {
        console.log(
          `     ${c.type}: submitted=${c.submitted}${c.indexed ? ` indexed=${c.indexed}` : ""}`
        );
      }
    }
  }

  const ourSitemapKnown = known.some((sm) => sm.path === SITEMAP_URL);

  if (!submit) {
    console.log(
      `\n${ourSitemapKnown ? "✅ " + SITEMAP_URL + " is already known to Search Console." : "⚠️  " + SITEMAP_URL + " is not listed above."} ` +
        "Dry-run (default) — re-run with --submit to actually PUT it."
    );
    return;
  }

  console.log(`\n📤 [check-search-console] --submit passed — submitting ${SITEMAP_URL}...`);
  const writeToken = await getAccessToken("https://www.googleapis.com/auth/webmasters");
  const submitRes = await fetch(
    `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/sitemaps/${encodeURIComponent(SITEMAP_URL)}`,
    { method: "PUT", headers: { Authorization: `Bearer ${writeToken}` } }
  );
  if (submitRes.ok) {
    console.log(
      "✅ Submitted successfully (Search Console's sitemaps.submit returns no body on success)."
    );
  } else {
    console.error(`❌ Submit failed (${submitRes.status}): ${await submitRes.text()}`);
  }
}

main().catch((err) => {
  console.error("❌ [check-search-console] Fatal error:", err);
  process.exit(1);
});
