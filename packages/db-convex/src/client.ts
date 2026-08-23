import { ConvexHttpClient } from "convex/browser";
import { getTableName } from "drizzle-orm";

/**
 * Minimal transport used by the Drizzle-shaped Convex client.
 * Production uses ConvexHttpClient; tests inject a convex-test transport.
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
  /**
   * Deployment URL (`https://….convex.cloud`). When omitted, reads
   * `CONVEX_URL` / `NEXT_PUBLIC_CONVEX_URL`, or the `convex:<url>` DATABASE_URL form.
   */
  convexUrl?: string;
  /** Override for convex-test / custom runners. */
  transport?: ConvexDbTransport;
  /**
   * Component mount name from the app's `convex.config.ts` (`app.use(...)`).
   * Default matches `defineComponent("agentNativeDb")`.
   */
  componentName?: string;
  /** Admin / deploy key when calling from a trusted server. */
  adminAuth?: string;
};

let testTransport: ConvexDbTransport | undefined;

const TEST_TRANSPORT_GLOBAL = Symbol.for(
  "@agent-native/db-convex.testTransport",
);

function readTestTransport(): ConvexDbTransport | undefined {
  const fromGlobal = (
    globalThis as Record<symbol, ConvexDbTransport | undefined>
  )[TEST_TRANSPORT_GLOBAL];
  return fromGlobal ?? testTransport;
}

/** Test-only hook so `createGetDb` can hit convex-test without HTTP. */
export function setConvexDbTestTransport(
  transport: ConvexDbTransport | undefined,
): void {
  testTransport = transport;
  (globalThis as Record<symbol, ConvexDbTransport | undefined>)[
    TEST_TRANSPORT_GLOBAL
  ] = transport;
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
    "Convex driver needs CONVEX_URL (or DATABASE_URL=convex:https://….convex.cloud). " +
      "# ponytail: auto-discovery via CONVEX_DEPLOYMENT, upgrade when wiring convex CLI deploy metadata.",
  );
}

function createHttpTransport(
  convexUrl: string,
  componentName: string,
  adminAuth?: string,
): ConvexDbTransport {
  const client = new ConvexHttpClient(convexUrl);
  if (adminAuth) {
    // Trusted server path for mutations from Nitro / actions.
    (client as { setAdminAuth?: (token: string) => void }).setAdminAuth?.(
      adminAuth,
    );
  }
  // Component function paths are opaque strings at the HTTP boundary.
  // `# ponytail: typed FunctionReference map from codegen, upgrade when the
  // published package ships generated component API helpers for HTTP clients.`
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
    const named = table as { [key: symbol]: unknown; name?: string };
    if (typeof named?.name === "string") return named.name;
    throw new Error(
      "Convex driver could not read drizzle table name from argument to insert/select/update/delete.",
    );
  }
}

function rowKeyOf(row: Record<string, unknown>): string {
  const key = row.id ?? row._id ?? row.key;
  if (key === undefined || key === null) {
    throw new Error(
      "Convex driver insert requires an `id` (or `_id`/`key`) field on each row. " +
        "# ponytail: infer primary key from drizzle table config, upgrade when shim grows getTableConfig support.",
    );
  }
  return String(key);
}

/**
 * Best-effort extraction of `{ column: value }` from a drizzle `eq(col, val)`
 * (or a plain object filter). Full SQL expression trees are out of scope.
 *
 * `# ponytail: and/or/gt/inArray, upgrade when the Convex driver owns a real
 * query planner (or delegates to kitcn/orm inside Convex).`
 */
export function parseWhereFilter(condition: unknown): Record<string, unknown> {
  if (
    condition &&
    typeof condition === "object" &&
    !Array.isArray(condition) &&
    !isDrizzleSql(condition)
  ) {
    return { ...(condition as Record<string, unknown>) };
  }

  const sqlObj = condition as {
    queryChunks?: unknown[];
  };
  const chunks = sqlObj?.queryChunks;
  if (!Array.isArray(chunks)) {
    throw new Error(
      "Convex driver only supports eq(column, value) or plain object filters in where().",
    );
  }

  let column: string | undefined;
  let value: unknown = undefined;
  let sawValue = false;
  for (const chunk of chunks) {
    if (!chunk || typeof chunk !== "object") continue;
    const col = chunk as { name?: unknown; table?: unknown };
    // Drizzle column objects carry both `name` and `table`.
    if (
      typeof col.name === "string" &&
      "table" in col &&
      column === undefined
    ) {
      column = col.name;
      continue;
    }
    // Bound params are `Param` objects with an encoder — ignore StringChunks
    // that also expose a `value` array for SQL text fragments.
    const param = chunk as { value?: unknown; encoder?: unknown };
    if ("encoder" in param && "value" in param && !sawValue) {
      value = param.value;
      sawValue = true;
    }
  }
  if (!column) {
    throw new Error(
      "Convex driver could not parse column from where() expression (expected drizzle eq()).",
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
 * Drizzle-shaped client backed by the agentNativeDb Convex component.
 *
 * Supports the subset templates need for a viability spike:
 * `insert().values()`, `select().from().where().limit()`,
 * `update().set().where()`, `delete().where()`.
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
