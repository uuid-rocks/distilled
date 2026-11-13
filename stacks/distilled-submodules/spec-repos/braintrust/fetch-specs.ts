#!/usr/bin/env node
/**
 * Mirrors Braintrust's OpenAPI spec into ../specs/.
 *
 * Braintrust publishes its API description in braintrustdata/braintrust-openapi
 * as `openapi/spec.json` (the same document is also committed as YAML). Only
 * that one file is downloaded, straight from raw.githubusercontent.com — the
 * upstream repository is never cloned.
 *
 * Usage:
 *   node fetch-specs.ts
 *
 * Specs are saved to:
 *   ../specs/openapi.json
 */

import { mkdirSync } from "fs";
import { writeFile } from "fs/promises";

/** Upstream repository, as `<owner>/<repo>`. */
const REPO = "braintrustdata/braintrust-openapi";
/** Branch to mirror. */
const REF = "main";
/** Path within {@link REPO}. */
const PATH = "openapi/spec.json";

const SPECS_DIR = "../specs";

mkdirSync(SPECS_DIR, { recursive: true });

async function main() {
  const url = `https://raw.githubusercontent.com/${REPO}/${REF}/${PATH}`;
  console.log(`Fetching ${url}...`);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }
  const spec = (await response.json()) as { openapi?: unknown; paths?: unknown };
  if (typeof spec.openapi !== "string" || spec.paths === undefined) {
    throw new Error(`${url} is not an OpenAPI document`);
  }

  const outputPath = `${SPECS_DIR}/openapi.json`;
  console.log(`Writing ${outputPath}...`);
  await writeFile(outputPath, JSON.stringify(spec, null, 2) + "\n");

  console.log("Done!");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
