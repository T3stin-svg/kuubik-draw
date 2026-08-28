#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const [sourceArg, destinationArg] = process.argv.slice(2);
if (!sourceArg || !destinationArg) {
  console.error("Usage: node import-parity-snapshot.mjs <source-manifest> <destination-manifest>");
  process.exit(2);
}
const expectedSha256 = "5e23d0073e2a65a1b37f3791107e2e9fb9741be99b115303a51896d46866e694";
const bytes = await readFile(resolve(sourceArg));
const actualSha256 = createHash("sha256").update(bytes).digest("hex");
if (actualSha256 !== expectedSha256) {
  throw new Error(`Parity source changed: expected ${expectedSha256}, got ${actualSha256}.`);
}
await writeFile(resolve(destinationArg), bytes);
console.log(`Imported immutable parity snapshot ${actualSha256}.`);
