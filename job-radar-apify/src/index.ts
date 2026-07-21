import { Client } from '@notionhq/client';
import dotenv from 'dotenv';
import { gotScraping } from 'got-scraping';
import { htmlEntities } from './utils.js';
import { saveRunToCache } from './cache-manager.js';

dotenv.config();

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID;
const APIFY_TOKEN = process.env.APIFY_TOKEN;

if (!NOTION_TOKEN || !NOTION_DATABASE_ID) {
  console.error('Error: NOTION_TOKEN or NOTION_DATABASE_ID is not defined in .env file.');
  process.exit(1);
}

const notion = new Client({ auth: NOTION_TOKEN });

interface Job {
  jobId: string;
  title: string;
  company: string;
  location: string;
  url: string;
  dateText: string;
  source: 'LinkedIn' | 'Computrabajo' | 'Elempleo' | 'Torre' | 'Indeed' | 'Workana' | 'Magneto' | 'WeRemoto' | 'GetOnBoard' | 'RemoteOK' | 'Remotive' | 'Glassdoor';
  publishedAt: string; // YYYY-MM-DD
}

// Store available database properties
let dbProperties: Record<string, string> = {};

async function fetchDatabaseSchema() {
  try {
    const response = await (notion as any).dataSources.retrieve({ data_source_id: NOTION_DATABASE_ID! });
    console.log('[Notion] Connected successfully as Data Source! Schema retrieved.');
    dbProperties = {};
    const raw = response.properties ?? {};
    for (const [key, val] of Object.entries(raw)) {
      dbProperties[key] = (val as any).type;
    }
    console.log('[Notion] Available properties:', Object.keys(dbProperties).join(', '));
  } catch (error) {
    console.error('[Notion] Error fetching data source schema. Check NOTION_TOKEN and NOTION_DATABASE_ID:', error);
    process.exit(1);
  }
}

// Check if a job already exists in Notion
async function jobExists(url: string): Promise<boolean> {
  try {
    if (!dbProperties['URL']) {
      return false;
    }
    const response = await (notion as any).dataSources.query({
      data_source_id: NOTION_DATABASE_ID!,
      filter: {
        property: "URL",
        url: {
          equals: url
        }
      }
    });
    return response.results.length > 0;
  } catch (error) {
    console.error(`Error querying Notion for URL ${url}:`, error);
    return false;
  }
}

// Date Range Configuration Helper
const DATE_RANGE = process.env.DATE_RANGE || '48h';

function getDateRangeConfig(range: string = process.env.DATE_RANGE || '48h') {
  switch (range) {
    case '24h': return { maxDays: 1, linkedinTpr: 'r86400', workanaPub: '24h', label: 'Hoy (Últimas 24 Horas)' };
    case '48h': return { maxDays: 2, linkedinTpr: 'r172800', workanaPub: '48h', label: 'Últimas 48 Horas' };
    case '7d':  return { maxDays: 7, linkedinTpr: 'r604800', workanaPub: '1w', label: 'Última Semana (7 Días)' };
    case '14d': return { maxDays: 14, linkedinTpr: 'r1209600', workanaPub: '1w', label: 'Últimos 14 Días' };
    case '30d': return { maxDays: 30, linkedinTpr: 'r2592000', workanaPub: '1m', label: 'Último Mes (30 Días)' };
    case 'all': return { maxDays: 365, linkedinTpr: '', workanaPub: 'all', label: 'Cualquier Fecha' };
    default:    return { maxDays: 2, linkedinTpr: 'r172800', workanaPub: '48h', label: 'Últimas 48 Horas' };
  }
}

// Convert date text to standard YYYY-MM-DD
function parseDateText(dateText: string, source: string, maxDays: number = 2): { date: string, valid: boolean } {
  const now = new Date();
  let daysAgo = 0;
  let valid = false;

  const text = dateText.toLowerCase();
  const numMatch = text.match(/(\d+)/);
  const num = numMatch ? parseInt(numMatch[1], 10) : 1;

  if (text.includes('second') || text.includes('segundo') || text.includes('minute') || text.includes('minuto') || text.includes('hour') || text.includes('hora') || text.includes('now') || text.includes('hoy')) {
    daysAgo = 0;
    valid = true;
  } else if (text.includes('yesterday') || text.includes('ayer') || text.includes('1 day') || text.includes('1 día') || text.includes('1 dia')) {
    daysAgo = 1;
    valid = true;
  } else if (text.includes('day') || text.includes('día') || text.includes('dia')) {
    daysAgo = num;
    valid = num <= maxDays;
  } else if (text.includes('week') || text.includes('semana')) {
    daysAgo = num * 7;
    valid = daysAgo <= maxDays;
  } else if (text.includes('month') || text.includes('mes')) {
    daysAgo = num * 30;
    valid = daysAgo <= maxDays;
  } else {
    daysAgo = 0;
    valid = true;
  }

  if (!valid) {
    return { date: '', valid: false };
  }

  const targetDate = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);
  const yyyy = targetDate.getFullYear();
  const mm = String(targetDate.getMonth() + 1).padStart(2, '0');
  const dd = String(targetDate.getDate()).padStart(2, '0');
  return { date: `${yyyy}-${mm}-${dd}`, valid: true };
}

// Scrape LinkedIn Guest Jobs API (paginated with dynamic DATE_RANGE filter)
async function scrapeLinkedIn(keyword: string): Promise<Job[]> {
  const query = encodeURIComponent(keyword);
  const rangeConfig = getDateRangeConfig();
  console.log(`[LinkedIn] Scraping for keyword "${keyword}" (Filtro: ${rangeConfig.label})...`);
  const jobs: Job[] = [];

  const tprParam = rangeConfig.linkedinTpr ? `&f_TPR=${rangeConfig.linkedinTpr}` : '';

  try {
    for (const start of [0, 25, 50]) {
      const url = `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=${query}&location=Colombia${tprParam}&start=${start}`;
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        }
      });

      if (!response.ok) {
        if (start === 0) console.warn(`[LinkedIn] Failed: ${response.status} ${response.statusText}`);
        break;
      }

      const html = await response.text();
      const items = html.split(/<li\b[^>]*>/);
      if (items.length <= 1) break;

      for (let i = 1; i < items.length; i++) {
        const item = items[i];
        const urnMatch = item.match(/data-entity-urn="urn:li:jobPosting:(\d+)"/);
        const jobId = urnMatch ? urnMatch[1] : '';
        
        const titleMatch = item.match(/<h3 class="base-search-card__title">[^]*?<\/h3>/);
        const title = titleMatch ? htmlEntities(titleMatch[0].replace(/<[^>]+>/g, '').trim()) : '';
        
        const companyMatch = item.match(/<h4 class="base-search-card__subtitle">[^]*?<\/h4>/);
        const company = companyMatch ? htmlEntities(companyMatch[0].replace(/<[^>]+>/g, '').trim()) : 'Confidencial';
        
        const locMatch = item.match(/<span class="job-search-card__location">[^]*?<\/span>/);
        const location = locMatch ? htmlEntities(locMatch[0].replace(/<[^>]+>/g, '').trim()) : 'Colombia';
        
        const dateMatch = item.match(/<time[^>]*>([^<]+)<\/time>/);
        const dateText = dateMatch ? dateMatch[1].trim() : '1 day ago';
        
        const urlMatch = item.match(/href="([^"]+)"/);
        const jobUrl = urlMatch ? urlMatch[1].split('?')[0] : '';

        const dateParsed = parseDateText(dateText, 'LinkedIn', rangeConfig.maxDays);

        if (jobId && title && dateParsed.valid) {
          jobs.push({
            jobId,
            title,
            company,
            location,
            url: jobUrl,
            dateText,
            source: 'LinkedIn',
            publishedAt: dateParsed.date
          });
        }
      }
    }
    console.log(`[LinkedIn] Found ${jobs.length} jobs.`);
    return jobs;
  } catch (error) {
    console.error('[LinkedIn] Fetch error:', error);
    return jobs;
  }
}

