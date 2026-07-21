import { Client } from '@notionhq/client';
import dotenv from 'dotenv';

dotenv.config();

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const notion = new Client({ auth: NOTION_TOKEN });

async function fixAllNotionUrls() {
  console.log('=== FIXING ALL OLD COMPUTRABAJO URLS IN NOTION ===');

  try {
    const searchRes = await notion.search({
      filter: { property: 'object', value: 'data_source' },
      page_size: 50
    });

    console.log(`Found ${searchRes.results.length} data sources in Notion.`);

    let fixedCount = 0;

    for (const ds of (searchRes.results as any[])) {
      try {
        const queryRes = await (notion as any).dataSources.query({
          data_source_id: ds.id,
          page_size: 100
        });

        for (const page of (queryRes.results || [])) {
          const props = page.properties || {};
          const currentUrl = props.URL?.url || props.Aplicar?.url || '';

          if (currentUrl.includes('co.computrabajo.com')) {
            const cleanUrl = currentUrl
              .replace('https://co.computrabajo.com', 'https://www.computrabajo.com.co')
              .replace('http://co.computrabajo.com', 'https://www.computrabajo.com.co');

            await notion.pages.update({
              page_id: page.id,
              properties: {
                "URL": { url: cleanUrl },
                "Aplicar": { url: cleanUrl }
              }
            });

            console.log(`- Fixed page ${page.id}: ${cleanUrl}`);
            fixedCount++;
          }
        }
      } catch (e: any) {
        console.warn(`Error processing data source ${ds.id}:`, e.message);
      }
    }

    console.log(`\n=== SUCCESS: Fixed ${fixedCount} broken Computrabajo URLs in Notion ===`);
  } catch (e: any) {
    console.error('Error searching Notion:', e.message);
  }
}

fixAllNotionUrls();
