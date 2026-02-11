type DefinitionMap = Record<string, unknown>;
type WrappedResult<Wrap> = Wrap extends (...args: never[]) => infer Result ? Result : never;
type WrappedDefinitionMap<Defs extends DefinitionMap, Wrap> = {
  [Key in keyof Defs]: WrappedResult<Wrap>;
};

export function wrapHostDefinitions<
  Defs extends { mutations: DefinitionMap; queries: DefinitionMap },
  MutationWrap,
  QueryWrap,
>(
  defs: Defs,
  wrap: {
    mutation: MutationWrap;
    query: QueryWrap;
  },
): Omit<Defs, "mutations" | "queries"> & {
  mutations: WrappedDefinitionMap<Defs["mutations"], MutationWrap>;
  queries: WrappedDefinitionMap<Defs["queries"], QueryWrap>;
} {
  const mutationWrapper = wrap.mutation as (
    definition: Defs["mutations"][keyof Defs["mutations"]]
  ) => WrappedResult<MutationWrap>;
  const queryWrapper = wrap.query as (
    definition: Defs["queries"][keyof Defs["queries"]]
  ) => WrappedResult<QueryWrap>;

  const mutationEntries = Object.entries(defs.mutations).map(([name, definition]) => [
    name,
    mutationWrapper(definition as Defs["mutations"][keyof Defs["mutations"]]),
  ]);
  const queryEntries = Object.entries(defs.queries).map(([name, definition]) => [
    name,
    queryWrapper(definition as Defs["queries"][keyof Defs["queries"]]),
  ]);

  return {
    ...defs,
    mutations: Object.fromEntries(mutationEntries) as WrappedDefinitionMap<Defs["mutations"], MutationWrap>,
    queries: Object.fromEntries(queryEntries) as WrappedDefinitionMap<Defs["queries"], QueryWrap>,
  };
}
