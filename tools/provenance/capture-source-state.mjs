#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

const [sourceArg, outputArg] = process.argv.slice(2);
if (!sourceArg || !outputArg) {
  console.error("Usage: node capture-source-state.mjs <source-repo> <output.json>");
  process.exit(2);
}

const source = resolve(sourceArg);
const output = resolve(outputArg);
const git = (...args) =>
  execFileSync("git", ["-C", source, ...args], { encoding: "utf8" }).trim();

const allowed = [
  /^parity\//,
  /^web\/(src|tests|scripts)\//,
  /^web\/package(?:-lock)?\.json$/,
  /^KUUBIK_DRAW_PLAN\.md$/,
];
const forbidden = /(^|\/)(\.env(?:\.|$)|node_modules|tmp|coverage|dist)(\/|$)|\.(dwg|dwt|pdf|png|jpe?g)$/i;
const changed = git("ls-files", "-m", "-o", "--exclude-standard")
  .split(/\r?\n/)
  .map((value) => value.replaceAll("\\", "/"))
  .filter(Boolean)
  .filter((path) => allowed.some((pattern) => pattern.test(path)) && !forbidden.test(path))
  .sort((a, b) => a.localeCompare(b));

const files = [];
for (const path of changed) {
  const absolute = resolve(source, path);
  if (!absolute.startsWith(`${source}\\`) && absolute !== source) {
    throw new Error(`Path escaped source repository: ${path}`);
  }
  const info = await stat(absolute);
  if (!info.isFile()) continue;
  const bytes = await readFile(absolute);
  files.push({
    path,
    byteLength: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
}

const manifest = {
  schemaVersion: 1,
  sourceRepository: basename(source),
  sourceHead: git("rev-parse", "HEAD"),
  sourceBranch: git("branch", "--show-current"),
  capturedAt: new Date().toISOString(),
  scope: "Modified and untracked Draw/parity source paths only; hashes and names, never file contents.",
  files,
};

await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`Captured ${files.length} allowlisted paths from ${basename(source)}.`);
