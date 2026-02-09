import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

type EnvMap = Record<string, string>;

function readEnvFile(path: string): EnvMap {
  if (!existsSync(path)) {
    return {};
  }
  const out: EnvMap = {};
  const content = readFileSync(path, "utf8");
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const eq = line.indexOf("=");
    if (eq <= 0) {
      continue;
    }
    out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return out;
}

function deploymentToUrl(deploymentRaw: string | undefined): string | null {
  if (!deploymentRaw) {
    return null;
  }
  const deployment = deploymentRaw.includes(":")
    ? deploymentRaw.slice(deploymentRaw.lastIndexOf(":") + 1)
    : deploymentRaw;
  return deployment ? `https://${deployment}.convex.cloud` : null;
}

export function resolveConvexUrl(): string | null {
  if (process.env.CONVEX_URL) {
    return process.env.CONVEX_URL;
  }
  if (process.env.NEXT_PUBLIC_CONVEX_URL) {
    return process.env.NEXT_PUBLIC_CONVEX_URL;
  }

  const envLocal = readEnvFile(join(process.cwd(), ".env.local"));
  const convexEnvLocal = readEnvFile(join(process.cwd(), "convex", ".env.local"));
  const merged: EnvMap = { ...envLocal, ...convexEnvLocal };

  if (merged.CONVEX_URL) {
    return merged.CONVEX_URL;
  }
  if (merged.NEXT_PUBLIC_CONVEX_URL) {
    return merged.NEXT_PUBLIC_CONVEX_URL;
  }
  return deploymentToUrl(merged.CONVEX_DEPLOYMENT);
}
