---
"@agent-native/core": patch
"@agent-native/db-convex": patch
---

Add an opt-in Convex dialect to `@agent-native/core/db` (`DATABASE_URL=convex:`). The Node client lives next to the other dialect branches; `@agent-native/db-convex` is the publishable Convex component (schema + mutations) apps mount with `app.use`.
