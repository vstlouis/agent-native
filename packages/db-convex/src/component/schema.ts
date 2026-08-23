import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/** One Convex table backs every logical drizzle table name. */
export default defineSchema({
  rows: defineTable({
    tableName: v.string(),
    rowKey: v.string(),
    data: v.any(),
  })
    .index("by_table", ["tableName"])
    .index("by_table_key", ["tableName", "rowKey"]),
});
