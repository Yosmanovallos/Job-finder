import { getTableColumns, getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { bootstrapCheck } from "./schema.js";

describe("schema", () => {
  it("defines the bootstrap_check table with expected columns", () => {
    expect(getTableName(bootstrapCheck)).toBe("bootstrap_check");
    const columns = Object.keys(getTableColumns(bootstrapCheck));
    expect(columns).toEqual(expect.arrayContaining(["id", "note", "createdAt"]));
  });
});