// Scrape Computrabajo Colombia with Google Translate Cloud Proxy Bypass (100% IP Block Protection)
async function scrapeComputrabajo(keyword: string): Promise<Job[]> {
  const query = encodeURIComponent(keyword.replace(/\s+/g, '-'));
  const rangeConfig = getDateRangeConfig();
  console.log(`[Computrabajo] Scraping for keyword "${keyword}" (Multi-page, Filtro: ${rangeConfig.label})...`);
  const jobs: Job[] = [];

  try {
    for (let page = 1; page <= 3; page++) {
      const pathPart = page === 1 ? `trabajo-de-${query}` : `trabajo-de-${query}?p=${page}`;
      const proxyUrl = `https://www-computrabajo-com-co.translate.goog/${pathPart}?_x_tr_sl=es&_x_tr_tl=en&_x_tr_hl=es`;

      let html = '';
      try {
        const proxyRes = await fetch(proxyUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept-Language': 'es-CO,es;q=0.9'
          }
        });
        if (proxyRes.ok) {
          html = await proxyRes.text();
        }
      } catch (proxyErr: any) {
        console.warn(`[Computrabajo] Proxy fetch error: ${proxyErr.message}`);
      }

      if (!html) break;

      const articles = html.split(/<article\b[^>]*>/i);
      if (articles.length <= 1) break;

      for (let i = 1; i < articles.length; i++) {
        const item = articles[i];
        const titleLinkMatch = item.match(/<a class="[^"]*js-o-link[^"]*" href="([^"]+)">\s*([^<]+)\s*<\/a>/i) ||
                               item.match(/href="([^"]*oferta-de-trabajo-[^"]+)"[^>]*>\s*([^<]+)\s*<\/a>/i);
        if (!titleLinkMatch) continue;

        const rawHref = titleLinkMatch[1];
        const title = htmlEntities(titleLinkMatch[2].trim());
        
        const cleanPath = rawHref
          .replace('https://co-computrabajo-com.translate.goog', '')
          .replace('https://www-computrabajo-com-co.translate.goog', '')
          .split('?')[0]
          .split('#')[0];

        const cleanPathFormatted = cleanPath.startsWith('/') ? cleanPath : `/${cleanPath}`;
        const canonicalUrl = `https://www.computrabajo.com.co${cleanPathFormatted}`;
        const jobUrl = `https://www.google.com/url?q=${encodeURIComponent(canonicalUrl)}`;

        const idMatch = rawHref.match(/-([A-F0-9]{32})/i);
        const jobId = idMatch ? idMatch[1] : `ct-${Math.random()}`;

        const companyMatch = item.match(/offer-grid-article-company-url[^>]*>\s*([^<]+)\s*<\/a>/i) ||
                             item.match(/class="fc_base t_ellipsis"[^>]*>\s*([^<]+)\s*<\/a>/i);
        const company = companyMatch ? htmlEntities(companyMatch[1].trim()) : 'Confidencial';

        const locMatch = item.match(/<p class="fs16 fc_base mt5">\s*<span class="mr10">\s*([^<]+)\s*<\/span>/i);
        const location = locMatch ? htmlEntities(locMatch[1].replace(/\s+/g, ' ').trim()) : 'Colombia';

        const dateMatch = item.match(/<p class="fs13 fc_aux mt15">\s*([^<]+)\s*<\/p>/i);
        const dateText = dateMatch ? dateMatch[1].trim() : 'Hoy';

        const dateParsed = parseDateText(dateText, 'Computrabajo', rangeConfig.maxDays);

        if (jobId && title && dateParsed.valid) {
          jobs.push({
            jobId,
            title,
            company,
            location,
            url: jobUrl,
            dateText,
            source: 'Computrabajo',
            publishedAt: dateParsed.date
          });
        }
      }

      await new Promise(r => setTimeout(r, 400));
    }
    console.log(`[Computrabajo] Found ${jobs.length} jobs across pages.`);
    return jobs;
  } catch (error) {
    console.error('[Computrabajo] Fetch error:', error);
    return jobs;
  }
}

// Scrape Elempleo Colombia with Multi-page Pagination
async function scrapeElempleo(keyword: string): Promise<Job[]> {
  console.log(`[Elempleo] Scraping for keyword "${keyword}" (Multi-page)...`);
  const jobs: Job[] = [];

  try {
    for (let page = 1; page <= 5; page++) {
      const url = `https://www.elempleo.com/co/ofertas-empleo?trabajo=${encodeURIComponent(keyword)}&p=${page}`;

      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        }
      });

      if (!response.ok) {
        if (page === 1) console.warn(`[Elempleo] Failed: ${response.status} ${response.statusText}`);
        break;
      }

      const html = await response.text();
      const items = html.split('result-item mb-3 bg-white');
      if (items.length <= 1) break;

      for (let i = 1; i < items.length; i++) {
        const item = items[i];
        const dataMatch = item.match(/data-ga4-offerdata="([^"]+)"/);
        if (!dataMatch) continue;

        const jsonStr = dataMatch[1]
          .replaceAll('&quot;', '"')
          .replaceAll('&#225;', 'á')
          .replaceAll('&#233;', 'é')
          .replaceAll('&#237;', 'í')
          .replaceAll('&#243;', 'ó')
          .replaceAll('&#250;', 'ú')
          .replaceAll('&#241;', 'ñ')
          .replaceAll('&#193;', 'Á')
          .replaceAll('&#201;', 'É')
          .replaceAll('&#205;', 'Í')
          .replaceAll('&#211;', 'Ó')
          .replaceAll('&#218;', 'Ú')
          .replaceAll('&#209;', 'Ñ');

        try {
          const data = JSON.parse(jsonStr);
          const urlMatch = item.match(/data-url="([^"]+)"/);
          const relativeUrl = urlMatch ? urlMatch[1] : '';
          const jobUrl = `https://www.elempleo.com${relativeUrl}`;

          const dateMatch = item.match(/js-offer-date[^>]*>[^]*?<\/i>\s*([^<]+)\s*<\/span>/);
          const dateText = dateMatch ? dateMatch[1].trim() : 'Hoy';

          const dateParsed = parseDateText(dateText, 'Elempleo');

          if (data.id && data.title && dateParsed.valid) {
            jobs.push({
              jobId: String(data.id),
              title: htmlEntities(data.title),
              company: htmlEntities(data.company),
              location: htmlEntities(data.location),
              url: jobUrl,
              dateText,
              source: 'Elempleo',
              publishedAt: dateParsed.date
            });
          }
        } catch (e) {
          // Skip
        }
      }
    }
    console.log(`[Elempleo] Found ${jobs.length} jobs across pages.`);
    return jobs;
  } catch (error) {
    console.error('[Elempleo] Fetch error:', error);
    return jobs;
  }
}

