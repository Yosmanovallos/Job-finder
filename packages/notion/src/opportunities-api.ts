// Thin Notion client wrapper for the "Oportunidades" data source. Kept apart
// from the Vacantes NotionApi: this one can CREATE a database (Vacantes never is
// created programmatically). Uses the 2025-09-03 data-source model.
import { Client } from "@notionhq/client";

export interface OppNotionApi {
  /** Finds a workspace-level page titled `title` (parent for a new database); null if none. */
  findParentPage(title: string): Promise<string | null>;
  /** Finds a data source titled `title`; null if none. */
  findDatabaseByTitle(title: string): Promise<{ databaseId: string; dataSourceId: string } | null>;
  createDatabase(
    parentPageId: string,
    title: string,
    properties: Record<string, unknown>
  ): Promise<{ databaseId: string; dataSourceId: string }>;
  createPage(
    dataSourceId: string,
    properties: Record<string, unknown>,
    children: unknown[]
  ): Promise<{ id: string }>;
  updatePage(pageId: string, properties: Record<string, unknown>): Promise<void>;
  /** Moves a page to the Notion trash (reversible — not a permanent delete). */
  archivePage(pageId: string): Promise<void>;
  /** Adds any missing schema properties to an existing data source (idempotent). */
  ensureProperties(dataSourceId: string, properties: Record<string, unknown>): Promise<void>;
}

async function dataSourceIdOf(client: Client, databaseId: string): Promise<string> {
  const db = (await client.databases.retrieve({ database_id: databaseId })) as {
    data_sources?: Array<{ id: string }>;
  };
  const id = db.data_sources?.[0]?.id;
  if (!id) throw new Error(`Database ${databaseId} has no data source`);
  return id;
}

export function createOppNotionApi(token: string): OppNotionApi {
  const client = new Client({ auth: token });
  const plain = (arr: unknown): string =>
    Array.isArray(arr)
      ? arr.map((x) => (x as { plain_text?: string }).plain_text ?? "").join("")
      : "";
  return {
    async findParentPage(title) {
      let cursor: string | undefined;
      do {
        const res = await client.search({
          query: title,
          filter: { property: "object", value: "page" },
          page_size: 100,
          ...(cursor ? { start_cursor: cursor } : {})
        });
        for (const r of res.results as Array<Record<string, unknown>>) {
          const props = (r.properties as Record<string, { type?: string; title?: unknown }>) ?? {};
          let name = "";
          for (const v of Object.values(props))
            if (v?.type === "title") {
              name = plain(v.title);
              break;
            }
          if (name === title) return r.id as string;
        }
        cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
      } while (cursor);
      return null;
    },

    async findDatabaseByTitle(title) {
      let cursor: string | undefined;
      do {
        const res = await client.search({
          query: title,
          filter: { property: "object", value: "data_source" },
          page_size: 100,
          ...(cursor ? { start_cursor: cursor } : {})
        });
        for (const r of res.results as Array<Record<string, unknown>>) {
          const name = (
            ((r.title as Array<{ plain_text?: string }>) ?? []) as Array<{ plain_text?: string }>
          )
            .map((x) => x.plain_text ?? "")
            .join("");
          if (name === title) {
            const databaseId = (r.parent as { database_id?: string } | undefined)?.database_id;
            if (databaseId) return { databaseId, dataSourceId: r.id as string };
          }
        }
        cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
      } while (cursor);
      return null;
    },

    async createDatabase(parentPageId, title, properties) {
      const created = (await client.databases.create({
        parent: { type: "page_id", page_id: parentPageId },
        title: [{ type: "text", text: { content: title } }],
        initial_data_source: { properties: properties as never }
      } as never)) as { id: string; data_sources?: Array<{ id: string }> };
      const databaseId = created.id;
      const dataSourceId =
        created.data_sources?.[0]?.id ?? (await dataSourceIdOf(client, databaseId));
      return { databaseId, dataSourceId };
    },

    async createPage(dataSourceId, properties, children) {
      const res = await client.pages.create({
        parent: { type: "data_source_id", data_source_id: dataSourceId },
        properties: properties as never,
        children: children as never
      });
      return { id: res.id };
    },

    async updatePage(pageId, properties) {
      await client.pages.update({ page_id: pageId, properties: properties as never });
    },

    async archivePage(pageId) {
      await client.pages.update({ page_id: pageId, in_trash: true } as never);
    },

    async ensureProperties(dataSourceId, properties) {
      // Never re-send the title property: Notion rejects redefining it on update.
      const patch: Record<string, unknown> = {};
      for (const [key, def] of Object.entries(properties)) {
        if (def && typeof def === "object" && "title" in (def as object)) continue;
        patch[key] = def;
      }
      // Notion merges by key; existing properties are untouched, new ones added.
      await client.dataSources.update({ data_source_id: dataSourceId, properties: patch } as never);
    }
  };
}
