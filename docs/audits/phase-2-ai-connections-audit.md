# Phase 2 AI Connections — Implementation Audit

> **Archived historical snapshot** (originally `Phase2-Audit.md` at the repo root, moved 2026-09-27). The "Missing / Not Done" items below were closed afterwards — `apps/api/tests/ai-connections.test.ts` now exists. `AI_CONTEXT.md` is the source of truth.

**Scope source:** `AI_CONTEXT.md` §9 + user Phase 2 spec  
**Compile status:** CLEAN (`tsc --noEmit` exit 0)  
**Test file:** NONE — must be written  

---

## ✅ Implemented

| Capability | Route | Service | Status |
|---|---|---|---|
| Create connection | `POST /ai-connections` | `createConnection()` — validates, encrypts creds, `isActive=false` | ✅ |
| List connections | `GET /ai-connections` | `listConnections()` — cursor pagination, `userId` filter | ✅ |
| Get single | `GET /ai-connections/:id` | `getConnection()` — `findFirst({id, userId})`, 404 if missing | ✅ |
| Update connection | `PATCH /ai-connections/:id` | `updateConnection()` — re-encrypts creds on change, deactivates others on `isActive=true` | ✅ |
| Delete connection | `DELETE /ai-connections/:id` | `deleteConnection()` — `findFirst` + `delete`, 404 if missing | ✅ |
| Test connection (ad-hoc) | `POST /ai-connections/test` | `testConnection()` with `connectionId=undefined` — validates input, calls provider, sanitizes errors | ✅ |
| Test existing connection | `POST /ai-connections/:id/test` | `testConnection()` with `connectionId` — decrypts creds, calls provider | ✅ |
| Set active | `POST /ai-connections/:id/activate` | `setActiveConnection()` — deactivates all others in transaction | ✅ |
| Get active | `GET /ai-connections/active` | `getActiveConnection()` — `findFirst({userId, isActive:true})` | ✅ |
| Resolve for AI requests | (internal) | `resolveUserConnection()` — decrypts creds, zeroes buffer, returns null if none active | ✅ |
| Provider integration | (internal) | `getAIProvider(userId)` in `provider.ts` → calls `resolveUserConnection(userId)` dynamically | ✅ |
| Route mounting | `src/routes/index.ts:41` | `apiRouter.use("/ai-connections", aiConnections)` | ✅ |
| Auth guard | all routes | `router.use(authenticate)` | ✅ |
| Prisma model | `schema.prisma:586` | `AiConnection` — `@@unique([userId, provider])` | ✅ |
| Encryption | `@/lib/encryption` | `encrypt()` / `decrypt()` used in create/update/test/resolve | ✅ |
| Providers supported | schema enum | `openai`, `gemini`, `anthropic`, `openrouter`, `ollama`, `custom` | ✅ |

## ❌ Missing / Not Done

| Item | Detail |
|---|---|
| **Test file** | `tests/ai-connections.test.ts` does not exist. Must cover: create, list, get, update (fields + activate), delete, test (ad-hoc + existing), auth guard (unauthenticated → 401), cross-user isolation (other user's conn → 404), duplicate provider → 409. |
| **Frontend Settings page** | No UI integration exists. `/settings` page does not have an AI connections section. `apps/web/src` has zero references to `ai-connections`. Phase 2 spec says "Frontend Settings page integration" — this is not done. |
| **Encryption tests** | No explicit test that credentials are encrypted at rest (DB stores `credentialsEncrypted`, never raw). This is an important security invariant to assert. |
| **Ollama / custom endpoint validation** | `CreateAiConnectionSchema` requires endpoint for `ollama` and `custom` — verified in schema, but no test asserts this validation fires. |

---

## Notes

- The `@@unique([userId, provider])` constraint means a user can have at most one connection per provider. Creating a second connection for the same provider will hit Prisma `P2002` → 400 `DUPLICATE_VALUE`. This is correct behaviour but should be tested.
- `testConnection()` accepts `credentials as any` when calling the provider adapter — this is a type escape. The provider's `testConnection` expects `ProviderCredentials` which is a wrapper, but the implementation passes the raw string. This works at runtime but is technically a type mismatch. Could be cleaned up but doesn't block Phase 2.
- `resolveUserConnection()` zeroes the `Buffer` in `finally` to prevent credential leaks via closure — good security practice, present in code.
