import { copyFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

// pdf.js loads its worker as a separate URL. Serving the worker from our own
// origin avoids a CDN (blocked in some networks) and keeps the version pinned to
// the installed `pdfjs-dist` build. The file is generated into `public/` before
// dev/build so it is copied verbatim into the Next.js output.
const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const workerSource = require.resolve("pdfjs-dist/build/pdf.worker.min.mjs");
const publicDir = path.join(root, "public");
const workerTarget = path.join(publicDir, "pdf.worker.min.mjs");

await mkdir(publicDir, { recursive: true });
await copyFile(workerSource, workerTarget);
console.log(`[pdf-worker] copied to ${path.relative(root, workerTarget)}`);