// Scrape Torre.co opportunities API directly
async function scrapeTorre(keyword: string): Promise<Job[]> {
  console.log(`[Torre] Searching for keyword "${keyword}"...`);
  const url = "https://search.torre.co/opportunities/_search?offset=0&size=20";
  const body = {
    "skill/role": { "text": keyword, "experience": "1-plus-year" }
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      console.warn(`[Torre] Failed: ${response.status} ${response.statusText}`);
      return [];
    }

    const data: any = await response.json();
    const jobs: Job[] = [];
    const now = new Date();

    if (data.results && Array.isArray(data.results)) {
      for (const item of data.results) {
        let createdDate = now;
        if (item.created) {
          createdDate = new Date(item.created);
          const ageInMs = now.getTime() - createdDate.getTime();
          const ageInDays = ageInMs / (1000 * 60 * 60 * 24);
          if (ageInDays > 14) continue; // max 14 days old
        }

        const locations = item.locations || [];
        const isColombia = locations.some((loc: string) => loc.toLowerCase().includes('colombia'));
        const isRemote = item.remote === true || locations.length === 0;

        if (isColombia || isRemote) {
          const yyyy = createdDate.getFullYear();
          const mm = String(createdDate.getMonth() + 1).padStart(2, '0');
          const dd = String(createdDate.getDate()).padStart(2, '0');
          
          jobs.push({
            jobId: item.id,
            title: htmlEntities(item.objective || 'Oportunidad Torre'),
            company: htmlEntities(item.organizations?.[0]?.name || 'Confidencial'),
            location: isRemote ? 'Remoto' : locations.join(', '),
            url: `https://torre.ai/jobs/${item.id}`,
            dateText: 'Reciente',
            source: 'Torre',
            publishedAt: `${yyyy}-${mm}-${dd}`
          });
        }
      }
    }
    console.log(`[Torre] Found ${jobs.length} jobs.`);
    return jobs;
  } catch (error) {
    console.error('[Torre] Fetch error:', error);
    return [];
  }
}

// Scrape Workana Colombia/Remote directly from HTML options payload.
async function scrapeWorkana(keyword: string): Promise<Job[]> {
  console.log(`[Workana] Searching for keyword "${keyword}"...`);
  const query = encodeURIComponent(keyword.toLowerCase());
  const jobs: Job[] = [];

  try {
    for (let page = 1; page <= 5; page++) {
      const url = `https://www.workana.com/jobs?query=${query}&publication=1w&page=${page}`;
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      });

      if (!response.ok) {
        if (page === 1) console.warn(`[Workana] Failed: ${response.status} ${response.statusText}`);
        break;
      }

      const html = await response.text();
      const startKey = ":results-initials='";
      const startIdx = html.indexOf(startKey);
      if (startIdx === -1) break;

      const valueStart = startIdx + startKey.length;
      const endIdx = html.indexOf("'", valueStart);
      const rawValue = html.substring(valueStart, endIdx);
      const decodedValue = rawValue.replaceAll('&quot;', '"').replaceAll('&#39;', "'");

      try {
        const parsed = JSON.parse(decodedValue);
        const results = parsed.results;
        if (!Array.isArray(results) || results.length === 0) break;

        for (const item of results) {
          const titleMatch = item.title ? item.title.match(/title="([^"]+)"/) : null;
          const title = titleMatch ? titleMatch[1] : (item.title || '').replace(/<[^>]+>/g, '').trim();

          const urlMatch = item.title ? item.title.match(/href="([^"]+)"/) : null;
          const jobUrl = urlMatch ? `https://www.workana.com${urlMatch[1]}` : `https://www.workana.com/job/${item.slug}`;

          const countryText = item.country ? item.country.replace(/<[^>]+>/g, '').trim() : 'Colombia';
          const dateText = item.publishedDate ? item.publishedDate.replace('Publicado: ', '').trim() : 'Hoy';
          const dateParsed = parseDateText(dateText, 'Workana');

          if (title && dateParsed.valid) {
            jobs.push({
              jobId: item.slug || String(Math.random()),
              title: htmlEntities(title),
              company: htmlEntities(item.authorName || 'Confidencial'),
              location: htmlEntities(countryText),
              url: jobUrl,
              dateText,
              source: 'Workana',
              publishedAt: dateParsed.date
            });
          }
        }

        const totalPages = parsed.pagination?.pages ?? page;
        if (page >= totalPages) break;
      } catch (e) {
        break;
      }
    }
    console.log(`[Workana] Found ${jobs.length} jobs (filtered by date).`);
    return jobs;
  } catch (error) {
    console.error('[Workana] Fetch error:', error);
    return jobs;
  }
}

