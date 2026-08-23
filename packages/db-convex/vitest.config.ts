import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // Re-export surface for createGetDb — avoid core/db/index.ts which eagerly
      // imports better-sqlite3 for createDb (unrelated to the Convex branch).
      "@agent-native/core/db": path.resolve(
        root,
        "../core/src/db/create-get-db.ts",
      ),
      // createGetDb dynamically imports the package name — point at source.
      "@agent-native/db-convex": path.resolve(root, "./src/index.ts"),
    },
  },
  test: {
    environment: "edge-runtime",
    include: ["src/**/*.test.ts"],
  },
});
