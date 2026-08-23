import { ConvexHttpClient } from "convex/browser";
import { getTableName } from "drizzle-orm";

/**
 * Convex branch for createGetDb — same pattern as the neon/postgres/sqlite
 * branches in create-get-db.ts: a dialect-specific client, not a sibling db
 * package. The publishable Convex *component* (tables + mutations) lives in
 * `@agent-native/db-convex`; this file is only the Node-side caller.
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
  convexUrl?: string;
  transport?: ConvexDbTransport;
  /** Mount name from the app's `app.use(...)` — default `agentNativeDb`. */
  componentName?: string;
  adminAuth?: string;
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

export function isConvexDatabaseUrl(url: string): boolean {
  return (
    url === "convex" ||
    url === "convex:" ||
    url.startsWith("convex:") ||
    url.startsWith("convex://")
  );
}

export function resolveConvexDeploymentUrl(
  databaseUrl = "",
  explicit?: string,
): string {
  if (explicit) return explicit;
  if (databaseUrl.startsWith("convex://")) {
    return `https://${databaseUrl.slice("convex://".length)}`;
  }
  if (
    databaseUrl.startsWith("convex:") &&
    databaseUrl.length > "convex:".length
  ) {
    const rest = databaseUrl.slice("convex:".length);
    if (rest.startsWith("https://") || rest.startsWith("http://")) return rest;
  }
  const fromEnv =
    process.env.CONVEX_URL ||
    process.env.NEXT_PUBLIC_CONVEX_URL ||
    process.env.VITE_CONVEX_URL ||
    "";
  if (fromEnv) return fromEnv;
  throw new Error(
    "Convex driver needs CONVEX_URL (or DATABASE_URL=convex:https://….convex.cloud).",
  );
}

function createHttpTransport(
  convexUrl: string,
  componentName: string,
  adminAuth?: string,
): ConvexDbTransport {
  const client = new ConvexHttpClient(convexUrl);
  if (adminAuth) {
    (client as { setAdminAuth?: (token: string) => void }).setAdminAuth?.(
      adminAuth,
    );
  }
  const call = client as {
    query: (ref: never, args: never) => Promise<unknown>;
    mutation: (ref: never, args: never) => Promise<unknown>;
  };
  const ref = (fn: string) => `${componentName}/rows:${fn}` as never;
  return {
    query: (fn, args) =>
      call.query(ref(fn), args as never) as Promise<Record<string, unknown>[]>,
    mutation: (fn, args) => call.mutation(ref(fn), args as never),
  };
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

/** Supports drizzle `eq(col, val)` or a plain `{ column: value }` object. */
export function parseWhereFilter(condition: unknown): Record<string, unknown> {
  if (
    condition &&
    typeof condition === "object" &&
    !Array.isArray(condition) &&
    !isDrizzleSql(condition)
  ) {
    return { ...(condition as Record<string, unknown>) };
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
  for (const chunk of chunks) {
    if (!chunk || typeof chunk !== "object") continue;
    const col = chunk as { name?: unknown; table?: unknown };
    if (
      typeof col.name === "string" &&
      "table" in col &&
      column === undefined
    ) {
      column = col.name;
      continue;
    }
    const param = chunk as { value?: unknown; encoder?: unknown };
    if ("encoder" in param && "value" in param && !sawValue) {
      value = param.value;
      sawValue = true;
    }
  }
  if (!column) {
    throw new Error(
      "Convex driver could not parse column from where() (expected drizzle eq()).",
    );
  }
  return { [column]: value };
}

function isDrizzleSql(value: object): boolean {
  return (
    "queryChunks" in value ||
    "decoder" in value ||
    Symbol.for("drizzle:QueryPromise") in value
  );
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

/**
 * Drizzle-shaped client for the Convex dialect: insert / select / update /
 * delete. Raw SQL and migrations are refused at getDbExec / runMigrations.
 */
export function createConvexDb(options: CreateConvexDbOptions = {}) {
  const componentName = options.componentName ?? "agentNativeDb";
  const transport =
    options.transport ??
    readTestTransport() ??
    createHttpTransport(
      resolveConvexDeploymentUrl(
        process.env.DATABASE_URL ?? "",
        options.convexUrl,
      ),
      componentName,
      options.adminAuth ?? process.env.CONVEX_DEPLOY_KEY,
    );

  return {
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
    select(_fields?: unknown) {
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
}

export type ConvexDb = ReturnType<typeof createConvexDb>;