// Scrape Magneto365 Colombia directly from NEXT payload and JSON-LD schema
async function scrapeMagneto(keyword: string): Promise<Job[]> {
  console.log(`[Magneto] Searching for keyword "${keyword}"...`);
  const query = encodeURIComponent(keyword);
  const url = `https://www.magneto365.com/co/empleos?q=${query}`;
  const jobs: Job[] = [];
  const now = new Date();

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    if (!response.ok) {
      console.warn(`[Magneto] Failed: ${response.status} ${response.statusText}`);
      return [];
    }

    const html = await response.text();

    // 1. Next.js payload search results (rows)
    const matches = html.match(/self\.__next_f\.push\(\[1,"([\s\S]*?)"\]\)/g) || [];
    let combined = '';
    for (const m of matches) {
      combined += m.replace('self.__next_f.push([1,"', '').replace('"])', '');
    }

    const unescaped = combined
      .replaceAll('\\"', '"')
      .replaceAll('\\/', '/')
      .replaceAll('\\n', ' ');

    const startKey = '"rows":[';
    const startIdx = unescaped.indexOf(startKey);
    if (startIdx !== -1) {
      const arrayStartIdx = startIdx + startKey.length - 1;
      let bracketCount = 0;
      let endIdx = -1;
      for (let i = arrayStartIdx; i < unescaped.length; i++) {
        if (unescaped[i] === '[') bracketCount++;
        else if (unescaped[i] === ']') {
          bracketCount--;
          if (bracketCount === 0) { endIdx = i; break; }
        }
      }
      if (endIdx !== -1) {
        try {
          const rows = JSON.parse(unescaped.substring(arrayStartIdx, endIdx + 1));
          if (Array.isArray(rows)) {
            for (const r of rows) {
              const isRemote = r.isRemote === true;
              const locationText = isRemote ? 'Remoto' : (r.cities || []).join(', ') || 'Colombia';
              jobs.push({
                jobId: String(r.id || Math.random()),
                title: htmlEntities(r.title || 'Oferta Magneto'),
                company: htmlEntities(r.companyName || 'Confidencial'),
                location: htmlEntities(locationText),
                url: `https://www.magneto365.com/co/empleos/${r.jobSlug}`,
                dateText: 'Reciente',
                source: 'Magneto',
                publishedAt: new Date().toISOString().split('T')[0]
              });
            }
          }
        } catch (e) {}
      }
    }

    // 2. Schema.org fallback if Next.js rows missing
    if (jobs.length === 0) {
      const ldJsonMatches = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi) || [];
      for (const script of ldJsonMatches) {
        if (script.includes('"ItemList"')) {
          try {
            const content = script.replace(/<script[^>]*>/i, '').replace(/<\/script>/i, '').trim();
            const parsed = JSON.parse(content);
            if (parsed.itemListElement && Array.isArray(parsed.itemListElement)) {
              for (const el of parsed.itemListElement) {
                if (el.url && el.url.includes('/empleos/')) {
                  const jobUrl = el.url;
                  const slug = jobUrl.split('/empleos/')[1] || '';
                  const parts = slug.split('-');
                  const titleWords = parts.filter(p => !/^\d+$/.test(p));
                  const title = titleWords.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
                  
                  if (title && title.length > 3) {
                    jobs.push({
                      jobId: slug || String(Math.random()),
                      title: htmlEntities(title),
                      company: 'Magneto Empresa',
                      location: 'Colombia',
                      url: jobUrl,
                      dateText: 'Hoy',
                      source: 'Magneto',
                      publishedAt: new Date().toISOString().split('T')[0]
                    });
                  }
                }
              }
            }
          } catch (e) {}
        }
      }
    }

    console.log(`[Magneto] Found ${jobs.length} jobs.`);
    return jobs;
  } catch (error) {
    console.error('[Magneto] Fetch error:', error);
    return jobs;
  }
}

// Scrape WeRemoto directly from server-rendered HTML.
// Note: the jobs board is fully server-rendered on the homepage (Finsweet
// CMS pagination via ?c370efcf_page=N) — there is no Jetboost API call
// involved, that's only used for saved-job bookmarking elsewhere on the
// site. The dedicated category pages (/categoria-de-trabajo/*) render an
// empty CMS collection server-side and only populate client-side, so we
// paginate the homepage instead and filter locally.
async function scrapeWeRemoto(): Promise<Job[]> {
  console.log('[WeRemoto] Scraping recent postings...');
  const jobs: Job[] = [];
  const now = new Date();
  const monthMap: Record<string, number> = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11
  };

  try {
    for (let page = 1; page <= 8; page++) {
      const url = page === 1 ? 'https://www.weremoto.com/' : `https://www.weremoto.com/?c370efcf_page=${page}`;
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      });

      if (!response.ok) {
        console.warn(`[WeRemoto] Failed on page ${page}: ${response.status} ${response.statusText}`);
        break;
      }

      const html = await response.text();
      const items = html.split('job-item-accordion w-dyn-item');
      if (items.length <= 1) break; // No more paginated items

      for (let i = 1; i < items.length; i++) {
        const item = items[i];
        const titleMatch = item.match(/class="job-title">([^<]+)</);
        const companyMatch = item.match(/class="company-name">([^<]+)</);
        const hrefMatch = item.match(/href="(\/job-posts\/[^"]+)"\s+target="_blank"\s+class="job-button-view/);
        const dateMatch = item.match(/class="date _2">([^<]+)</);

        if (!titleMatch || !hrefMatch || !dateMatch) continue;

        // Location can appear as an invisible empty conditional div followed
        // by the real value, so pick the first non-empty match in the chunk.
        const locMatches = [...item.matchAll(/class="remoto[^"]*">([^<]*)</g)];
        const nonEmptyLoc = locMatches.map(m => m[1].trim()).find(v => v.length > 0);
        const location = nonEmptyLoc ? htmlEntities(nonEmptyLoc) : 'Remoto';

        const dm = dateMatch[1].trim().match(/^([A-Za-z]{3})\s+(\d{1,2})$/);
        if (!dm) continue;
        const monthIdx = monthMap[dm[1].toLowerCase()];
        if (monthIdx === undefined) continue;
        const day = parseInt(dm[2], 10);

        let candidate = new Date(now.getFullYear(), monthIdx, day);
        if (candidate.getTime() - now.getTime() > 24 * 60 * 60 * 1000) {
          // A date resolving into the future actually belongs to last year
          candidate = new Date(now.getFullYear() - 1, monthIdx, day);
        }

        const ageInDays = (now.getTime() - candidate.getTime()) / (1000 * 60 * 60 * 24);
        if (ageInDays > 2 || ageInDays < -0.5) continue;

        const yyyy = candidate.getFullYear();
        const mm = String(candidate.getMonth() + 1).padStart(2, '0');
        const dd = String(candidate.getDate()).padStart(2, '0');

        jobs.push({
          jobId: hrefMatch[1].replace('/job-posts/', ''),
          title: htmlEntities(titleMatch[1].trim()),
          company: companyMatch ? htmlEntities(companyMatch[1].trim()) : 'Confidencial',
          location,
          url: `https://www.weremoto.com${hrefMatch[1]}`,
          dateText: dateMatch[1].trim(),
          source: 'WeRemoto',
          publishedAt: `${yyyy}-${mm}-${dd}`
        });
      }
    }
  } catch (error) {
    console.error('[WeRemoto] Fetch error:', error);
  }
  console.log(`[WeRemoto] Found ${jobs.length} jobs (filtered by date).`);
  return jobs;
}

