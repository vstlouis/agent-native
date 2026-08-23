import { v } from "convex/values";

import { mutation, query } from "./_generated/server.js";

export const insert = mutation({
  args: {
    tableName: v.string(),
    rowKey: v.string(),
    data: v.any(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("rows")
      .withIndex("by_table_key", (q) =>
        q.eq("tableName", args.tableName).eq("rowKey", args.rowKey),
      )
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, { data: args.data });
      return null;
    }
    await ctx.db.insert("rows", {
      tableName: args.tableName,
      rowKey: args.rowKey,
      data: args.data,
    });
    return null;
  },
});

export const list = query({
  args: {
    tableName: v.string(),
    filter: v.optional(v.record(v.string(), v.any())),
    limit: v.optional(v.number()),
  },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    let rows = await ctx.db
      .query("rows")
      .withIndex("by_table", (q) => q.eq("tableName", args.tableName))
      .collect();
    if (args.filter) {
      const filter = args.filter;
      rows = rows.filter((row) =>
        Object.entries(filter).every(
          ([key, value]) => row.data?.[key] === value,
        ),
      );
    }
    const docs = rows.map((row) => row.data);
    if (args.limit !== undefined) return docs.slice(0, args.limit);
    return docs;
  },
});

export const update = mutation({
  args: {
    tableName: v.string(),
    filter: v.record(v.string(), v.any()),
    patch: v.any(),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("rows")
      .withIndex("by_table", (q) => q.eq("tableName", args.tableName))
      .collect();
    let updated = 0;
    for (const row of rows) {
      const matches = Object.entries(args.filter).every(
        ([key, value]) => row.data?.[key] === value,
      );
      if (!matches) continue;
      await ctx.db.patch(row._id, {
        data: { ...row.data, ...args.patch },
      });
      updated += 1;
    }
    return updated;
  },
});

export const remove = mutation({
  args: {
    tableName: v.string(),
    filter: v.record(v.string(), v.any()),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("rows")
      .withIndex("by_table", (q) => q.eq("tableName", args.tableName))
      .collect();
    let removed = 0;
    for (const row of rows) {
      const matches = Object.entries(args.filter).every(
        ([key, value]) => row.data?.[key] === value,
      );
      if (!matches) continue;
      await ctx.db.delete(row._id);
      removed += 1;
    }
    return removed;
  },
});
