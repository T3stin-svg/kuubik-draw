#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const required = [
  "LICENSE",
  "LICENSES/GPL-2.0-only.txt",
  "LICENSES/LGPL-2.1-or-later.txt",
  "LICENSES/MIT.txt",
  "RIGHTS.md",
  "THIRD_PARTY_NOTICES.md",
  "upstream-provenance.json",
];

for (const file of required) await access(resolve(root, file));
const provenance = JSON.parse(await readFile(resolve(root, "upstream-provenance.json"), "utf8"));
if (provenance.schemaVersion !== 1 || !Array.isArray(provenance.entries)) {
  throw new Error("Invalid upstream-provenance.json.");
}
for (const [index, entry] of provenance.entries.entries()) {
  for (const key of ["project", "repository", "commit", "license", "adoption", "localModule"]) {
    if (typeof entry[key] !== "string" || entry[key].length === 0) {
      throw new Error(`Provenance entry ${index} is missing ${key}.`);
    }
  }
  if (entry.adoption === "port") {
    for (const key of ["sourcePath", "sourceSha256"]) {
      if (typeof entry[key] !== "string" || entry[key].length === 0) {
        throw new Error(`Port entry ${index} is missing ${key}.`);
      }
    }
  }
}

const npmCli = process.env.npm_execpath ?? resolve(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js");
const installed = JSON.parse(
  execFileSync(process.execPath, [npmCli, "query", "*", "--json"], {
    cwd: root,
    encoding: "utf8",
    timeout: 30_000,
    windowsHide: true,
  }),
);
const allowedLicenses = new Set([
  "GPL-2.0-only",
  "MIT",
  "ISC",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "Apache-2.0",
  "CC-BY-4.0",
  "CC0-1.0",
  "0BSD",
]);
const violations = installed
  .filter((entry) => typeof entry.name === "string")
  .filter((entry) => typeof entry.license !== "string" || !allowedLicenses.has(entry.license))
  .map((entry) => `${entry.name}@${entry.version ?? "unknown"}: ${entry.license ?? "MISSING"}`);
if (violations.length > 0) {
  throw new Error(`Unapproved dependency licenses:\n${violations.join("\n")}`);
}
console.log(
  `License gate PASS (${required.length} files, ${provenance.entries.length} provenance entries, ${installed.length} installed packages audited).`,
);
