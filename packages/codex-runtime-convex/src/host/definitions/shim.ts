import { HOST_SURFACE_MANIFEST } from "./surfaceManifest.js";

export type CodexHostShimRenderOptions = {
  extensionModule?: string;
  extensionExports?: string[];
  definitionsIdentifier?: string;
};

function renderExtensionExport(options: CodexHostShimRenderOptions): string[] {
  if (!options.extensionExports || options.extensionExports.length === 0) {
    return [];
  }
  const extensionModule = options.extensionModule ?? "./chat.extensions";
  return [
    `export { ${options.extensionExports.join(", ")} } from \"${extensionModule}\";`,
    "",
  ];
}

function renderMutationExports(definitionsIdentifier: string): string[] {
  return HOST_SURFACE_MANIFEST.runtimeOwned.mutations.map(
    (name) =>
      `export const ${name} = mutation(${definitionsIdentifier}.mutations.${name});`,
  );
}

function renderQueryExports(definitionsIdentifier: string): string[] {
  return HOST_SURFACE_MANIFEST.runtimeOwned.queries.map(
    (name) =>
      `export const ${name} = query(${definitionsIdentifier}.queries.${name});`,
  );
}

export function renderCodexHostShim(
  options: CodexHostShimRenderOptions = {},
): string {
  const definitionsIdentifier = options.definitionsIdentifier ?? "codex";

  const lines = [
    "import { mutation, query } from \"./_generated/server\";",
    "import { components } from \"./_generated/api\";",
    "import { defineCodexHostDefinitions } from \"@zakstam/codex-runtime-convex/host\";",
    "",
    ...renderExtensionExport(options),
    `const ${definitionsIdentifier} = defineCodexHostDefinitions({ components });`,
    "",
    ...renderMutationExports(definitionsIdentifier),
    "",
    ...renderQueryExports(definitionsIdentifier),
    "",
  ];

  return lines.join("\n");
}
