import type { CodexHostComponentRefs, CodexHostComponentsInput } from "./convexSlice.js";

/**
 * Generated Convex component refs can have broad typing in some workspaces.
 * Keep normalization at this host boundary so handwritten runtime/React code
 * does not need to carry casts or fallback `any` types.
 */
export function resolveHostComponentRefs(
  components: CodexHostComponentsInput,
): CodexHostComponentRefs {
  return "codexLocal" in components ? components.codexLocal : components;
}
