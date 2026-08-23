---
"@agent-native/core": patch
"@agent-native/db-convex": patch
---

Add an opt-in Convex persistence driver behind `@agent-native/core/db` (`DATABASE_URL=convex:`) via the new `@agent-native/db-convex` Convex component. SQL-only APIs (`getDbExec`, `runMigrations`, `ensureAdditiveColumns`) throw a precise unsupported error on the Convex dialect.
