import schema from "./component/schema.js";

export type ComponentTestModules = Record<string, unknown>;

export type ComponentTestRegistry = {
  registerComponent(name: string, schema: unknown, modules: ComponentTestModules): void;
};

export function register(
  t: ComponentTestRegistry,
  options: {
    modules: ComponentTestModules;
    name?: string;
  },
): void {
  const name = options.name !== undefined ? options.name : "codexLocal";
  t.registerComponent(name, schema, options.modules);
}

export { schema };

export default {
  register,
  schema,
};
