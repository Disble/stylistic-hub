import { defineConfig } from 'vitest/config'
// dharness:coverage-tiers-import begin — rewritten by `dharness sync`; edits here are lost.
import { fileURLToPath } from "node:url";
import { withCoverageTiers } from "./.dharness/coverage-tiers.mjs";
// dharness:coverage-tiers-import end

// dharness:coverage-tiers-export begin — rewritten by `dharness sync`; edits here are lost.
export default withCoverageTiers(
// dharness:coverage-tiers-input begin — the exported value below is dharness's input and is copied verbatim; the regions around it are rewritten by `dharness sync`.
defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}']
  }
})
// dharness:coverage-tiers-input end
, { repositoryRoot: fileURLToPath(new URL(".", import.meta.url)), sourceRoot: "." });
// dharness:coverage-tiers-export end

