---
"@agent-native/core": patch
---

Add an opt-in Convex dialect to `@agent-native/core/db` (`DATABASE_URL=convex://`). The Node client lives next to the other dialect branches; `@agent-native/db-convex` is the workspace Convex component (schema + mutations) apps mount with `app.use`.
