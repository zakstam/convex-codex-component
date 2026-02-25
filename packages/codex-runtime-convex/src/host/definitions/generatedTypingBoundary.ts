import type { CodexHostComponentRefs, CodexHostComponentsInput } from "../convexSlice.js";

/**
 * Generated Convex component refs can have broad typing in some workspaces.
 * Keep normalization at this host boundary so handwritten runtime/React code
 * does not need to carry casts or fallback unknown-like types.
 */
export function resolveHostComponentRefs(
  components: CodexHostComponentsInput<object>,
): CodexHostComponentRefs {
  return hasCodexLocalComponentRefs(components)
    ? components.codexLocal
    : (components as CodexHostComponentRefs);
}

function hasCodexLocalComponentRefs(
  components: CodexHostComponentsInput<object>,
): components is { codexLocal: CodexHostComponentRefs } {
  return Reflect.get(components, "codexLocal") !== undefined;
}
