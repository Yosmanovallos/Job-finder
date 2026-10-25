import { Client } from '@notionhq/client';
import dotenv from 'dotenv';

dotenv.config();

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const PARENT_PAGE_ID = '3a1ffe7c-41af-800b-a8f6-d897759c21df';

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

async function wipeAllCreatedPagesAndDatabases() {
  console.log('=== CLEANING NOTION WORKSPACE PAGE "radar de empleo" ===');

  try {
    const children = await notion.blocks.children.list({
      block_id: PARENT_PAGE_ID
    });

    console.log(`Found ${children.results.length} child blocks inside "radar de empleo".`);
    for (const child of children.results as unknown as NotionObjectLike[]) {
      try {
        console.log(`Deleting child block: ${child.id} (${child.type})...`);
        await notion.blocks.delete({
          block_id: child.id
        });
        console.log(`Successfully deleted block: ${child.id}`);
      } catch (e) {
        console.warn(`Could not delete block ${child.id}:`, (e as Error).message);
      }
    }

    console.log('=== CLEAN SLATE COMPLETED SUCCESSFULLY! "radar de empleo" is 100% empty. ===');
  } catch (error) {
    console.error('Clean slate error:', (error as Error).message);
  }
}

wipeAllCreatedPagesAndDatabases();
