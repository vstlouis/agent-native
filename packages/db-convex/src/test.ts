/// <reference types="vite/client" />
import type { TestConvex } from "convex-test";
import type { GenericSchema, SchemaDefinition } from "convex/server";

import { api } from "./component/_generated/api.js";
import schema from "./component/schema.js";

const modules = import.meta.glob("./component/**/*.ts");

/** Register this component on a host convex-test instance. */
export function register(
  t: TestConvex<SchemaDefinition<GenericSchema, boolean>>,
  name = "agentNativeDb",
): void {
  t.registerComponent(name, schema, modules);
}

export { api, schema, modules };
export default { register, schema, modules, api };
