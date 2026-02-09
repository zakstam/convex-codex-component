import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";

export default [
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/convex/_generated/**",
    ],
  },
  {
    files: [
      "apps/release-smoke-host/src/**/*.ts",
      "apps/release-smoke-host/convex/**/*.ts",
      "apps/examples/persistent-cli-app/src/**/*.ts",
      "apps/examples/cli-app/src/**/*.ts",
    ],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        projectService: true,
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unnecessary-type-assertion": "error",
    },
  },
];
