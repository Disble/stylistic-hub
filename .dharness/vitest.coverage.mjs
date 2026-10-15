// Managed by dharness. Do not edit: the next `dharness sync` writes this file
// again from the binary it ships in.
//
// The gate runs the project's own Vitest against this entry rather than against
// vitest.config.ts directly. This file is a bridge and nothing else: it
// re-exports that config's own default, and it refuses to load when the config
// never gained the managed regions. That refusal is the point: a gate pointed
// straight at an unwired config would run coverage with nothing to enforce and
// exit 0. The tiers belong to coverage-tiers.mjs, resolved from the project's own coverage-tiers.json; nothing is classified,
// merged or evaluated here.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import consumerConfig from "../vitest.config.ts";

const consumerPath = fileURLToPath(new URL("../vitest.config.ts", import.meta.url));
const consumerSource = readFileSync(consumerPath, "utf8");

const missing = [
  "// dharness:coverage-tiers-import begin — rewritten by `dharness sync`; edits here are lost.",
  "// dharness:coverage-tiers-export begin — rewritten by `dharness sync`; edits here are lost.",
  "// dharness:coverage-tiers-input begin — the exported value below is dharness's input and is copied verbatim; the regions around it are rewritten by `dharness sync`.",
].filter((marker) => !consumerSource.includes(marker));

if (missing.length > 0) {
  throw new Error(
    "coverage tiers: " + consumerPath + " does not carry the managed regions (" + missing.join(", ")
      + "), so this run would measure nothing the declared tiers require; run `dharness sync` to wire it",
  );
}

export default consumerConfig;
