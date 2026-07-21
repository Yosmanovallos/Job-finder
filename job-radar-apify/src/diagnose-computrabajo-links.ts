import { gotScraping } from 'got-scraping';

async function diagnoseComputrabajo() {
  console.log('=== COMPUTRABAJO LINK DIAGNOSTIC ===\n');

  // Let's fetch the search page first to get fresh live links
  const searchUrl = 'https://www.computrabajo.com.co/trabajo-de-project-manager';
  
  const searchRes = await gotScraping({
    url: searchUrl,
    headerGeneratorOptions: {
      browsers: [{ name: 'chrome', minVersion: 120 }],
      devices: ['desktop'],
      locales: ['es-CO', 'es'],
      operatingSystems: ['windows']
    }
  });

  console.log(`Search Page Status: ${searchRes.statusCode}`);
  const html = searchRes.body;

  const matches = [...html.matchAll(/href="([^"]*oferta-de-trabajo-[^"]+)"/g)];
  console.log(`Found ${matches.length} job offer hrefs on search page.\n`);

  for (let i = 0; i < Math.min(matches.length, 5); i++) {
    const rawHref = matches[i][1];
    const fullUrl = rawHref.startsWith('http') ? rawHref : `https://www.computrabajo.com.co${rawHref.startsWith('/') ? '' : '/'}${rawHref}`;

    console.log(`Job ${i + 1}:`);
    console.log(`  rawHref: ${rawHref}`);
    console.log(`  fullUrl: ${fullUrl}`);

    try {
      const offerRes = await gotScraping({
        url: fullUrl,
        followRedirect: true,
        headerGeneratorOptions: {
          browsers: [{ name: 'chrome', minVersion: 120 }],
          devices: ['desktop'],
          locales: ['es-CO', 'es'],
          operatingSystems: ['windows']
        }
      });

      console.log(`  Offer Page Final URL: ${offerRes.url}`);
      console.log(`  Offer Page Status: ${offerRes.statusCode}`);
      const bodySnippet = offerRes.body.substring(0, 300).replace(/\s+/g, ' ');
      console.log(`  Body snippet: ${bodySnippet}`);

      // Check if page contains error / expired notice or 404
      if (offerRes.body.includes('La oferta de trabajo ya no está disponible') || offerRes.body.includes('oferta caducada')) {
        console.log('  ⚠️ WARNING: Computrabajo page indicates OFFER EXPIRED / NO LONGER AVAILABLE!');
      } else if (offerRes.body.includes('Página no encontrada') || offerRes.statusCode === 404) {
        console.log('  ❌ ERROR: Page 404 Not Found!');
      } else {
        console.log('  ✅ SUCCESS: Valid active offer page loaded!');
      }
    } catch (e: any) {
      console.error(`  Fetch error:`, e.message);
    }
    console.log('--------------------------------------------------');
  }
}

diagnoseComputrabajo();
