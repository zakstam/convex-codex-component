export {
  defineCodexHostDefinitions,
  type CodexHostDefinitions,
  type CodexHostSliceFeatures,
  type CodexHostSliceIngestMode,
  type CodexHostSliceProfile,
  type DefineCodexHostDefinitionsOptions,
  type RuntimeOwnedHostDefinitions,
} from "./convexPreset.js";

export {
  HOST_SURFACE_MANIFEST,
  HOST_MUTATION_INTERNAL_ALIASES,
  HOST_QUERY_INTERNAL_ALIASES,
  type HostSurfaceProfile,
  type HostSurfaceMutationKey,
  type HostSurfaceQueryKey,
} from "./surfaceManifest.js";
export {
  HOST_CONTRACT_ARTIFACT,
  type HostContractProfile,
  type HostContractMutationKey,
  type HostContractQueryKey,
} from "../contractArtifact.js";

export {
  renderCodexHostShim,
  type CodexHostShimRenderOptions,
} from "./shim.js";
