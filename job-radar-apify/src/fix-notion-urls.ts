import { Client } from '@notionhq/client';
import dotenv from 'dotenv';

dotenv.config();

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const notion = new Client({ auth: NOTION_TOKEN });

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

async function fixAllNotionUrls() {
  console.log('=== FIXING ALL OLD COMPUTRABAJO URLS IN NOTION ===');

  try {
    const searchRes = await notion.search({
      filter: { property: 'object', value: 'data_source' },
      page_size: 50
    });

    console.log(`Found ${searchRes.results.length} data sources in Notion.`);

    let fixedCount = 0;

    for (const ds of (searchRes.results as unknown as NotionObjectLike[])) {
      try {
        const queryRes = await notion.dataSources.query({
          data_source_id: ds.id,
          page_size: 100
        });

        for (const page of ((queryRes.results || []) as unknown as NotionObjectLike[])) {
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
      } catch (e) {
        console.warn(`Error processing data source ${ds.id}:`, (e as Error).message);
      }
    }

    console.log(`\n=== SUCCESS: Fixed ${fixedCount} broken Computrabajo URLs in Notion ===`);
  } catch (e) {
    console.error('Error searching Notion:', (e as Error).message);
  }
}

fixAllNotionUrls();
