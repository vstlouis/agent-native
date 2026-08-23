import { getTableName } from "drizzle-orm";

/**
 * Convex branch for createGetDb — same pattern as the neon/postgres/sqlite
 * branches in create-get-db.ts: a dialect-specific client, not a sibling db
 * package. The publishable Convex *component* (tables + mutations) lives in
 * `@agent-native/db-convex`; this file is only the Node-side caller.
 *
 * There is no default Node HTTP transport: ConvexHttpClient cannot legally
 * invoke internal component function refs from Node. Callers must inject a
 * transport (tests: setConvexDbTestTransport / convex-test; hosts: pass
 * CreateConvexDbOptions.transport).
 */

export type ConvexDbTransport = {
  query: (
    fn: "list",
    args: {
      tableName: string;
      filter?: Record<string, unknown>;
      limit?: number;
    },
  ) => Promise<Record<string, unknown>[]>;
  mutation: (
    fn: "insert" | "update" | "remove",
    args: Record<string, unknown>,
  ) => Promise<unknown>;
};

export type CreateConvexDbOptions = {
  /** Host- or test-provided transport. Required outside setConvexDbTestTransport. */
  transport?: ConvexDbTransport;
};

const TEST_TRANSPORT_GLOBAL = Symbol.for(
  "@agent-native/core/db.convexTestTransport",
);

/** Test hook so specs can inject convex-test without HTTP. */
export function setConvexDbTestTransport(
  transport: ConvexDbTransport | undefined,
): void {
  (globalThis as Record<symbol, ConvexDbTransport | undefined>)[
    TEST_TRANSPORT_GLOBAL
  ] = transport;
}

function readTestTransport(): ConvexDbTransport | undefined {
  return (globalThis as Record<symbol, ConvexDbTransport | undefined>)[
    TEST_TRANSPORT_GLOBAL
  ];
}

function requireTransport(options: CreateConvexDbOptions): ConvexDbTransport {
  if (options.transport) return options.transport;
  const test = readTestTransport();
  if (test) return test;
  throw new Error(
    "Convex dialect has no Node HTTP path to internal component functions. " +
      "ConvexHttpClient cannot call refs like `<component>/rows:insert` from Node. " +
      "Pass CreateConvexDbOptions.transport from the host, or call " +
      "setConvexDbTestTransport(...) in tests (e.g. convex-test against " +
      "@agent-native/db-convex).",
  );
}

function tableNameOf(table: unknown): string {
  try {
    return getTableName(table as never);
  } catch {
    const named = table as { name?: string };
    if (typeof named?.name === "string") return named.name;
    throw new Error(
      "Convex driver could not read drizzle table name from insert/select/update/delete.",
    );
  }
}

function rowKeyOf(row: Record<string, unknown>): string {
  const key = row.id ?? row._id ?? row.key;
  if (key === undefined || key === null) {
    throw new Error(
      "Convex driver insert requires an `id` (or `_id`/`key`) field on each row.",
    );
  }
  return String(key);
}

function isDrizzleSql(value: object): boolean {
  return (
    "queryChunks" in value ||
    "decoder" in value ||
    Symbol.for("drizzle:QueryPromise") in value
  );
}

function isStringChunk(chunk: object): chunk is { value: string[] } {
  return (
    Array.isArray((chunk as { value?: unknown }).value) &&
    (chunk as { value: unknown[] }).value.every((v) => typeof v === "string") &&
    !("encoder" in chunk) &&
    !("table" in chunk) &&
    !("queryChunks" in chunk)
  );
}

/**
 * Supports drizzle `eq(col, val)` or a plain `{ column: value }` object.
 * Throws on and/or/not/gt/neq/composites — never silently keeps the first eq.
 */
