import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = join(here, "..");

const iconPath = join(appRoot, "src-tauri", "icons", "icon.png");
if (!existsSync(iconPath)) {
  throw new Error(`Missing required Tauri icon: ${iconPath}`);
}

const distDir = join(appRoot, "dist");
mkdirSync(distDir, { recursive: true });
const distIndexPath = join(distDir, "index.html");
if (!existsSync(distIndexPath)) {
  writeFileSync(
    distIndexPath,
    "<!doctype html><html><head><meta charset=\"utf-8\"></head><body><div id=\"root\"></div></body></html>\n",
    "utf8",
  );
}
