#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const distGeneratorPath = resolve(repoRoot, "packages/codex-local-component/dist/host/surfaceGenerator.js");

if (!existsSync(distGeneratorPath)) {
  console.error("Missing host generator build artifact.");
  console.error("Run `pnpm --filter @zakstam/codex-local-component run build` first.");
  process.exit(1);
}

const {
  renderHostChatEntryModule,
  renderHostChatGenerated,
  renderHostExtensionsScaffold,
  renderHostPresetMatrixMarkdown,
  renderHostWiringSmokeScript,
} = await import(pathToFileURL(distGeneratorPath).href);

const checkMode = process.argv.includes("--check");
const writes = [];
const mismatches = [];

function normalize(content) {
  return content.endsWith("\n") ? content : `${content}\n`;
}

function upsertFile(path, nextContent) {
  const normalized = normalize(nextContent);
  const exists = existsSync(path);
  const current = exists ? readFileSync(path, "utf8") : null;

  if (checkMode) {
    if (!exists || current !== normalized) {
      mismatches.push(path);
    }
    return;
  }

  if (exists && current === normalized) {
    return;
  }

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, normalized, "utf8");
  writes.push(path);
}

function ensureFile(path, content) {
  if (existsSync(path)) {
    return;
  }
  upsertFile(path, content);
}

const tauriExtensionsTemplate = `import { v } from "convex/values";
import { query } from "./_generated/server";
import { components } from "./_generated/api";
import { vHostActorContext } from "@zakstam/codex-local-component/host/convex";
import { SERVER_ACTOR } from "./chat.generated";

export const listThreadsForPicker = query({
  args: {
    actor: vHostActorContext,
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const listed = await ctx.runQuery(components.codexLocal.threads.list, {
      actor: SERVER_ACTOR,
      paginationOpts: {
        numItems: Math.max(1, Math.floor(args.limit ?? 25)),
        cursor: null,
      },
    });

    const page = listed.page as Array<{
      threadId: string;
      status: string;
      updatedAt: number;
    }>;

    const rows = await Promise.all(
      page.map(async (thread) => {
        const mapping = await ctx.runQuery(components.codexLocal.threads.getExternalMapping, {
          actor: SERVER_ACTOR,
          threadId: thread.threadId,
        });
        return {
          threadId: thread.threadId,
          status: thread.status,
          updatedAt: thread.updatedAt,
          runtimeThreadId: mapping?.externalThreadId ?? null,
        };
      }),
    );

    return {
      threads: rows,
      hasMore: !listed.isDone,
      continueCursor: listed.continueCursor,
    };
  },
});
`;

const targets = [
  {
    profile: "runtimeOwned",
    chatGeneratedPath: resolve(repoRoot, "apps/examples/persistent-cli-app/convex/chat.generated.ts"),
    chatEntryPath: resolve(repoRoot, "apps/examples/persistent-cli-app/convex/chat.ts"),
    chatExtensionsPath: resolve(repoRoot, "apps/examples/persistent-cli-app/convex/chat.extensions.ts"),
    wiringPath: resolve(repoRoot, "apps/examples/persistent-cli-app/scripts/check-wiring-convex.mjs"),
    wiring: {
      resolverImportPath: "../../../shared/resolveConvexUrl.mjs",
      includeConvexDirEnv: true,
      label: "persistent-cli",
      prioritizeVite: false,
    },
    extensionTemplate: renderHostExtensionsScaffold(),
  },
  {
    profile: "dispatchManaged",
    chatGeneratedPath: resolve(repoRoot, "apps/examples/tauri-app/convex/chat.generated.ts"),
    chatEntryPath: resolve(repoRoot, "apps/examples/tauri-app/convex/chat.ts"),
    chatExtensionsPath: resolve(repoRoot, "apps/examples/tauri-app/convex/chat.extensions.ts"),
    wiringPath: resolve(repoRoot, "apps/examples/tauri-app/scripts/check-wiring-convex.mjs"),
    wiring: {
      resolverImportPath: "../../../shared/resolveConvexUrl.mjs",
      includeConvexDirEnv: false,
      label: "tauri",
      prioritizeVite: true,
    },
    extensionTemplate: tauriExtensionsTemplate,
  },
  {
    profile: "runtimeOwned",
    chatGeneratedPath: resolve(repoRoot, "apps/release-smoke-host/convex/chat.generated.ts"),
    chatEntryPath: resolve(repoRoot, "apps/release-smoke-host/convex/chat.ts"),
    chatExtensionsPath: resolve(repoRoot, "apps/release-smoke-host/convex/chat.extensions.ts"),
    wiringPath: resolve(repoRoot, "apps/release-smoke-host/scripts/check-wiring-convex.mjs"),
    wiring: {
      resolverImportPath: "../../shared/resolveConvexUrl.mjs",
      includeConvexDirEnv: true,
      label: "release-smoke-host",
      prioritizeVite: false,
    },
    extensionTemplate: renderHostExtensionsScaffold(),
  },
];

for (const target of targets) {
  upsertFile(
    target.chatGeneratedPath,
    renderHostChatGenerated({
      profile: target.profile,
    }),
  );
  upsertFile(target.chatEntryPath, renderHostChatEntryModule());
  ensureFile(target.chatExtensionsPath, target.extensionTemplate);
  upsertFile(target.wiringPath, renderHostWiringSmokeScript(target.wiring));
}

const hostPresetMatrixPath = resolve(repoRoot, "packages/codex-local-component/docs/HOST_PRESET_MATRIX.md");
upsertFile(hostPresetMatrixPath, renderHostPresetMatrixMarkdown());

if (checkMode) {
  if (mismatches.length > 0) {
    console.error("Generated host surface files are out of date:");
    for (const mismatch of mismatches) {
      console.error(`- ${mismatch}`);
    }
    console.error("Run `pnpm run host:generate` from the repo root.");
    process.exit(1);
  }
  console.log("host surfaces: generated files are up to date");
  process.exit(0);
}

if (writes.length === 0) {
  console.log("host surfaces: no changes");
  process.exit(0);
}

console.log("host surfaces: updated files");
for (const path of writes) {
  console.log(`- ${path}`);
}
