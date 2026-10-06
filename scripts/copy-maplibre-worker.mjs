// Copies MapLibre's web-worker bundle into /public so the browser can load it at
// /maplibre/maplibre-gl-worker.mjs. MapLibre's default lookup is relative to its own
// module URL, which breaks once Vite bundles or pre-bundles the library.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "node_modules", "maplibre-gl", "dist");
const target = join(root, "public", "maplibre");

if (!existsSync(source)) {
  console.warn("[maplibre] node_modules/maplibre-gl not found; run npm install first.");
  process.exit(0);
}
mkdirSync(target, { recursive: true });
for (const file of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) {
  copyFileSync(join(source, file), join(target, file));
}
console.log("[maplibre] worker copied to public/maplibre/");