export function parseWhereFilter(condition: unknown): Record<string, unknown> {
  if (
    condition &&
    typeof condition === "object" &&
    !Array.isArray(condition) &&
    !isDrizzleSql(condition)
  ) {
    const filter = { ...(condition as Record<string, unknown>) };
    if (Object.keys(filter).length === 0) {
      throw new Error(
        "Convex driver where() requires a non-empty filter; an empty object would match every row.",
      );
    }
    return filter;
  }

  const chunks = (condition as { queryChunks?: unknown[] })?.queryChunks;
  if (!Array.isArray(chunks)) {
    throw new Error(
      "Convex driver only supports eq(column, value) or plain object filters in where().",
    );
  }

  let column: string | undefined;
  let value: unknown;
  let sawValue = false;
  let operator: string | undefined;

  for (const chunk of chunks) {
    if (!chunk || typeof chunk !== "object") continue;

    // Nested SQL = and/or/not/composites — refuse rather than taking the first eq.
    if (
      "queryChunks" in chunk &&
      Array.isArray((chunk as { queryChunks: unknown[] }).queryChunks)
    ) {
      throw new Error(
        "Convex driver where() only supports a single eq(column, value); and/or/not/composites are not supported.",
      );
    }

    const col = chunk as { name?: unknown; table?: unknown };
    if (typeof col.name === "string" && "table" in col) {
      if (column !== undefined) {
        throw new Error(
          "Convex driver where() only supports a single eq(column, value).",
        );
      }
      column = col.name;
      continue;
    }

    if (isStringChunk(chunk)) {
      const text = chunk.value.join("");
      if (text.trim() === "") continue;
      if (operator !== undefined) {
        throw new Error(
          "Convex driver where() only supports a single eq(column, value).",
        );
      }
      operator = text;
      continue;
    }

    const param = chunk as { value?: unknown; encoder?: unknown };
    if ("encoder" in param && "value" in param) {
      if (sawValue) {
        throw new Error(
          "Convex driver where() only supports a single eq(column, value).",
        );
      }
      value = param.value;
      sawValue = true;
    }
  }

  if (!column || !sawValue) {
    throw new Error(
      "Convex driver could not parse where() (expected drizzle eq(column, value)).",
    );
  }
  if (operator === undefined || operator.trim() !== "=") {
    throw new Error(
      `Convex driver where() only supports eq(column, value); got operator ${JSON.stringify(operator?.trim() ?? "(none)")}.`,
    );
  }
  return { [column]: value };
}

type ThenableQuery = PromiseLike<Record<string, unknown>[]> & {
  where: (condition: unknown) => ThenableQuery;
  limit: (n: number) => ThenableQuery;
};

function createSelectBuilder(
  transport: ConvexDbTransport,
  table: unknown,
): ThenableQuery {
  const state: {
    filter?: Record<string, unknown>;
    limit?: number;
  } = {};

  const run = () =>
    transport.query("list", {
      tableName: tableNameOf(table),
      filter: state.filter,
      limit: state.limit,
    });

  const builder = {
    where(condition: unknown) {
      state.filter = parseWhereFilter(condition);
      return builder;
    },
    limit(n: number) {
      state.limit = n;
      return builder;
    },
    then(
      onFulfilled?: ((value: Record<string, unknown>[]) => unknown) | null,
      onRejected?: ((reason: unknown) => unknown) | null,
    ) {
      return run().then(onFulfilled as never, onRejected as never);
    },
  };
  return builder as ThenableQuery;
}

function unsupportedDbMethod(prop: string | symbol): never {
  throw new Error(
    `Convex driver does not support db.${String(prop)} — only insert, select, update, and delete.`,
  );
}

/**
 * Drizzle-shaped client for the Convex dialect: insert / select / update /
 * delete. Raw SQL and migrations are refused at getDbExec / runMigrations.
 * Missing methods throw (including via createGetDb's lazy replay proxy).
 */
export function createConvexDb(options: CreateConvexDbOptions = {}) {
  const transport = requireTransport(options);

  const db = {
    insert(table: unknown) {
      return {
        values(values: Record<string, unknown> | Record<string, unknown>[]) {
          const rows = Array.isArray(values) ? values : [values];
          const tableName = tableNameOf(table);
          return Promise.all(
            rows.map((row) =>
              transport.mutation("insert", {
                tableName,
                rowKey: rowKeyOf(row),
                data: row,
              }),
            ),
          ).then(() => undefined);
        },
      };
    },
    select(fields?: unknown) {
      if (fields !== undefined) {
        throw new Error(
          "Convex driver only supports select() without column projections.",
        );
      }
      return {
        from(table: unknown) {
          return createSelectBuilder(transport, table);
        },
      };
    },
    update(table: unknown) {
      return {
        set(patch: Record<string, unknown>) {
          return {
            where(condition: unknown) {
              return transport.mutation("update", {
                tableName: tableNameOf(table),
                filter: parseWhereFilter(condition),
                patch,
              });
            },
          };
        },
      };
    },
    delete(table: unknown) {
      return {
        where(condition: unknown) {
          return transport.mutation("remove", {
            tableName: tableNameOf(table),
            filter: parseWhereFilter(condition),
          });
        },
      };
    },
  };

  return new Proxy(db, {
    get(target, prop, receiver) {
      if (prop in target) {
        return Reflect.get(target, prop, receiver);
      }
      if (typeof prop === "symbol") {
        return Reflect.get(target, prop, receiver);
      }
      return unsupportedDbMethod(prop);
    },
  });
}

export type ConvexDb = ReturnType<typeof createConvexDb>;
