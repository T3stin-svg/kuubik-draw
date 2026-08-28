#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const files = execFileSync("git", ["-C", root, "ls-files", "--cached", "--others", "--exclude-standard"], {
  encoding: "utf8",
})
  .split(/\r?\n/)
  .filter(Boolean)
  .map((path) => path.replaceAll("\\", "/"));

const blockedNames = /(^|\/)(\.env(?:\.|$)|credentials?|secrets?|service-account)(\/|$)/i;
const blockedCad = /\.(dwg|dwt|dws|dxf|pdf|fcstd|kdraw)$/i;
const syntheticCadAllowlist = new Set([
  "parity/fixtures/F-003-empty-mm.dxf",
  "evidence/artifacts/F-003-kuubik.dxf",
  "parity/fixtures/F-015-empty-mm.dxf",
  "evidence/artifacts/F-015-kuubik.dxf",
  "evidence/artifacts/F-015-browser-empty.dxf",
  "evidence/artifacts/F-015-browser-restored.dxf",
  "evidence/artifacts/F-015-browser-locked.dxf",
  "parity/fixtures/F-016-empty-mm.dxf",
  "evidence/artifacts/F-016-kuubik.dxf",
  "evidence/artifacts/F-016-browser-moved.dxf",
  "evidence/artifacts/F-016-browser-restored.dxf",
  "evidence/artifacts/F-016-browser-locked.dxf",
  "evidence/artifacts/F-016-standard-matrix.kdraw",
  "evidence/artifacts/F-017-kuubik.dxf",
  "evidence/artifacts/F-017-browser-copied.dxf",
  "evidence/artifacts/F-017-browser-restored.dxf",
  "evidence/artifacts/F-017-browser-locked.dxf",
  "evidence/artifacts/F-017-standard-matrix.kdraw",
  "evidence/artifacts/F-018-kuubik.dxf",
  "evidence/artifacts/F-018-browser-rotated.dxf",
  "evidence/artifacts/F-018-browser-restored.dxf",
  "evidence/artifacts/F-018-browser-locked.dxf",
  "evidence/artifacts/F-018-standard-matrix.kdraw",
  "evidence/artifacts/F-019-kuubik.dxf",
  "evidence/artifacts/F-019-browser-scaled.dxf",
  "evidence/artifacts/F-019-browser-restored.dxf",
  "evidence/artifacts/F-019-browser-locked.dxf",
  "evidence/artifacts/F-019-browser-copied.dxf",
  "evidence/artifacts/F-019-standard-matrix.kdraw",
  "evidence/artifacts/F-020-kuubik.dxf",
  "evidence/artifacts/F-020-browser-preserved.dxf",
  "evidence/artifacts/F-020-browser-erased-locked.dxf",
  "evidence/artifacts/F-020-standard-matrix.kdraw",
  "evidence/artifacts/F-021-kuubik.dxf",
  "evidence/artifacts/F-021-browser-distance-multiple.dxf",
  "evidence/artifacts/F-021-five-family.kdraw",
  "evidence/artifacts/F-021-edge-polylines.dxf",
  "evidence/artifacts/F-021-edge-matrix.kdraw",
  "evidence/artifacts/F-021-concave-refusal.kdraw",
]);
const textExtensions = new Set([".ts", ".tsx", ".js", ".mjs", ".json", ".md", ".yml", ".yaml", ".html", ".css", ".txt"]);
const secretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /(?:SUPABASE_SERVICE_ROLE_KEY|AWS_SECRET_ACCESS_KEY|GITHUB_TOKEN)\s*[:=]\s*["']?[A-Za-z0-9_\-/.+=]{12,}/i,
  /\b(?:sk_live_|ghp_|github_pat_)[A-Za-z0-9_\-]{16,}\b/,
];

const failures = [];
for (const path of files) {
  if (blockedNames.test(path)) failures.push(`${path}: blocked sensitive filename`);
  if (blockedCad.test(path) && !syntheticCadAllowlist.has(path) && !path.startsWith("packages/cad-dxf/test/fixtures/synthetic/")) {
    failures.push(`${path}: CAD/PDF artifacts require an explicit synthetic-fixture allowlist`);
  }
  if (!textExtensions.has(extname(path).toLowerCase())) continue;
  const text = await readFile(resolve(root, path), "utf8");
  if (secretPatterns.some((pattern) => pattern.test(text))) failures.push(`${path}: possible secret material`);
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log(`Public-tree scan PASS (${files.length} files, no blocked artifacts or secret patterns).`);
