import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";

export default [
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/convex/_generated/**",
      "packages/codex-local-component/src/component/_generated/**",
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
      "apps/examples/persistent-cli-app/src/**/*.{ts,tsx}",
      "apps/examples/persistent-cli-app/convex/**/*.{ts,tsx}",
      "apps/examples/cli-app/src/**/*.{ts,tsx}",
      "apps/examples/cli-app/convex/**/*.{ts,tsx}",
      "apps/examples/tauri-app/src/**/*.{ts,tsx}",
      "apps/examples/tauri-app/src-node/**/*.{ts,tsx}",
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
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/no-floating-promises": "error",
      "prefer-const": "error",
    },
  },
];
