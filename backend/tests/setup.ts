import { beforeAll } from "vitest";
import { setOutboundTransportForTests } from "@/utils/safe-fetch";
import { cleanupDb } from "./helpers";

// Production egress goes through the pinned `safeFetch` transport (see
// `utils/safe-fetch.ts`). The AI adapters are exercised in tests against a
// stubbed global `fetch`, so route the outbound transport through it. This keeps
// every existing `vi.stubGlobal("fetch", …)` seam working while dedicated tests
// in `safe-fetch.test.ts` exercise the real pinned transport directly.
setOutboundTransportForTests((url, init) => globalThis.fetch(url, init));

// Each test file starts from an empty database, so the fixed emails
// used by registerAndLogin (alice@studentos.test, tasks@test.com, ...)
// never collide — neither across files nor with stale rows from earlier
// runs. Files run sequentially (fileParallelism: false).
beforeAll(async () => {
  await cleanupDb();
}, 60_000);