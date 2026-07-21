import { Client } from '@notionhq/client';
import dotenv from 'dotenv';

dotenv.config();

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID;

if (!NOTION_TOKEN || !NOTION_DATABASE_ID) {
  console.error('Error: NOTION_TOKEN or NOTION_DATABASE_ID is missing in .env');
  process.exit(1);
}

const notion = new Client({ auth: NOTION_TOKEN });

async function wipeDatabase() {
  console.log('=== WIPING NOTION DATABASE TO START FROM 0 ===');
  let hasMore = true;
  let totalArchived = 0;

  while (hasMore) {
    try {
      const response = await (notion as any).dataSources.query({
        data_source_id: NOTION_DATABASE_ID!,
        page_size: 100
      });

      const pages = response.results || [];
      if (pages.length === 0) {
        hasMore = false;
        break;
      }

      console.log(`Found ${pages.length} pages to archive...`);
      for (const page of pages as any[]) {
        const title = page.properties?.Nombre?.title?.[0]?.plain_text || page.id;
        console.log(`[Notion] Archiving page: "${title}"...`);
        await notion.pages.update({
          page_id: page.id,
          archived: true
        });
        totalArchived++;
      }
      
      if (!response.has_more) {
        hasMore = false;
      }
    } catch (error) {
      console.error('Error during wipe:', error);
      hasMore = false;
    }
  }

  console.log(`\n=== WIPE COMPLETE! Archived ${totalArchived} total pages. Database is now 100% EMPTY ===`);
}

wipeDatabase();
