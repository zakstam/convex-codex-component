import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";

export default [
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/convex/_generated/**",
      "**/submodules/**",
      "**/src-tauri/**",
      "**/target/**",
      "**/bundle/**",
      "**/tauri-codegen-assets/**",
      "**/dist-node/**",
      "**/coverage/**",
    ],
  },
  {
    files: [
      "apps/release-smoke-host/src/**/*.{ts,tsx}",
      "apps/release-smoke-host/convex/**/*.{ts,tsx}",
      "apps/examples/persistent-cli-app/src/**/*.{ts,tsx}",
      "apps/examples/persistent-cli-app/convex/**/*.{ts,tsx}",
      "apps/examples/cli-app/src/**/*.{ts,tsx}",
      "apps/examples/cli-app/convex/**/*.{ts,tsx}",
      "apps/examples/tauri-app/src/**/*.{ts,tsx}",
      "apps/examples/tauri-app/convex/**/*.{ts,tsx}",
      "packages/codex-local-component/src/**/*.{ts,tsx}",
    ],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        projectService: true,
        allowDefaultProject: true,
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
