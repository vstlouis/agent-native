import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Generic document store for the agent-native Convex driver.
 *
 * One physical Convex table holds rows for every logical Drizzle table.
 * `# ponytail: typed per-app Convex tables, upgrade when the driver maps
 * drizzle schema helpers onto convexTable definitions (kitcn-style).`
 */
export default defineSchema({
  rows: defineTable({
    tableName: v.string(),
    rowKey: v.string(),
    data: v.any(),
  })
    .index("by_table", ["tableName"])
    .index("by_table_key", ["tableName", "rowKey"]),
});
