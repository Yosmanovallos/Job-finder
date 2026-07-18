import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema.js";

export type Database = ReturnType<typeof drizzle<typeof schema>>;

export interface DbHandle {
  db: Database;
  close: () => Promise<void>;
}

export function createDb(databaseUrl: string, maxConnections = 5): DbHandle {
  const client = postgres(databaseUrl, { max: maxConnections, connect_timeout: 5 });
  const db = drizzle(client, { schema });
  return {
    db,
    close: () => client.end({ timeout: 5 })
  };
}
