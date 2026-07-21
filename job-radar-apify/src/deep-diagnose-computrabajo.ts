import { gotScraping } from 'got-scraping';

async function deepDiagnose() {
  console.log('=== DEEP DIAGNOSTIC OF COMPUTRABAJO FAILING URLS ===\n');

  const urls = [
    'https://co.computrabajo.com/ofertas-de-trabajo/oferta-de-trabajo-de-residente-de-obra-administraivo-experiencia-en-proyectos-comerciales-servicios-en-san-vicente-de-chucuri-2D9B1EBFFFC020A261373E686DCF3405',
    'https://co.computrabajo.com/ofertas-de-trabajo/oferta-de-trabajo-de-residente-de-obra-sogamoso-en-sogamoso-3FAB733EDE32416761373E686DCF3405'
  ];

  for (let i = 0; i < urls.length; i++) {
    const targetUrl = urls[i];
    console.log(`URL ${i + 1}: ${targetUrl}`);

    // Test 1: Native fetch
    try {
      const res1 = await fetch(targetUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'Accept-Language': 'es-CO,es;q=0.9,en-US;q=0.8,en;q=0.7'
        },
        redirect: 'follow'
      });

      console.log(`  Fetch Status: ${res1.status}`);
      console.log(`  Fetch Final URL: ${res1.url}`);
      const body1 = await res1.text();
      console.log(`  Body length: ${body1.length}`);
      console.log(`  Title:`, body1.match(/<title>([^<]+)<\/title>/)?.[1] || 'No title tag');
      
      if (body1.includes('Object reference not set')) {
        console.log('  ❌ 500 SERVER ERROR: Object reference not set to an instance of an object!');
      }
      if (body1.includes('oferta caducada') || body1.includes('no está disponible')) {
        console.log('  ⚠️ EXPIRED / INACTIVE OFFER!');
      }
    } catch (e: any) {
      console.error(`  Fetch error:`, e.message);
    }

    console.log('\n--------------------------------------------------\n');
  }
}

deepDiagnose();