// Scrape GetOnBoard (LATAM tech job board) via its free public JSON API
async function scrapeGetOnBoard(): Promise<Job[]> {
  console.log('[GetOnBoard] Fetching categories (programming, qa, ai, product-building-management, data-science)...');
  const jobs: Job[] = [];
  const now = Date.now();

  try {
    for (const category of ['machine-learning-ai', 'programming', 'sysadmin-devops-qa', 'product-building-management', 'data-science-analytics']) {
      const url = `https://www.getonbrd.com/api/v0/categories/${category}/jobs?per_page=100`;
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      });

      if (!response.ok) {
        console.warn(`[GetOnBoard] Failed for ${category}: ${response.status} ${response.statusText}`);
        continue;
      }

      const data = await response.json();
      if (!Array.isArray(data.data)) continue;

      for (const item of data.data) {
        const attrs = item.attributes;
        if (!attrs?.published_at) continue;

        const publishedMs = attrs.published_at * 1000;
        const ageInDays = (now - publishedMs) / (1000 * 60 * 60 * 24);
        if (ageInDays > 2) continue;

        const countries: string[] = attrs.countries || [];
        const isRemote = attrs.remote === true;
        const isColombia = countries.some(c => c.toLowerCase().includes('colombia'));
        if (!isRemote && !isColombia) continue;

        const publishedDate = new Date(publishedMs);
        const yyyy = publishedDate.getFullYear();
        const mm = String(publishedDate.getMonth() + 1).padStart(2, '0');
        const dd = String(publishedDate.getDate()).padStart(2, '0');

        jobs.push({
          jobId: item.id,
          title: htmlEntities(attrs.title),
          company: htmlEntities(attrs.company_name || item.relationships?.company?.data?.id || 'Confidencial'),
          location: isRemote ? 'Remoto' : countries.join(', '),
          url: `https://www.getonbrd.com/jobs/${item.id}`,
          dateText: 'Reciente',
          source: 'GetOnBoard',
          publishedAt: `${yyyy}-${mm}-${dd}`
        });
      }
    }
  } catch (error) {
    console.error('[GetOnBoard] Fetch error:', error);
  }
  console.log(`[GetOnBoard] Found ${jobs.length} jobs (filtered by date/region).`);
  return jobs;
}

// Scrape RemoteOK via its official public JSON API (https://remoteok.com/api).
// Returns the ~100 most recent postings site-wide; filtering happens locally.
// Their API terms require linking back to the original RemoteOK URL, which we
// do by storing item.url.
async function scrapeRemoteOK(): Promise<Job[]> {
  console.log('[RemoteOK] Fetching latest postings...');
  const jobs: Job[] = [];
  const now = Date.now();

  try {
    const response = await fetch('https://remoteok.com/api', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    if (!response.ok) {
      console.warn(`[RemoteOK] Failed: ${response.status} ${response.statusText}`);
      return [];
    }

    const data = await response.json();
    if (!Array.isArray(data)) return [];

    // data[0] is a legal notice object, not a job
    for (const item of data) {
      if (!item.id || !item.position || !item.epoch) continue;

      const ageInDays = (now - item.epoch * 1000) / (1000 * 60 * 60 * 24);
      if (ageInDays > 2) continue;

      const publishedDate = new Date(item.epoch * 1000);
      const yyyy = publishedDate.getFullYear();
      const mm = String(publishedDate.getMonth() + 1).padStart(2, '0');
      const dd = String(publishedDate.getDate()).padStart(2, '0');

      jobs.push({
        jobId: String(item.id),
        title: htmlEntities(item.position),
        company: htmlEntities(item.company || 'Confidencial'),
        location: htmlEntities(item.location || 'Remote'),
        url: item.url,
        dateText: 'Reciente',
        source: 'RemoteOK',
        publishedAt: `${yyyy}-${mm}-${dd}`
      });
    }
  } catch (error) {
    console.error('[RemoteOK] Fetch error:', error);
  }
  console.log(`[RemoteOK] Found ${jobs.length} jobs (filtered by date).`);
  return jobs;
}

// Scrape Remotive via its official public JSON API
// (https://remotive.com/api/remote-jobs?search=...). No auth required.
async function scrapeRemotive(searchTerms: string[]): Promise<Job[]> {
  console.log('[Remotive] Fetching postings...');
  const jobs: Job[] = [];
  const now = Date.now();

  try {
    for (const term of searchTerms) {
      const url = `https://remotive.com/api/remote-jobs?search=${encodeURIComponent(term)}&limit=50`;
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      });

      if (!response.ok) {
        console.warn(`[Remotive] Failed for "${term}": ${response.status} ${response.statusText}`);
        continue;
      }

      const data = await response.json();
      if (!Array.isArray(data.jobs)) continue;

      for (const item of data.jobs) {
        if (!item.id || !item.title || !item.publication_date) continue;

        const publishedDate = new Date(item.publication_date);
        const ageInDays = (now - publishedDate.getTime()) / (1000 * 60 * 60 * 24);
        if (ageInDays > 2) continue;

        const yyyy = publishedDate.getFullYear();
        const mm = String(publishedDate.getMonth() + 1).padStart(2, '0');
        const dd = String(publishedDate.getDate()).padStart(2, '0');

        jobs.push({
          jobId: String(item.id),
          title: htmlEntities(item.title),
          company: htmlEntities(item.company_name || 'Confidencial'),
          location: htmlEntities(item.candidate_required_location || 'Remote'),
          url: item.url,
          dateText: 'Reciente',
          source: 'Remotive',
          publishedAt: `${yyyy}-${mm}-${dd}`
        });
      }
    }
  } catch (error) {
    console.error('[Remotive] Fetch error:', error);
  }
  console.log(`[Remotive] Found ${jobs.length} jobs (filtered by date).`);
  return jobs;
}

// NOTE on Upwork: there is no free local path. Their public RSS feeds
// (/ab/feed/jobs/rss) were shut down (they now return 410 Gone), the site is
// behind PerimeterX/Cloudflare bot detection keyed on TLS fingerprints, and
// the official API requires an approved OAuth application. Workana + RemoteOK
// + Remotive cover the freelance/remote segment for free instead.

// got-scraping fetch with manual retry/backoff. Each attempt issues a fresh call
// so got-scraping generates a new browser fingerprint — this is what recovers from
// Cloudflare's intermittent 403s under bursty traffic (retrying the SAME
// fingerprint just gets blocked again). Returns the body on HTTP 200, else null.
async function gsFetch(url: string, label: string, attempts = 3): Promise<string | null> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await gotScraping({
        url,
        timeout: { request: 30000 },
        retry: { limit: 0 },
        headerGeneratorOptions: {
          browsers: [{ name: 'chrome', minVersion: 118 }],
          operatingSystems: ['windows'],
          locales: ['es-CO', 'es', 'en-US']
        }
      });
      if (response.statusCode === 200) return response.body;
      if (attempt === attempts) {
        console.warn(`[${label}] Failed after ${attempts} attempts: HTTP ${response.statusCode}`);
        return null;
      }
      // Backoff before a fresh-fingerprint retry (1.5s, 3s, 4.5s, ...)
      await new Promise(r => setTimeout(r, 1500 * attempt));
    } catch (error: any) {
      if (attempt === attempts) {
        console.error(`[${label}] Fetch error after ${attempts} attempts:`, error?.message || error);
        return null;
      }
      await new Promise(r => setTimeout(r, 1500 * attempt));
    }
  }
  return null;
}

