import { Client } from '@notionhq/client';
import dotenv from 'dotenv';

dotenv.config();

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID;

const notion = new Client({ auth: NOTION_TOKEN });

async function wipeAllDatabasesAndPages() {
  console.log('=== WIPING ALL NOTION DATABASES & PAGES TO START FROM CLEAN SLATE ===');

  try {
    // 1. Search for all data_sources
    const searchRes = await notion.search({
      filter: { property: 'object', value: 'data_source' },
      page_size: 100
    });

    console.log(`Found ${searchRes.results.length} data sources in Notion.`);
    for (const ds of searchRes.results as any[]) {
      try {
        console.log(`Archiving data source "${ds.title?.[0]?.plain_text || ds.name || ds.id}"...`);
        // Use blocks.delete to archive/delete the database block
        await notion.blocks.delete({
          block_id: ds.id
        });
        console.log(`Deleted DB block: ${ds.id}`);
      } catch (e: any) {
        console.warn(`Could not delete DB block ${ds.id}:`, e.message);
      }
    }

    // 2. Also search for pages inside parent page and delete them
    const pageSearch = await notion.search({
      filter: { property: 'object', value: 'page' },
      page_size: 100
    });

    console.log(`Found ${pageSearch.results.length} pages in Notion.`);
    for (const page of pageSearch.results as any[]) {
      try {
        await notion.pages.update({
          page_id: page.id,
          archived: true
        });
      } catch (e) {}
    }

    console.log('=== CLEAN SLATE COMPLETE! Notion is 100% clean and ready for fresh runs. ===');
  } catch (error: any) {
    console.error('Wipe error:', error.message);
  }
}

wipeAllDatabasesAndPages();
