import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { HarnessEvent } from "./eventModel.js";

export async function writeTrace(pathname: string, events: HarnessEvent[]): Promise<string> {
  const out = resolve(pathname);
  await mkdir(dirname(out), { recursive: true });
  const lines = events.map((event) => JSON.stringify(event)).join("\n");
  await writeFile(out, lines.length > 0 ? `${lines}\n` : "", "utf8");
  return out;
}