// Extract a balanced {...} JSON object starting at the first '{' after fromIdx,
// respecting strings/escapes. Used to pull embedded provider payloads out of HTML.
function extractBalancedObject(html: string, fromIdx: number): string | null {
  let i = html.indexOf('{', fromIdx);
  if (i === -1) return null;
  const objStart = i;
  let depth = 0, inStr = false, esc = false;
  for (; i < html.length; i++) {
    const c = html[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
    } else {
      if (c === '"') inStr = true;
      else if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) return html.slice(objStart, i + 1); }
    }
  }
  return null;
}

// Scrape Indeed locally (no Apify) using got-scraping, which mimics real browser
// TLS/JA3 fingerprints and header ordering — the same technique Apify's actors
// use under the hood — to pass Cloudflare. Indeed embeds its search results as
// JSON in window.mosaic.providerData["mosaic-provider-jobcards"]; we bracket-match
// that object and read the results array. Note: only the first result page is
// reliable per request (Cloudflare escalates on rapid ?start=N follow-ups), so we
// issue one request per keyword instead of paginating.
async function scrapeIndeedLocal(keyword: string): Promise<Job[]> {
  console.log(`[Indeed] Scraping locally for keyword "${keyword}"...`);
  const query = encodeURIComponent(keyword);
  const url = `https://co.indeed.com/jobs?q=${query}&l=Colombia&fromage=3`;
  const jobs: Job[] = [];
  const now = Date.now();

  try {
    const html = await gsFetch(url, 'Indeed');
    if (!html) return [];

    const marker = 'window.mosaic.providerData["mosaic-provider-jobcards"]=';
    const markerIdx = html.indexOf(marker);
    if (markerIdx === -1) {
      console.warn('[Indeed] jobcards payload not found (layout changed or blocked).');
      return [];
    }

    const jsonStr = extractBalancedObject(html, markerIdx + marker.length);
    if (!jsonStr) return [];

    const data = JSON.parse(jsonStr);
    const results = data?.metaData?.mosaicProviderJobCardsModel?.results;
    if (!Array.isArray(results)) return [];

    for (const r of results) {
      if (!r.jobkey || !r.title) continue;

      // pubDate is epoch ms; fall back to keeping it if absent
      let publishedAt: string;
      if (r.pubDate) {
        const ageInDays = (now - r.pubDate) / (1000 * 60 * 60 * 24);
        if (ageInDays > 2) continue;
        const d = new Date(r.pubDate);
        publishedAt = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      } else {
        continue;
      }

      const location = r.remoteLocation ? 'Remoto' : (r.formattedLocation || 'Colombia');
      jobs.push({
        jobId: r.jobkey,
        title: htmlEntities(r.title),
        company: htmlEntities(r.company || 'Confidencial'),
        location: htmlEntities(location),
        url: `https://co.indeed.com/viewjob?jk=${r.jobkey}`,
        dateText: r.formattedRelativeTime || 'Reciente',
        source: 'Indeed',
        publishedAt
      });
    }
  } catch (error: any) {
    console.error('[Indeed] Fetch error:', error?.message || error);
  }
  console.log(`[Indeed] Found ${jobs.length} jobs (filtered by date).`);
  return jobs;
}

// Glassdoor's country location ids for its job-search URL (locationType N = nation).
// Colombia = 54, confirmed via findPopularLocationAjax.
const GLASSDOOR_COLOMBIA_ID = 54;

// Scrape Glassdoor locally (no Apify) with got-scraping. Glassdoor embeds its
// results as an escaped React-flight (RSC) stream in the HTML; each posting is a
// {"jobview":{"header":{...}}} block carrying ageInDays, employerNameFromSearch,
// jobTitleText, locationName and seoJobLink. Because the stream is double-escaped
// (\\" ... \\"), we pull each field with a targeted regex per jobview chunk rather
// than JSON-parsing the whole nested structure.
async function scrapeGlassdoor(keyword: string): Promise<Job[]> {
  console.log(`[Glassdoor] Scraping locally for keyword "${keyword}"...`);
  const kw = keyword.trim();
  // URL span offsets: IL.0,8 = "colombia" (8 chars), KO9,<9+kwlen> = keyword span
  const koEnd = 9 + kw.length;
  const slug = `colombia-${kw.toLowerCase().replace(/\s+/g, '-')}-jobs`;
  const url = `https://www.glassdoor.com/Job/${slug}-SRCH_IL.0,8_IN${GLASSDOOR_COLOMBIA_ID}_KO9,${koEnd}.htm?fromAge=3`;
  const jobs: Job[] = [];

  const field = (chunk: string, name: string): string | null => {
    const m = chunk.match(new RegExp(`\\\\"${name}\\\\":\\\\"((?:[^\\\\]|\\\\.)*?)\\\\"`));
    return m ? m[1] : null;
  };
  const numField = (chunk: string, name: string): number | null => {
    const m = chunk.match(new RegExp(`\\\\"${name}\\\\":(\\d+)`));
    return m ? parseInt(m[1], 10) : null;
  };
  const unescapeFlight = (s: string): string =>
    s.replace(/\\u0026/g, '&').replace(/\\u003c/g, '<').replace(/\\u003e/g, '>').replace(/\\\//g, '/').replace(/\\"/g, '"');

  try {
    const html = await gsFetch(url, 'Glassdoor');
    if (!html) return [];

    const chunks = html.split('\\"jobview\\":');
    const now = Date.now();

    for (let i = 1; i < chunks.length; i++) {
      const chunk = chunks[i];
      const ageInDays = numField(chunk, 'ageInDays');
      const title = field(chunk, 'jobTitleText');
      if (ageInDays === null || ageInDays > 2 || !title) continue;

      const company = field(chunk, 'employerNameFromSearch') || 'Confidencial';
      const location = field(chunk, 'locationName') || 'Colombia';
      const listingId = numField(chunk, 'listingId');
      let link = field(chunk, 'seoJobLink');
      link = link ? unescapeFlight(link) : (listingId ? `https://www.glassdoor.com/job-listing/index.htm?jl=${listingId}` : '');
      if (!link) continue;

      const d = new Date(now - ageInDays * 24 * 60 * 60 * 1000);
      const publishedAt = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

      jobs.push({
        jobId: listingId ? String(listingId) : link,
        title: htmlEntities(unescapeFlight(title)),
        company: htmlEntities(unescapeFlight(company)),
        location: htmlEntities(unescapeFlight(location)),
        url: link,
        dateText: `hace ${ageInDays} día(s)`,
        source: 'Glassdoor',
        publishedAt
      });
    }
  } catch (error: any) {
    console.error('[Glassdoor] Fetch error:', error?.message || error);
  }
  console.log(`[Glassdoor] Found ${jobs.length} jobs (filtered by date).`);
  return jobs;
}

// Scrape Indeed via Apify (Optimized single run with combined query)
async function scrapeIndeedCombined(combinedKeyword: string): Promise<Job[]> {
  if (!APIFY_TOKEN) {
    console.log('[Indeed] APIFY_TOKEN not set. Skipping Indeed.');
    return [];
  }

  console.log(`[Indeed] Triggering single Apify run with combined query: "${combinedKeyword}"...`);
  
  const input = {
    includeKeyword: combinedKeyword,
    locationName: "Colombia",
    datePosted: "3days",
    maxItems: 30
  };

  const startUrl = `https://api.apify.com/v2/acts/orgupdate~indeed-jobs-scraper/runs?token=${APIFY_TOKEN}`;
  
  try {
    const response = await fetch(startUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(input)
    });

    if (!response.ok) {
      console.warn(`[Indeed] Failed to trigger run: ${response.status}`);
      return [];
    }

    const startData = await response.json();
    const runId = startData.data.id;
    const datasetId = startData.data.defaultDatasetId;

    console.log(`[Indeed] Apify run ${runId} started. Waiting for results...`);
    
    // Poll status until done (max 2 minutes)
    let attempts = 0;
    while (attempts < 15) {
      await new Promise(r => setTimeout(r, 8000));
      const statusUrl = `https://api.apify.com/v2/actor-runs/${runId}?token=${APIFY_TOKEN}`;
      const statusResp = await fetch(statusUrl);
      if (!statusResp.ok) break;
      const statusData = await statusResp.json();
      
      const status = statusData.data.status;
      console.log(`[Indeed] Run status: ${status}`);
      
      if (status === 'SUCCEEDED') {
        const datasetUrl = `https://api.apify.com/v2/datasets/${datasetId}/items?token=${APIFY_TOKEN}`;
        const datasetResp = await fetch(datasetUrl);
        if (datasetResp.ok) {
          const items = await datasetResp.json();
          const jobs: Job[] = [];
          const now = new Date();
          
          for (const item of items) {
            const location = item.location || '';
            const title = item.job_title || '';
            
            const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
            const yyyy = yesterday.getFullYear();
            const mm = String(yesterday.getMonth() + 1).padStart(2, '0');
            const dd = String(yesterday.getDate()).padStart(2, '0');

            const urlStr = item.URL || '';
            const jkMatch = urlStr.match(/jk=([a-f0-9]+)/);
            const jobId = jkMatch ? jkMatch[1] : Math.random().toString(36).substring(7);

            jobs.push({
              jobId,
              title: htmlEntities(title),
              company: htmlEntities(item.company_name || 'Confidencial'),
              location: htmlEntities(location),
              url: urlStr,
              dateText: 'Reciente',
              source: 'Indeed',
              publishedAt: `${yyyy}-${mm}-${dd}`
            });
          }
          console.log(`[Indeed] Found ${jobs.length} jobs.`);
          return jobs;
        }
        break;
      } else if (status === 'FAILED' || status === 'ABORTED' || status === 'TIMED-OUT') {
        console.warn(`[Indeed] Run failed with status: ${status}`);
        break;
      }
      attempts++;
    }
    return [];
  } catch (error) {
    console.error('[Indeed] Fetch error:', error);
    return [];
  }
}

