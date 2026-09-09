import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/node_modules/**", "**/.turbo/**", "**/.cache/**", ".claude/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    // Plain-JS node scripts (not covered by the TS parser's globals). The
    // playtest harness is one too: node on the outside, a page on the inside.
    files: ["**/scripts/**/*.mjs", "**/playtest/**/*.mjs"],
    languageOptions: {
      globals: {
        process: "readonly",
        console: "readonly",
        fetch: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        URL: "readonly",
        Buffer: "readonly",
        // Evaluated inside a Playwright page, not in node — the icon and card
        // export scripts both drive a browser.
        document: "readonly",
        getComputedStyle: "readonly",
      },
    },
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": "error",
    },
  },
);
