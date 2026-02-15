import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

type ResolveConvexUrlOptions = {
  cwd?: string;
  includeConvexDirEnv?: boolean;
  prioritizeVite?: boolean;
};

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

export function resolveConvexUrl(options: ResolveConvexUrlOptions = {}): string | null {
  const cwd = options.cwd ?? process.cwd();
  const includeConvexDirEnv = options.includeConvexDirEnv ?? true;
  const prioritizeVite = options.prioritizeVite ?? false;

  const envOrder = prioritizeVite
    ? [process.env.VITE_CONVEX_URL, process.env.CONVEX_URL, process.env.NEXT_PUBLIC_CONVEX_URL]
    : [process.env.CONVEX_URL, process.env.NEXT_PUBLIC_CONVEX_URL, process.env.VITE_CONVEX_URL];

  for (const candidate of envOrder) {
    if (candidate) {
      return candidate;
    }
  }

  const envLocal = readEnvFile(join(cwd, ".env.local"));
  const convexEnvLocal = includeConvexDirEnv ? readEnvFile(join(cwd, "convex", ".env.local")) : {};
  const merged = { ...envLocal, ...convexEnvLocal };

  const fileOrder = prioritizeVite
    ? ["VITE_CONVEX_URL", "CONVEX_URL", "NEXT_PUBLIC_CONVEX_URL"]
    : ["CONVEX_URL", "NEXT_PUBLIC_CONVEX_URL", "VITE_CONVEX_URL"];

  for (const key of fileOrder) {
    const value = merged[key];
    if (value) {
      return value;
    }
  }

  return deploymentToUrl(merged.CONVEX_DEPLOYMENT);
}
