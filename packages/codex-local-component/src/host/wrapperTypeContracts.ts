import type {
  CodexHostFacade,
  CodexHostActorResolver,
  CreateCodexHostOptions,
  RuntimeOwnedHostDefinitions,
} from "./convexPreset.js";
import type { CodexHostComponentsInput } from "./convexSlice.js";

type Assert<T extends true> = T;
type Extends<A, B> = A extends B ? true : false;
type IsNever<T> = [T] extends [never] ? true : false;

type MutationDef = RuntimeOwnedHostDefinitions["mutations"][keyof RuntimeOwnedHostDefinitions["mutations"]];
type QueryDef = RuntimeOwnedHostDefinitions["queries"][keyof RuntimeOwnedHostDefinitions["queries"]];

type MutationWrap = (
  definition: MutationDef,
) => { definition: MutationDef; kind: "mutation" };
type QueryWrap = (
  definition: QueryDef,
) => { definition: QueryDef; kind: "query" };

type Facade = CodexHostFacade<MutationWrap, QueryWrap>;

type _EnsureMutationWrapperOutputNotNever = Assert<
  Extends<IsNever<Facade["mutations"]["ensureThread"]>, false>
>;
type _EnsureQueryWrapperOutputNotNever = Assert<
  Extends<IsNever<Facade["queries"]["validateHostWiring"]>, false>
>;
type _EnsureMutationWrapperCarriesDefinition = Assert<
  Extends<
    Facade["mutations"]["ensureThread"],
    { definition: MutationDef; kind: "mutation" }
  >
>;
type _EnsureQueryWrapperCarriesDefinition = Assert<
  Extends<
    Facade["queries"]["validateHostWiring"],
    { definition: QueryDef; kind: "query" }
  >
>;

type _ValidCreateOptions = CreateCodexHostOptions<
  CodexHostComponentsInput,
  MutationWrap,
  QueryWrap
>;
type _EnsureValidCreateOptionsCompiles = Assert<Extends<_ValidCreateOptions, object>>;

declare const components: CodexHostComponentsInput;
declare const actorPolicy: {
  mode: "serverActor";
  serverActor: { userId: string };
};
declare const validMutationWrap: MutationWrap;
declare const validQueryWrap: QueryWrap;
declare const invalidMutationWrap: (definition: { nope: true }) => { nope: true };
declare const invalidQueryWrap: (definition: { nope: true }) => { nope: true };
declare const actorResolver: CodexHostActorResolver;

const _ValidCreateOptionsValue: CreateCodexHostOptions<
  CodexHostComponentsInput,
  MutationWrap,
  QueryWrap
> = {
  components,
  mutation: validMutationWrap,
  query: validQueryWrap,
  actorPolicy,
  actorResolver,
};

const _InvalidMutationWrapperRejected: CreateCodexHostOptions<
  CodexHostComponentsInput,
  (definition: { nope: true }) => { nope: true },
  QueryWrap
> = {
  components,
  // @ts-expect-error Invalid mutation wrapper is rejected at compile time.
  mutation: invalidMutationWrap,
  query: validQueryWrap,
  actorPolicy,
};

const _InvalidQueryWrapperRejected: CreateCodexHostOptions<
  CodexHostComponentsInput,
  MutationWrap,
  (definition: { nope: true }) => { nope: true }
> = {
  components,
  mutation: validMutationWrap,
  // @ts-expect-error Invalid query wrapper is rejected at compile time.
  query: invalidQueryWrap,
  actorPolicy,
};

export {};
