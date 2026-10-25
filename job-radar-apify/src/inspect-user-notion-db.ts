import { Client } from '@notionhq/client';
import dotenv from 'dotenv';

dotenv.config();

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID;

// Loose view of the Notion objects this maintenance script reads. The SDK's
// response unions are wider than what is accessed here.
interface NotionPropertyLike {
  url?: string | null;
  title?: { plain_text?: string }[];
  select?: { name?: string } | null;
}
interface NotionObjectLike {
  id: string;
  type?: string;
  name?: string;
  title?: { plain_text?: string }[];
  properties?: Record<string, NotionPropertyLike | undefined>;
}

async function inspectNotionDb() {
  console.log('=== INSPECTING NOTION DATABASE JOBS & URLS ===\n');

  try {
    const res = await notion.dataSources.query({
      data_source_id: NOTION_DATABASE_ID as string,
      page_size: 50
    });

    console.log(`Total Pages in Notion DB: ${res.results.length}\n`);

    for (let i = 0; i < res.results.length; i++) {
      const page = res.results[i] as unknown as NotionObjectLike;
      const props = page.properties as Record<string, NotionPropertyLike | undefined>;

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
        } catch (e) {
          console.log(`  Fetch error: ${(e as Error).message}`);
        }
        console.log('--------------------------------------------------');
      }
    }
  } catch (e) {
    console.error('Error inspecting Notion DB:', (e as Error).message);
  }
}

inspectNotionDb();
