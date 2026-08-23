/* eslint-disable */
/**
 * Generated `ComponentApi` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex codegen --component-dir ./src/component`.
 * @module
 */

import type { FunctionReference } from "convex/server";

export type ComponentApi<Name extends string | undefined = string | undefined> =
  {
    rows: {
      insert: FunctionReference<
        "mutation",
        "internal",
        { tableName: string; rowKey: string; data: any },
        null,
        Name
      >;
      list: FunctionReference<
        "query",
        "internal",
        {
          tableName: string;
          filter?: Record<string, any>;
          limit?: number;
        },
        any[],
        Name
      >;
      update: FunctionReference<
        "mutation",
        "internal",
        {
          tableName: string;
          filter: Record<string, any>;
          patch: any;
        },
        number,
        Name
      >;
      remove: FunctionReference<
        "mutation",
        "internal",
        { tableName: string; filter: Record<string, any> },
        number,
        Name
      >;
    };
  };
