import { Client } from "@notionhq/client";

/**
 * Narrow surface over the Notion API (2025-09-03, data_source_id based).
 * The sync/pull/reconcile code depends on this interface, never on the SDK,
 * so tests run fully offline against an in-memory fake.
 */
export interface NotionDataSourceInfo {
  id: string;
  properties: Record<string, { type: string }>;
}

export interface NotionPage {
  id: string;
  archived: boolean;
  properties: Record<string, unknown>;
}

export interface NotionApi {
  retrieveDataSource(dataSourceId: string): Promise<NotionDataSourceInfo>;
  /** Returns every non-archived page of the data source (paginates internally). */
  queryAllPages(dataSourceId: string): Promise<NotionPage[]>;
  /** Returns pages whose `Job ID` rich_text equals the given value. */
  findPagesByJobId(dataSourceId: string, jobId: string): Promise<NotionPage[]>;
  createPage(
    dataSourceId: string,
    properties: Record<string, unknown>,
    children: unknown[]
  ): Promise<{ id: string }>;
  updatePage(pageId: string, properties: Record<string, unknown>): Promise<void>;
  retrievePage(pageId: string): Promise<NotionPage>;
}

/** Error shape the retry policy understands. */
export interface RateLimitedError {
  status: number;
  retryAfterSeconds: number | null;
}

export function asRateLimited(error: unknown): RateLimitedError | null {
  if (typeof error !== "object" || error === null) {
    return null;
  }
  const status = (error as { status?: unknown }).status;
  if (status !== 429) {
    return null;
  }
  const headers = (error as { headers?: Record<string, string> }).headers;
  const raw = headers?.["retry-after"];
  const parsed = raw === undefined ? Number.NaN : Number.parseFloat(raw);
  return { status: 429, retryAfterSeconds: Number.isFinite(parsed) ? parsed : null };
}

/** Real client. Requires NOTION_TOKEN; never construct it in dry-run paths. */
export function createNotionApi(token: string): NotionApi {
  const client = new Client({ auth: token });
  return {
    async retrieveDataSource(dataSourceId) {
      const response = await client.dataSources.retrieve({ data_source_id: dataSourceId });
      const properties: Record<string, { type: string }> = {};
      const raw = (response as { properties?: Record<string, { type: string }> }).properties ?? {};
      for (const [name, definition] of Object.entries(raw)) {
        properties[name] = { type: definition.type };
      }
      return { id: response.id, properties };
    },

    async queryAllPages(dataSourceId) {
      const pages: NotionPage[] = [];
      let cursor: string | undefined;
      do {
        const response = await client.dataSources.query({
          data_source_id: dataSourceId,
          ...(cursor ? { start_cursor: cursor } : {})
        });
        for (const result of response.results) {
          if ("properties" in result) {
            pages.push({
              id: result.id,
              archived: "archived" in result ? result.archived : false,
              properties: result.properties as Record<string, unknown>
            });
          }
        }
        cursor = response.has_more ? (response.next_cursor ?? undefined) : undefined;
      } while (cursor);
      return pages.filter((page) => !page.archived);
    },

    async findPagesByJobId(dataSourceId, jobId) {
      const response = await client.dataSources.query({
        data_source_id: dataSourceId,
        filter: { property: "Job ID", rich_text: { equals: jobId } }
      });
      return response.results
        .filter((result) => "properties" in result)
        .map((result) => ({
          id: result.id,
          archived: "archived" in result ? (result as { archived: boolean }).archived : false,
          properties: (result as { properties: Record<string, unknown> }).properties
        }))
        .filter((page) => !page.archived);
    },

    async createPage(dataSourceId, properties, children) {
      const response = await client.pages.create({
        parent: { type: "data_source_id", data_source_id: dataSourceId },
        properties: properties as never,
        children: children as never
      });
      return { id: response.id };
    },

    async updatePage(pageId, properties) {
      await client.pages.update({ page_id: pageId, properties: properties as never });
    },

    async retrievePage(pageId) {
      const response = await client.pages.retrieve({ page_id: pageId });
      return {
        id: response.id,
        archived: "archived" in response ? response.archived : false,
        properties: "properties" in response ? (response.properties as Record<string, unknown>) : {}
      };
    }
  };
}