import { generateRoleKeywordsWithAI } from './ai-role-agent.js';

// Parent page ID for "radar de empleo" workspace page
const NOTION_PARENT_PAGE_ID = '3a1ffe7c-41af-800b-a8f6-d897759c21df';

// Sync job to dedicated Notion database for this run
async function syncToNotion(job: Job, targetDataSourceId: string) {
  try {
    let modality = 'Desconocida';
    const textToSearch = `${job.title} ${job.location}`.toLowerCase();
    if (textToSearch.includes('remot') || textToSearch.includes('teletrabajo') || textToSearch.includes('home office')) {
      modality = 'Remoto';
    } else if (textToSearch.includes('hibrid') || textToSearch.includes('hybrid')) {
      modality = 'Híbrido';
    } else if (textToSearch.includes('presencial') || textToSearch.includes('oficina') || textToSearch.includes('sitio')) {
      modality = 'Presencial';
    }

    await notion.pages.create({
      parent: { type: "data_source_id", data_source_id: targetDataSourceId },
      properties: {
        "Nombre": { title: [{ text: { content: job.title } }] },
        "Empresa": { rich_text: [{ text: { content: job.company } }] },
        "Ubicación": { rich_text: [{ text: { content: job.location } }] },
        "Modalidad": { select: { name: modality } },
        "Fuente principal": { select: { name: job.source } },
        "Aplicar": { url: job.url },
        "Fecha publicada": { date: { start: job.publishedAt } }
      } as any
    });
    console.log(`[Notion] Synced page: "${job.title}" into dedicated DB`);
  } catch (error) {
    console.error(`[Notion] Error syncing job "${job.title}":`, error);
  }
}

const COLOMBIA_SCOPED_SOURCES = new Set<Job['source']>([
  'LinkedIn', 'Computrabajo', 'Elempleo', 'Indeed', 'Glassdoor', 'Magneto', 'Torre', 'GetOnBoard'
]);

function isColombiaOrRemote(location: string): boolean {
  const loc = location.toLowerCase();
  return loc.includes('colombia') || loc.includes('medellin') || loc.includes('medellín') ||
    loc.includes('remoto') || loc.includes('remote') ||
    loc.includes('worldwide') || loc.includes('anywhere') || loc.includes('global') ||
    loc.includes('latam') || loc.includes('latin america') || loc.includes('américa latina') ||
    loc.includes('america latina') || loc.includes('americas') || loc.includes('américas') ||
    loc.includes('south america');
}

function passesLocation(job: Job): boolean {
  if (COLOMBIA_SCOPED_SOURCES.has(job.source)) return true;
  return isColombiaOrRemote(job.location);
}

const DRY_RUN = process.env.DRY_RUN === 'true';

