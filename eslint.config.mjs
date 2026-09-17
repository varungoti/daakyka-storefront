import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated/vendored code, not linted:
    "src/generated/**",
    // Playwright artifacts and standalone Python/Node services, not part
    // of the Next.js app's lint surface:
    "dogfood-output/**",
    "services/**",
  ]),
]);

export default eslintConfig;
