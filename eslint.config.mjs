// Flat-config ESLint for RollForge. See issue #21 for scope — we use
// the @typescript-eslint recommended ruleset as a baseline, then relax
// a few rules that don't make sense for a Discord bot codebase with
// mock-heavy tests and intentional `any` at the Discord interaction
// boundary.
//
// Prettier handles formatting; `eslint-config-prettier` turns off every
// ESLint rule that would conflict with it so the two don't fight.

import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";
import prettierConfig from "eslint-config-prettier";

// Base-JS-only rules — safe to apply to the .mjs scripts block.
const baseRules = {
  "no-unused-vars": [
    "error",
    {
      argsIgnorePattern: "^_",
      varsIgnorePattern: "^_",
      caughtErrorsIgnorePattern: "^_",
    },
  ],
  "no-empty": ["error", { allowEmptyCatch: true }],
  "prefer-const": "warn",
};

// TypeScript-specific rule overrides. These depend on the
// @typescript-eslint plugin being in scope, so they're only applied
// inside the TS config object below.
const tsRules = {
  // Turn the base rule off in favor of the TS-aware version.
  "no-unused-vars": "off",
  "@typescript-eslint/no-unused-vars": [
    "error",
    {
      argsIgnorePattern: "^_",
      varsIgnorePattern: "^_",
      caughtErrorsIgnorePattern: "^_",
      ignoreRestSiblings: true,
    },
  ],

  // Discord.js, Mongoose lean results, and OpenAI SDK responses all
  // come back as `any` at the boundary. Blanket-banning it fights the
  // codebase; legitimate boundary uses should not fail the build.
  "@typescript-eslint/no-explicit-any": "off",

  // The test suite uses `expect(...).toBe()` heavily; off globally.
  "@typescript-eslint/no-unused-expressions": "off",

  // Keep the base empty/prefer-const rules too.
  "no-empty": ["error", { allowEmptyCatch: true }],
  "prefer-const": "warn",
};

export default [
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "corpus/**",
      "dump/**",
      "migrations/**",
      "infra/**",
    ],
  },
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
    },
    plugins: {
      "@typescript-eslint": tseslint,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      ...tsRules,
    },
  },
  {
    // Test files — allow `any` freely and skip the unused-expression
    // rule even when turned on globally.
    files: ["src/**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-expressions": "off",
    },
  },
  {
    // .mjs scripts at the repo root — plain JS, no TS plugin.
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
    },
    rules: {
      ...baseRules,
    },
  },
  // eslint-config-prettier MUST come last — it disables every rule
  // that would conflict with Prettier's formatting.
  prettierConfig,
];