async function main() {
  console.log(`=== STARTING LOCAL + HYBRID JOB SCRAPER (COLOMBIA / PAST 48 HOURS)${DRY_RUN ? ' [DRY RUN]' : ''} ===`);

  // Read keywords dynamically from SEARCH_KEYWORDS env var or use defaults
  const rawSearchKeywords = process.env.SEARCH_KEYWORDS || "Project Manager, Business Analyst, Data Analyst, Data Engineer, RPA Developer, QA Engineer, AI Engineer";
  const userRequestedKeywords = rawSearchKeywords.split(',').map(s => s.trim()).filter(Boolean);
  
  // Expand search keywords dynamically using AI Role Agent (English & Spanish synonyms)
  const expandedKeywords = generateRoleKeywordsWithAI(userRequestedKeywords);
  const searchTerms = Array.from(new Set([...userRequestedKeywords, ...expandedKeywords])).slice(0, 12);

  console.log(`[AI Role Agent] Requested roles: [${userRequestedKeywords.join(', ')}]`);
  console.log(`[AI Role Agent] Dynamically expanded search terms (${searchTerms.length}): [${searchTerms.join(', ')}]`);

  let allJobs: Job[] = [];

  // 1. Scrape free local platforms in parallel across all terms concurrently
  console.log('\n--- Phase 1: Local free scraping (LinkedIn, Computrabajo, Elempleo, Torre, Workana, Magneto) ---');
  const phase1Promises = searchTerms.map(async (keyword) => {
    const [linkedinJobs, computrabajoJobs, elempleoJobs, torreJobs, workanaJobs, magnetoJobs] = await Promise.all([
      scrapeLinkedIn(keyword),
      scrapeComputrabajo(keyword),
      scrapeElempleo(keyword),
      scrapeTorre(keyword),
      scrapeWorkana(keyword),
      scrapeMagneto(keyword)
    ]);
    return [...linkedinJobs, ...computrabajoJobs, ...elempleoJobs, ...torreJobs, ...workanaJobs, ...magnetoJobs];
  });

  const phase1Results = await Promise.all(phase1Promises);
  allJobs = allJobs.concat(phase1Results.flat());

  // 1b & 1c. WeRemoto and Global Public APIs in parallel
  console.log('\n--- Phase 1b & 1c: Free public APIs (WeRemoto, GetOnBoard, RemoteOK, Remotive) ---');
  const [weRemotoJobs, getOnBoardJobs, remoteOkJobs, remotiveJobs] = await Promise.all([
    scrapeWeRemoto(),
    scrapeGetOnBoard(),
    scrapeRemoteOK(),
    scrapeRemotive(searchTerms)
  ]);
  allJobs = allJobs.concat(weRemotoJobs, getOnBoardJobs, remoteOkJobs, remotiveJobs);

  // 2. Indeed + Glassdoor scraped LOCALLY in parallel
  console.log('\n--- Phase 2: Local Cloudflare-bypass scraping (Indeed, Glassdoor) ---');
  const cfKeywords = searchTerms.slice(0, 4);
  const phase2Promises = cfKeywords.map(async (keyword) => {
    const [indeedJobs, glassdoorJobs] = await Promise.all([
      scrapeIndeedLocal(keyword),
      scrapeGlassdoor(keyword)
    ]);
    return [...indeedJobs, ...glassdoorJobs];
  });

  const phase2Results = await Promise.all(phase2Promises);
  allJobs = allJobs.concat(phase2Results.flat());

  // Deduplicate by URL
  const uniqueJobs: Job[] = [];
  const urlsSeen = new Set<string>();

  for (const job of allJobs) {
    if (!urlsSeen.has(job.url)) {
      urlsSeen.add(job.url);
      uniqueJobs.push(job);
    }
  }

  console.log(`\n=== SCRAPING COMPLETE ===`);
  console.log('Found ' + allJobs.length + ' total jobs across all keywords.');
  console.log('Deduplicated to ' + uniqueJobs.length + ' unique jobs.');

  // Semantic relevance filter matching requested roles or expanded synonyms
  const relevantJobs = uniqueJobs.filter(job => {
    const titleLower = job.title.toLowerCase();
    
    // Negative keywords: filter out manual/unrelated roles
    const negativeKeywords = [
      'operario', 'soldador', 'bodega', 'produccion', 'producción', 'alimentos', 'minicargador', 
      'mecanico', 'mecánico', 'quimico', 'químico', 'enfermera', 'enfermero', 'medico', 
      'soldadura', 'vendedor', 'secrtaria', 'secretaria', 'docente', 'recolector'
    ];
    if (negativeKeywords.some(neg => titleLower.includes(neg))) {
      return false;
    }

    if (!passesLocation(job)) {
      return false;
    }

    // Match any of expanded keywords or core role tokens
    return expandedKeywords.some(syn => {
      const s = syn.toLowerCase();
      if (s === 'qa') return /\bqa\b/.test(titleLower);
      if (s === 'ai' || s === 'ia') return /\bai\b|\bia\b/.test(titleLower) || titleLower.includes('inteligencia artificial');
      if (s === 'ba') return /\bba\b/.test(titleLower);
      if (s === 'pm') return /\bpm\b/.test(titleLower);
      if (s === 'pmo') return /\bpmo\b/.test(titleLower);
      return titleLower.includes(s) || s.split(' ').every(word => word.length > 2 && titleLower.includes(word));
    });
  });

  console.log('Filtered to ' + relevantJobs.length + ' relevant jobs matching AI Role Agent profile.');

  const dateStr = new Date().toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' });
  const runDbTitle = `🎯 ${dateStr} - ${userRequestedKeywords.join(', ')} (${relevantJobs.length} Vacantes)`;

  if (DRY_RUN) {
    console.log(`\n=== DRY RUN: would create Notion DB "${runDbTitle}" and sync ${relevantJobs.length} jobs ===`);
    for (const job of relevantJobs) {
      console.log(`- [${job.source}] ${job.title} @ ${job.company} (${job.location}) — ${job.publishedAt} — ${job.url}`);
    }
    console.log(`\n=== JOB RADAR DRY RUN COMPLETE ===`);
    return;
  }

  // Create a brand NEW dedicated Notion Database inside "radar de empleo" parent page for this run
  let targetDataSourceId: string | null = null;
  if (notion && relevantJobs.length > 0) {
    try {
      console.log(`\n=== CREATING DEDICATED NOTION DATABASE: "${runDbTitle}" ===`);
      const newDb = await (notion as any).databases.create({
        parent: { type: "page_id", page_id: NOTION_PARENT_PAGE_ID },
        title: [{ type: "text", text: { content: runDbTitle } }],
        initial_data_source: {
          properties: {
            "Nombre": { title: {} },
            "Empresa": { rich_text: {} },
            "Ubicación": { rich_text: {} },
            "Modalidad": { select: {} },
            "Fuente principal": { select: {} },
            "Aplicar": { url: {} },
            "Fecha publicada": { date: {} }
          }
        }
      });

      targetDataSourceId = newDb.data_sources?.[0]?.id || newDb.id;
      console.log(`[Notion] Successfully created dedicated database with ID: ${targetDataSourceId}`);
    } catch (e: any) {
      console.error('[Notion] Error creating dedicated database:', e.message);
    }
  }

  if (targetDataSourceId) {
    console.log(`\n=== SYNCING ${relevantJobs.length} JOBS TO DEDICATED NOTION DATABASE ===`);
    const BATCH_SIZE = 5;
    for (let i = 0; i < relevantJobs.length; i += BATCH_SIZE) {
      const batch = relevantJobs.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map(job => syncToNotion(job, targetDataSourceId!)));
    }
  }

  // Save run & jobs to local persistent cache for instant 1ms UI responses
  const runId = targetDataSourceId || `run-${Date.now()}`;
  saveRunToCache({
    id: runId,
    name: runDbTitle,
    role: userRequestedKeywords.join(', '),
    timestamp: new Date().toISOString(),
    jobs: relevantJobs.map(j => ({
      ...j,
      runId,
      runName: runDbTitle
    }))
  });

  console.log(`\n=== JOB RADAR SYNC COMPLETE ===`);
}

main();
