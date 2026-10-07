import { beforeAll } from "vitest";
import { cleanupDb } from "./helpers";

// Each test file starts from an empty database, so the fixed emails
// used by registerAndLogin (alice@studentos.test, tasks@test.com, ...)
// never collide — neither across files nor with stale rows from earlier
// runs. Files run sequentially (fileParallelism: false).
beforeAll(async () => {
  await cleanupDb();
}, 60_000);