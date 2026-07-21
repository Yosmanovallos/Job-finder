import { Client } from '@notionhq/client';
import dotenv from 'dotenv';

dotenv.config();

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID;

async function inspectNotionDb() {
  console.log('=== INSPECTING NOTION DATABASE JOBS & URLS ===\n');

  try {
    const res = await (notion as any).dataSources.query({
      data_source_id: NOTION_DATABASE_ID,
      page_size: 50
    });

    console.log(`Total Pages in Notion DB: ${res.results.length}\n`);

    for (let i = 0; i < res.results.length; i++) {
      const page = res.results[i];
      const props = page.properties;

      const titleProp = props.Nombre || props.Title || props.Name;
      const title = titleProp?.title?.[0]?.plain_text || 'Untitled';
      const source = props.Fuente?.select?.name || 'Unknown';
      const url = props.URL?.url || props.Aplicar?.url || '';

      if (source === 'Computrabajo' || url.includes('computrabajo')) {
        console.log(`[Computrabajo Job ${i + 1}] "${title}"`);
        console.log(`  Stored URL in Notion: "${url}"`);

        // Test fetching this URL with redirect tracking
        try {
          const checkRes = await fetch(url, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            },
            redirect: 'follow'
          });
          console.log(`  Fetch Status: ${checkRes.status} | Final URL: ${checkRes.url}`);
          const text = await checkRes.text();
          if (text.includes('Object reference not set') || text.includes('500 Server Error') || checkRes.status >= 400) {
            console.log('  ❌ BROKEN / ERROR PAGE DETECTED!');
            console.log('  Snippet:', text.substring(0, 200).replace(/\s+/g, ' '));
          } else {
            console.log('  ✅ WORKING URL!');
          }
        } catch (e: any) {
          console.log(`  Fetch error: ${e.message}`);
        }
        console.log('--------------------------------------------------');
      }
    }
  } catch (e: any) {
    console.error('Error inspecting Notion DB:', e.message);
  }
}

inspectNotionDb();
