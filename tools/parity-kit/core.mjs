import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, readFile, readdir } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { parityManifest } from "../../parity/autocad-2024-2d.manifest.mjs";
import { CERTIFICATION_SOURCE_ROOTS, PARITY_ROWS, RUNTIME_SOURCE_ROOTS, SOURCE_GROUPS, UNCERTIFIED_SOURCE_ROWS } from "../../parity/rows.mjs";

export const REPO_ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
export const PARITY_STAGE_ORDER = Object.freeze(["browser", "readback", "oracle", "autocad", "cross"]);
export const GLOBAL_TOPOLOGY_RECEIPT_PATH = "evidence/artifacts/parity-global-topology.json";
export const PACKAGE_SEMANTIC_MIGRATION_PATH = "evidence/artifacts/parity-package-v3-to-v4.json";
export const PACKAGE_SEMANTIC_MIGRATION_BASE = "46d827801a7aebc7070143ff36435f355df6252b";
export const PACKAGE_SEMANTIC_MIGRATION_BASE_MANIFEST_SHA256 = "7f69dcae5325e072849411c5aed4034bb18d4ce0525dd3c4e3d8bc9fe3f185ef";
export const PACKAGE_WORKSPACE_MANIFEST_PATHS = Object.freeze([
  "apps/web/package.json",
  "packages/cad-core/package.json",
  "packages/cad-renderer/package.json",
  "packages/cad-dxf/package.json",
  "packages/cad-print/package.json",
]);
export const GLOBAL_TOPOLOGY_SOURCE_PATHS = Object.freeze([
  ".github/workflows/ci.yml",
  "package.json",
  "package-lock.json",
  ...PACKAGE_WORKSPACE_MANIFEST_PATHS,
  PACKAGE_SEMANTIC_MIGRATION_PATH,
  "parity/rows.mjs",
  "tools/parity-kit/core.mjs",
  "tools/parity-kit/cli.mjs",
]);

const PACKAGE_MIGRATION_GLOBAL_SCRIPT_CHANGES = Object.freeze(["parity:check", "test:mutation"]);
const PACKAGE_MIGRATION_ROW_SPECS = Object.freeze([
  Object.freeze({ id: "F-023", stages: Object.freeze({
    browser: "parity:f023:browser-artifact",
    readback: "parity:f023:readback",
    oracle: "parity:f023:oracles",
    autocad: "parity:f023:autocad",
    cross: "parity:f023:cross-evidence",
  }) }),
  Object.freeze({ id: "F-024", stages: Object.freeze({
    browser: "parity:f024:browser-artifact",
    readback: "parity:f024:readback",
    oracle: "parity:f024:oracles",
    autocad: "parity:f024:autocad",
    cross: "parity:f024:cross-evidence",
  }) }),
]);
const PREVIOUS_SCHEMA_PIN = "https://github.com/T3stin-svg/kuubik-cad-schema/archive/5eab9934aec937b679f0614382b8f947d3f21e8e.tar.gz";
const CURRENT_SCHEMA_PIN = "https://github.com/T3stin-svg/kuubik-cad-schema/archive/b9964e0991884151784d1b262ded8c5c14706d9c.tar.gz";
const CURRENT_SCHEMA_INTEGRITY = "sha512-tRBLFC3Bh5+Hul4c5mfVgng4cFEWy02xTveQf6VJ4m0Xkir8AVrMlGlXqzazQeB9EnYgvWXFc3uxCEEALdmwzQ==";
const YAML_PARSER_VERSION = "2.9.0";
const YAML_PARSER_LOCK_ENTRY = Object.freeze({
  version: YAML_PARSER_VERSION,
  resolved: "https://registry.npmjs.org/yaml/-/yaml-2.9.0.tgz",
  integrity: "sha512-2AvhNX3mb8zd6Zy7INTtSpl1F15HW6Wnqj0srWlkKLcpYl/gMIMJiyuGq2KeI2YFxUPjdlB+3Lc10seMLtL4cA==",
  dev: true,
  license: "ISC",
  bin: { yaml: "bin.mjs" },
  engines: { node: ">= 14.6" },
  funding: { url: "https://github.com/sponsors/eemeli" },
});

export function normalizeRepoPath(path) {
  return path.replaceAll("\\", "/").replace(/^\.\//u, "");
}

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function sourceContentAddress(bytes) {
  return sha256(Buffer.from(bytes.toString("utf8").replace(/\r\n?/gu, "\n"), "utf8"));
}

export function checkoutStepsUseFullHistory(ciText) {
  const lines = ciText.split(/\r?\n/u);
  const stepStarts = new Set();
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trimStart().startsWith("#") || !/^\s*(?:-\s*)?uses:\s*["']?actions\/checkout@/u.test(line)) continue;
    const inlineStep = /^(\s*)-\s*uses:/u.exec(line);
    if (inlineStep) {
      stepStarts.add(index);
      continue;
    }
    const usesIndent = line.length - line.trimStart().length;
    let owner = -1;
    for (let previous = index - 1; previous >= 0; previous -= 1) {
      const step = /^(\s*)-\s+/u.exec(lines[previous]);
      if (step && step[1].length < usesIndent) {
        owner = previous;
        break;
      }
    }
    if (owner < 0) return false;
    stepStarts.add(owner);
  }
  if (stepStarts.size === 0) return false;
  return [...stepStarts].every((start) => {
    const stepIndent = lines[start].length - lines[start].trimStart().length;
    let end = lines.length;
    for (let index = start + 1; index < lines.length; index += 1) {
      const nextStep = /^(\s*)-\s+/u.exec(lines[index]);
      if (nextStep && nextStep[1].length <= stepIndent) {
        end = index;
        break;
      }
    }
    for (let index = start + 1; index < end; index += 1) {
      const withMatch = /^(\s*)with:\s*(?:#.*)?$/u.exec(lines[index]);
      if (!withMatch || withMatch[1].length <= stepIndent) continue;
      const withIndent = withMatch[1].length;
      for (let child = index + 1; child < end; child += 1) {
        const trimmed = lines[child].trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const childIndent = lines[child].length - lines[child].trimStart().length;
        if (childIndent <= withIndent) break;
        if (/^fetch-depth:\s*(?:0|["']0["'])\s*(?:#.*)?$/u.test(trimmed)) return true;
      }
      return false;
    }
    return false;
  });
}

export function workflowJobContainsOrderedRuns(ciText, jobId, commands) {
  let workflow;
  try { workflow = parseYaml(ciText, { maxAliasCount: 0, merge: false, uniqueKeys: true }); }
  catch { return false; }
  const steps = workflow?.jobs?.[jobId]?.steps;
  if (!Array.isArray(steps)) return false;
  const jobRuns = steps.map((step) => step?.run).filter((command) => typeof command === "string");
  let cursor = -1;
  return commands.every((command) => {
    cursor = jobRuns.indexOf(command, cursor + 1);
    return cursor >= 0;
  });
}

function countExactString(value, expected) {
  if (value === expected) return 1;
  if (Array.isArray(value)) return value.reduce((count, item) => count + countExactString(item, expected), 0);
  if (value && typeof value === "object") return Object.values(value).reduce((count, item) => count + countExactString(item, expected), 0);
  return 0;
}

function replaceExactString(value, from, to) {
  if (value === from) return to;
  if (Array.isArray(value)) return value.map((item) => replaceExactString(item, from, to));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceExactString(item, from, to)]));
  return value;
}

export function exactSchemaPinMigration(previous, current, { lockfile = false } = {}) {
  const previousCount = countExactString(previous, PREVIOUS_SCHEMA_PIN);
  const currentCount = countExactString(current, CURRENT_SCHEMA_PIN);
  if (previousCount === 0 || currentCount !== previousCount || countExactString(current, PREVIOUS_SCHEMA_PIN) !== 0) return false;
  const normalized = replaceExactString(current, CURRENT_SCHEMA_PIN, PREVIOUS_SCHEMA_PIN);
  if (lockfile) {
    const previousSchemaPackage = previous?.packages?.["node_modules/@kuubik/cad-schema"];
    const currentSchemaPackage = current?.packages?.["node_modules/@kuubik/cad-schema"];
    if (previousSchemaPackage?.integrity !== undefined || currentSchemaPackage?.integrity !== CURRENT_SCHEMA_INTEGRITY) return false;
    delete normalized.packages["node_modules/@kuubik/cad-schema"].integrity;
  }
  return canonicalJson(normalized) === canonicalJson(previous);
}

export function exactYamlParserAddition(previous, current, { lockfile = false } = {}) {
  const previousRoot = lockfile ? previous?.packages?.[""] : previous;
  const currentRoot = lockfile ? current?.packages?.[""] : current;
  if (previousRoot?.devDependencies?.yaml !== undefined || currentRoot?.devDependencies?.yaml !== YAML_PARSER_VERSION) return false;
  if (lockfile) {
    if (previous?.packages?.["node_modules/yaml"] !== undefined) return false;
    if (canonicalJson(current?.packages?.["node_modules/yaml"]) !== canonicalJson(YAML_PARSER_LOCK_ENTRY)) return false;
  }
  const normalized = structuredClone(current);
  const normalizedRoot = lockfile ? normalized.packages[""] : normalized;
  delete normalizedRoot.devDependencies.yaml;
  if (lockfile) delete normalized.packages["node_modules/yaml"];
  return canonicalJson(normalized) === canonicalJson(previous);
}

export function exactSchemaAndYamlParserMigration(previous, current) {
  if (previous?.packages?.["node_modules/yaml"] !== undefined || current?.packages?.["node_modules/yaml"] === undefined) return false;
  const withoutYaml = structuredClone(current);
  if (withoutYaml.packages?.[""]?.devDependencies?.yaml !== YAML_PARSER_VERSION) return false;
  if (canonicalJson(withoutYaml.packages["node_modules/yaml"]) !== canonicalJson(YAML_PARSER_LOCK_ENTRY)) return false;
  delete withoutYaml.packages[""].devDependencies.yaml;
  delete withoutYaml.packages["node_modules/yaml"];
  return exactSchemaPinMigration(previous, withoutYaml, { lockfile: true });
}

function packageSurface(packageJson) {
  const { scripts: _scripts, ...surface } = packageJson;
  return surface;
}

function referencedPackageScripts(command) {
  if (typeof command !== "string") return [];
  return [...command.matchAll(/\bnpm(?:\.cmd)?\s+run(?:-script)?\s+([A-Za-z0-9:_-]+)/gu)]
    .map((match) => match[1]);
}

function packageScriptClosure(packageJson, rootScript) {
  const scripts = packageJson.scripts ?? {};
  const pending = [rootScript];
  const visited = new Set();
  const closure = {};
  while (pending.length) {
    const script = pending.shift();
    if (!script || visited.has(script)) continue;
    visited.add(script);
    const command = scripts[script] ?? null;
    closure[script] = command;
    for (const referenced of referencedPackageScripts(command)) pending.push(referenced);
  }
  return Object.fromEntries(Object.entries(closure).sort(([left], [right]) => compareCodePoints(left, right)));
}

export function packageContractForRow(packageJson, row) {
  const stages = Object.fromEntries(Object.entries(row.stages ?? {}).map(([stage, rootScript]) => [stage, {
    rootScript,
    closureSha256: sha256(Buffer.from(canonicalJson(packageScriptClosure(packageJson, rootScript)), "utf8")),
  }]));
  return {
    schemaVersion: 1,
    packageSurfaceSha256: sha256(Buffer.from(canonicalJson(packageSurface(packageJson)), "utf8")),
    stages,
  };
}

export function exactContentAddress(bytes, path = "") {
  return path.toLowerCase().endsWith(".json") ? sourceContentAddress(bytes) : sha256(bytes);
}

const volatileTimeKeys = new Set([
  "capturedAt",
  "checkedAt",
  "createdAt",
  "endedAt",
  "generatedAt",
  "observedAt",
  "scannedAt",
  "sourceObservedAt",
  "startedAt",
  "updatedAt",
]);
const volatileProvenanceHashKeys = new Set([
  "artifactSha256",
  "browserEvidenceSha256",
  "implementationSha256",
  "matrixScriptSha256",
  "runnerScriptSha256",
  "scriptSha256",
  "sourceSha256",
]);

function compareCodePoints(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function semanticValue(value) {
  if (Array.isArray(value)) return value.map(semanticValue);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !volatileTimeKeys.has(key) && !volatileProvenanceHashKeys.has(key))
    .sort(([left], [right]) => compareCodePoints(left, right))
    .map(([key, entry]) => [key, semanticValue(entry)]));
}

function gitFileList(args) {
  const output = execFileSync("git", args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return output.split(/\r?\n/u).map(normalizeRepoPath).filter(Boolean);
}

export function changedFiles(base) {
  const files = new Set();
  if (base) gitFileList(["diff", "--name-only", "--diff-filter=ACMRDT", `${base}...HEAD`]).forEach((file) => files.add(file));
  gitFileList(["diff", "--name-only", "--diff-filter=ACMRDT", "HEAD"]).forEach((file) => files.add(file));
  gitFileList(["ls-files", "--others", "--exclude-standard"]).forEach((file) => files.add(file));
  return [...files].sort();
}

export function canonicalJson(value) {
  return JSON.stringify(semanticValue(value));
}

export function semanticContentAddress(bytes, path = "") {
  const lowerPath = path.toLowerCase();
  if (lowerPath.endsWith(".kdraw") || bytes.subarray(0, 7).toString("utf8") === "KDRAW1\n") {
    const envelope = JSON.parse(bytes.subarray(7).toString("utf8"));
    const fileAddresses = Object.entries(envelope.files ?? {}).map(([filePath, encoded]) => {
      const fileBytes = Buffer.from(encoded, "base64");
      return [filePath, semanticContentAddress(fileBytes, filePath)];
    }).sort(([left], [right]) => compareCodePoints(left, right));
    return sha256(Buffer.from(canonicalJson({ container: "KDRAW1", files: fileAddresses }), "utf8"));
  }
  if (lowerPath.endsWith(".json")) {
    return sha256(Buffer.from(canonicalJson(JSON.parse(bytes.toString("utf8"))), "utf8"));
  }
  return sha256(bytes);
}

export function expandRowSources(row) {
  const inferred = repositoryFiles().filter((file) =>
    CERTIFICATION_SOURCE_ROOTS.some((root) => file.startsWith(`${root}/`)) && inferredRowIds(file).includes(row.id));
  return [...new Set([...row.sourceGroups.flatMap((group) => SOURCE_GROUPS[group] ?? []), ...inferred])].sort();
}

let cachedRepositoryFiles;
function repositoryFiles() {
  if (!cachedRepositoryFiles) {
    cachedRepositoryFiles = [...new Set([
      ...gitFileList(["ls-files"]),
      ...gitFileList(["ls-files", "--others", "--exclude-standard"]),
    ])].sort();
  }
  return cachedRepositoryFiles;
}

function isAuditRowId(rowId) {
  return /^F-(?:0(?:0[1-9]|[1-9]\d)|1(?:[0-2]\d|3[0-3]))$/u.test(rowId);
}

export function inferredRowIds(file) {
  const ids = [...normalizeRepoPath(file).matchAll(/f-?(\d{3})/giu)]
    .map((match) => `F-${match[1]}`)
    .filter(isAuditRowId);
  return [...new Set(ids)].sort();
}

export function executableStages(row, { portable = false } = {}) {
  return PARITY_STAGE_ORDER.flatMap((stage) => {
    const script = row.stages?.[stage];
    if (!script || (portable && (stage === "oracle" || stage === "autocad"))) return [];
    return [{ stage, script }];
  });
}

export function sourceToRows() {
  const graph = new Map();
  for (const row of PARITY_ROWS) {
    for (const source of expandRowSources(row)) {
      const normalized = normalizeRepoPath(source);
      const rows = graph.get(normalized) ?? [];
      rows.push(row.id);
      graph.set(normalized, rows);
    }
  }
  for (const [source, rowIds] of Object.entries(UNCERTIFIED_SOURCE_ROWS)) {
    const normalized = normalizeRepoPath(source);
    const rows = graph.get(normalized) ?? [];
    rows.push(...rowIds);
    graph.set(normalized, rows);
  }
  return new Map([...graph].map(([source, rows]) => [source, [...new Set(rows)].sort()]));
}

export function affectedRows(files) {
  const graph = sourceToRows();
  const allRows = PARITY_ROWS.map((row) => row.id);
  const globalFiles = new Set([
    "package.json",
    "package-lock.json",
    "parity/rows.mjs",
    "tools/parity-kit/core.mjs",
    "tools/parity-kit/cli.mjs",
    ".github/workflows/ci.yml",
  ]);
  const affected = new Set();
  const unmappedRuntime = [];
  for (const rawFile of files) {
    const file = normalizeRepoPath(rawFile);
    if (!file) continue;
    if (globalFiles.has(file)) {
      allRows.forEach((rowId) => affected.add(rowId));
      continue;
    }
    const rows = graph.get(file);
    rows?.forEach((rowId) => affected.add(rowId));
    inferredRowIds(file).forEach((rowId) => affected.add(rowId));
    const isUnmappedRuntime = !rows && inferredRowIds(file).length === 0 &&
      RUNTIME_SOURCE_ROOTS.some((root) => file.startsWith(`${root}/`)) && !/\.test\.[cm]?[jt]sx?$/u.test(file);
    const isUnmappedCertification = !rows && inferredRowIds(file).length === 0 &&
      CERTIFICATION_SOURCE_ROOTS.some((root) => file.startsWith(`${root}/`));
    if (isUnmappedRuntime || isUnmappedCertification) {
      unmappedRuntime.push(file);
    }
  }
  return { rows: [...affected].sort(), unmappedRuntime: [...new Set(unmappedRuntime)].sort() };
}

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(path));
    else files.push(path);
  }
  return files;
}

export async function runtimeSources() {
  const files = [];
  for (const root of RUNTIME_SOURCE_ROOTS) {
    files.push(...await listFiles(resolve(REPO_ROOT, root)));
  }
  return files
    .map((path) => normalizeRepoPath(relative(REPO_ROOT, path)))
    .filter((path) => !/\.test\.[cm]?[jt]sx?$/u.test(path))
    .sort();
}

export async function buildContentAddressManifest() {
  const packageJson = JSON.parse(await readFile(resolve(REPO_ROOT, "package.json"), "utf8"));
  const rows = [];
  for (const row of PARITY_ROWS) {
    const sources = Object.fromEntries(await Promise.all(expandRowSources(row).map(async (sourcePath) => {
      const sourceBytes = await readFile(resolve(REPO_ROOT, sourcePath));
      return [sourcePath, sourcePath === "package.json"
        ? packageContractForRow(packageJson, row)
        : sourceContentAddress(sourceBytes)];
    })));
    const evidence = {};
    for (const [kind, descriptorPath] of Object.entries(row.evidence)) {
      const descriptorBytes = await readFile(resolve(REPO_ROOT, descriptorPath));
      const descriptor = JSON.parse(descriptorBytes.toString("utf8"));
      const artifactPath = normalizeRepoPath(descriptor.artifact);
      const artifactBytes = await readFile(resolve(REPO_ROOT, artifactPath));
      evidence[kind] = {
        descriptorPath,
        descriptorSha256: exactContentAddress(descriptorBytes, descriptorPath),
        descriptorContentSha256: semanticContentAddress(descriptorBytes, descriptorPath),
        artifactPath,
        artifactSha256: exactContentAddress(artifactBytes, artifactPath),
        artifactContentSha256: semanticContentAddress(artifactBytes, artifactPath),
      };
    }
    const receipts = {};
    for (const receipt of row.receipts ?? []) {
      const receiptBytes = await readFile(resolve(REPO_ROOT, receipt.path));
      receipts[receipt.kind] = {
        path: receipt.path,
        sha256: exactContentAddress(receiptBytes, receipt.path),
        contentSha256: semanticContentAddress(receiptBytes, receipt.path),
      };
    }
    rows.push({ rowId: row.id, sources, evidence, receipts });
  }
  return { schemaVersion: 4, normalization: "row-scoped package stage closures plus package surface; canonical-json-without-allowlisted-time-or-provenance-hashes; canonical-LF sources and exact JSON evidence; KDRAW1 semantic file addresses; other binaries exact", rows };
}

function gitObjectBytes(revision, path) {
  return execFileSync("git", ["show", `${revision}:${path}`], {
    cwd: REPO_ROOT,
    encoding: null,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

export async function buildPackageSemanticMigrationReceipt(observedAt = new Date().toISOString()) {
  const [currentPackageBytes, currentLockBytes] = await Promise.all([
    readFile(resolve(REPO_ROOT, "package.json")),
    readFile(resolve(REPO_ROOT, "package-lock.json")),
  ]);
  const previousPackageBytes = gitObjectBytes(PACKAGE_SEMANTIC_MIGRATION_BASE, "package.json");
  const previousLockBytes = gitObjectBytes(PACKAGE_SEMANTIC_MIGRATION_BASE, "package-lock.json");
  const baseManifestBytes = gitObjectBytes(PACKAGE_SEMANTIC_MIGRATION_BASE, "parity/content-addresses.json");
  const [previousWorkspacePackages, currentWorkspacePackages] = await Promise.all([
    Promise.all(PACKAGE_WORKSPACE_MANIFEST_PATHS.map(async (path) => [path, gitObjectBytes(PACKAGE_SEMANTIC_MIGRATION_BASE, path)])),
    Promise.all(PACKAGE_WORKSPACE_MANIFEST_PATHS.map(async (path) => [path, await readFile(resolve(REPO_ROOT, path))])),
  ]);
  const previousPackage = JSON.parse(previousPackageBytes.toString("utf8"));
  const currentPackage = JSON.parse(currentPackageBytes.toString("utf8"));
  const allScriptNames = [...new Set([
    ...Object.keys(previousPackage.scripts ?? {}),
    ...Object.keys(currentPackage.scripts ?? {}),
  ])].sort(compareCodePoints);
  const changedScripts = allScriptNames.filter((name) => previousPackage.scripts?.[name] !== currentPackage.scripts?.[name]);
  const stageChanges = [];
  for (const row of PACKAGE_MIGRATION_ROW_SPECS) {
    for (const [stage, rootScript] of Object.entries(row.stages ?? {})) {
      const before = packageScriptClosure(previousPackage, rootScript);
      const after = packageScriptClosure(currentPackage, rootScript);
      if (JSON.stringify(before) !== JSON.stringify(after)) {
        stageChanges.push({ rowId: row.id, stage, rootScript, before, after });
      }
    }
  }
  const changedStageRows = [...new Set(stageChanges.map((change) => change.rowId))].sort(compareCodePoints);
  const changedStageScripts = new Set(stageChanges.flatMap((change) => [
    change.rootScript,
    ...Object.keys(change.before),
    ...Object.keys(change.after),
  ]));
  for (const rowId of changedStageRows) {
    const rowPrefix = `parity:${rowId.toLowerCase().replace("-", "")}:`;
    for (const script of changedScripts) if (script.startsWith(rowPrefix)) changedStageScripts.add(script);
  }
  const globalOnlyScriptChanges = changedScripts.filter((name) => !changedStageScripts.has(name));
  const workspacePackageSha256 = Object.fromEntries(PACKAGE_WORKSPACE_MANIFEST_PATHS.map((path) => {
    const previous = previousWorkspacePackages.find(([candidate]) => candidate === path)?.[1];
    const current = currentWorkspacePackages.find(([candidate]) => candidate === path)?.[1];
    return [path, { previous: sourceContentAddress(previous), current: sourceContentAddress(current) }];
  }));
  const baseManifest = JSON.parse(baseManifestBytes.toString("utf8"));
  const currentManifest = await buildContentAddressManifest();
  const nonPackageCompatibilityErrors = staleEvidenceBindings(baseManifest, currentManifest, {
    allowV3ToV4: true,
    ignoredSourcePaths: ["package.json", "package-lock.json", ...PACKAGE_WORKSPACE_MANIFEST_PATHS],
  });
  const previousLock = JSON.parse(previousLockBytes.toString("utf8"));
  const currentLock = JSON.parse(currentLockBytes.toString("utf8"));
  const checks = {
    packageLockOnlySchemaPinAndYamlParserMigration: exactSchemaAndYamlParserMigration(previousLock, currentLock),
    packageSurfaceOnlyYamlParserAdded: exactYamlParserAddition(packageSurface(previousPackage), packageSurface(currentPackage)),
    workspacePackageManifestsOnlySchemaPinMigration: PACKAGE_WORKSPACE_MANIFEST_PATHS.every((path) => {
      const previous = previousWorkspacePackages.find(([candidate]) => candidate === path)?.[1];
      const current = currentWorkspacePackages.find(([candidate]) => candidate === path)?.[1];
      return exactSchemaPinMigration(JSON.parse(previous.toString("utf8")), JSON.parse(current.toString("utf8")));
    }),
    baseContentAddressManifestPinned: sha256(baseManifestBytes) === PACKAGE_SEMANTIC_MIGRATION_BASE_MANIFEST_SHA256
      && baseManifest.schemaVersion === 3 && baseManifest.rows?.length === 23,
    nonPackageEvidenceBindingsCurrent: nonPackageCompatibilityErrors.length === 0,
    onlyF023AndF024StageCommandsAdded: JSON.stringify(changedStageRows) === JSON.stringify(["F-023", "F-024"]) &&
      stageChanges.every((change) => Object.values(change.before).every((command) => command === null)),
    onlyKnownGlobalGateScriptsChanged: JSON.stringify(globalOnlyScriptChanges) === JSON.stringify(PACKAGE_MIGRATION_GLOBAL_SCRIPT_CHANGES),
  };
  if (Object.values(checks).some((value) => value !== true)) {
    throw new Error(`Package semantic migration failed: ${JSON.stringify({ checks, changedScripts, changedStageRows, globalOnlyScriptChanges })}`);
  }
  return {
    schemaVersion: 1,
    kind: "content-address-v3-to-v4-package-semantics",
    observedAt,
    baseCommit: PACKAGE_SEMANTIC_MIGRATION_BASE,
    sourceSha256: {
      previousPackage: sourceContentAddress(previousPackageBytes),
      currentPackage: sourceContentAddress(currentPackageBytes),
      previousPackageLock: sourceContentAddress(previousLockBytes),
      currentPackageLock: sourceContentAddress(currentLockBytes),
      baseContentAddressManifest: sha256(baseManifestBytes),
      workspacePackages: workspacePackageSha256,
    },
    changedScripts,
    stageChanges,
    globalOnlyScriptChanges,
    nonPackageCompatibilityErrors,
    checks,
    status: "PASS",
  };
}

export async function verifyPackageSemanticMigrationReceipt() {
  const storedBytes = await readFile(resolve(REPO_ROOT, PACKAGE_SEMANTIC_MIGRATION_PATH));
  const stored = JSON.parse(storedBytes.toString("utf8"));
  if (!Number.isFinite(Date.parse(stored.observedAt ?? ""))) throw new Error("Package semantic migration observedAt is invalid.");
  const current = await buildPackageSemanticMigrationReceipt(stored.observedAt);
  if (JSON.stringify(stored) !== JSON.stringify(current)) throw new Error("Package semantic migration receipt is stale.");
  return current;
}

export async function buildGlobalTopologyReceipt(observedAt = new Date().toISOString()) {
  const [packageBytes, ciBytes, localBytes] = await Promise.all([
    readFile(resolve(REPO_ROOT, "package.json")),
    readFile(resolve(REPO_ROOT, ".github/workflows/ci.yml")),
    readFile(resolve(REPO_ROOT, "parity/local-certifications.json")),
  ]);
  const packageJson = JSON.parse(packageBytes.toString("utf8"));
  const local = JSON.parse(localBytes.toString("utf8"));
  const rowIds = PARITY_ROWS.map((row) => row.id);
  const certifiedIds = (local.certifications ?? []).map((entry) => entry.rowId);
  const stageScripts = Object.fromEntries(PARITY_ROWS.map((row) => [row.id, Object.fromEntries(
    Object.entries(row.stages ?? {}).map(([stage, script]) => [stage, { script, command: packageJson.scripts?.[script] ?? null }]),
  )]));
  const checks = {
    denominatorExactly133: parityManifest.denominator === 133 && parityManifest.rows.length === 133,
    rowIdsUnique: new Set(rowIds).size === rowIds.length,
    scoreRatchetMatchesTopology: rowIds.slice().sort().join("|") === certifiedIds.slice().sort().join("|"),
    everyStageScriptExists: Object.values(stageScripts).every((stages) => Object.values(stages).every((entry) => typeof entry.command === "string" && entry.command.length > 0)),
    fullCiGatePresent: ciBytes.includes(Buffer.from("npm run check:fast")) && ciBytes.includes(Buffer.from("npm run check:certification")),
    packageMigrationHistoryAvailable: checkoutStepsUseFullHistory(ciBytes.toString("utf8")),
    licensedAutoCadJobPresent: ciBytes.includes(Buffer.from("autocad-2024-certification")),
    requiredOracleJobPresent: ciBytes.includes(Buffer.from("required-oracles")),
    protectedF024AutoCadChainPresent: workflowJobContainsOrderedRuns(ciBytes.toString("utf8"), "autocad-2024-certification", [
      "npm run parity:f024:browser-artifact",
      "npm run parity:f024:readback",
      "npm run parity:f024:autocad",
      "npm run parity:f024:oracles",
      "npm run parity:f024:cross-evidence",
    ]),
    requiredF024OracleChainPresent: workflowJobContainsOrderedRuns(ciBytes.toString("utf8"), "required-oracles", [
      "npm run parity:f024:oracles",
      "npm run parity:f024:cross-evidence",
    ]),
  };
  if (Object.values(checks).some((value) => value !== true)) throw new Error(`Global topology receipt failed: ${JSON.stringify(checks)}`);
  const sourceSha256 = Object.fromEntries(await Promise.all(GLOBAL_TOPOLOGY_SOURCE_PATHS.map(async (path) => [
    path,
    sourceContentAddress(await readFile(resolve(REPO_ROOT, path))),
  ])));
  return {
    schemaVersion: 1,
    kind: "global-topology",
    observedAt,
    sourceSha256,
    certifiedRowIds: rowIds,
    stageScripts,
    checks,
    status: "PASS",
  };
}

export async function verifyGlobalTopologyReceipt() {
  const storedBytes = await readFile(resolve(REPO_ROOT, GLOBAL_TOPOLOGY_RECEIPT_PATH));
  const stored = JSON.parse(storedBytes.toString("utf8"));
  if (!Number.isFinite(Date.parse(stored.observedAt ?? ""))) throw new Error("Global topology receipt observedAt is invalid.");
  const current = await buildGlobalTopologyReceipt(stored.observedAt);
  if (JSON.stringify(stored) !== JSON.stringify(current)) throw new Error("Global topology receipt is stale.");
  return current;
}

function addAllAuthorityKinds(affected) {
  affected.add("autocad"); affected.add("browser"); affected.add("readback"); affected.add("oracle"); affected.add("cross"); affected.add("global");
}

function addPackageContractKinds(affected, before, after) {
  if (before?.schemaVersion !== 1 || after?.schemaVersion !== 1 || !before.stages || !after.stages) {
    addAllAuthorityKinds(affected);
    return;
  }
  if (before.packageSurfaceSha256 !== after.packageSurfaceSha256) addAllAuthorityKinds(affected);
  const stages = new Set([...Object.keys(before.stages), ...Object.keys(after.stages)]);
  for (const stage of stages) {
    if (JSON.stringify(before.stages?.[stage]) === JSON.stringify(after.stages?.[stage])) continue;
    if (!PARITY_STAGE_ORDER.includes(stage)) {
      addAllAuthorityKinds(affected);
      continue;
    }
    affected.add(stage);
    affected.add("global");
    if (stage !== "cross") affected.add("cross");
  }
}

function evidenceKindsAffectedBySources(previousSources, currentSources, sourcePaths) {
  const affected = new Set();
  for (const rawPath of sourcePaths) {
    const path = normalizeRepoPath(rawPath);
    if (path === "package.json") {
      addPackageContractKinds(affected, previousSources?.[path], currentSources?.[path]);
      continue;
    }
    if (PACKAGE_WORKSPACE_MANIFEST_PATHS.includes(path)) {
      addAllAuthorityKinds(affected);
      continue;
    }
    if (path === "package-lock.json") {
      addAllAuthorityKinds(affected);
      continue;
    }
    if ([".github/workflows/ci.yml", PACKAGE_SEMANTIC_MIGRATION_PATH, "parity/rows.mjs", "tools/parity-kit/core.mjs", "tools/parity-kit/cli.mjs"].includes(path)) {
      affected.add("global");
      continue;
    }
    if (path === "playwright.config.ts" || path.startsWith("e2e/")) { affected.add("browser"); affected.add("cross"); continue; }
    if (path.startsWith("apps/web/") || /^packages\/(?:cad-core|cad-dxf|cad-print|cad-renderer)\//u.test(path)) {
      affected.add("browser");
      affected.add("readback");
      affected.add("cross");
      continue;
    }
    if (path.startsWith("tools/autocad/") || path.startsWith("parity/autocad/")) { affected.add("autocad"); affected.add("cross"); continue; }
    if (path.startsWith("tools/oracles/")) { affected.add("oracle"); affected.add("cross"); continue; }
    if (/^tools\/parity\/(?:capture|build)-/u.test(path)) { affected.add("browser"); affected.add("cross"); continue; }
    if (/^tools\/parity\/(?:run|read)-/u.test(path)) { affected.add("readback"); affected.add("cross"); continue; }
    if (/^tools\/parity\/check-/u.test(path)) { affected.add("cross"); continue; }
    if (/^parity\/F-\d{3}-scope\.md$/u.test(path)) { affected.add("cross"); continue; }
    // Dependency locks, expected contracts and unknown shared certification
    // sources stay fail-closed because they can affect every authority.
    addAllAuthorityKinds(affected);
  }
  return affected;
}

export function staleEvidenceBindings(previous, current, { allowV3ToV4 = false, ignoredSourcePaths = [] } = {}) {
  const sameSchema = previous?.schemaVersion === 4 && current?.schemaVersion === 4;
  const migrating = allowV3ToV4 && previous?.schemaVersion === 3 && current?.schemaVersion === 4;
  if (!sameSchema && !migrating) return [];
  const ignored = new Set(ignoredSourcePaths.map(normalizeRepoPath));
  const previousRows = new Map((previous.rows ?? []).map((row) => [row.rowId, row]));
  const errors = [];
  for (const row of current.rows ?? []) {
    const prior = previousRows.get(row.rowId);
    if (!prior || JSON.stringify(prior.sources) === JSON.stringify(row.sources)) continue;
    const changedSources = [...new Set([...Object.keys(prior.sources ?? {}), ...Object.keys(row.sources ?? {})])]
      .filter((path) => !ignored.has(normalizeRepoPath(path)))
      .filter((path) => JSON.stringify(prior.sources?.[path]) !== JSON.stringify(row.sources?.[path]));
    const affectedKinds = evidenceKindsAffectedBySources(prior.sources, row.sources, changedSources);
    for (const kind of Object.keys(row.evidence ?? {})) {
      if (!affectedKinds.has(kind)) continue;
      const before = prior.evidence?.[kind];
      const after = row.evidence?.[kind];
      if (before?.descriptorSha256 === after?.descriptorSha256 && before?.artifactSha256 === after?.artifactSha256) {
        errors.push(`${row.rowId}: source changed without refreshed ${kind} evidence.`);
      }
    }
    for (const kind of Object.keys(row.receipts ?? {})) {
      if (!affectedKinds.has(kind)) continue;
      if (prior.receipts?.[kind]?.sha256 === row.receipts?.[kind]?.sha256) {
        errors.push(`${row.rowId}: source changed without refreshed ${kind} stage receipt.`);
      }
    }
  }
  return errors;
}

export async function validateParityKit({ checkContentAddresses = true } = {}) {
  const errors = [];
  const local = JSON.parse(await readFile(resolve(REPO_ROOT, "parity/local-certifications.json"), "utf8"));
  try { await verifyPackageSemanticMigrationReceipt(); } catch (error) { errors.push(error instanceof Error ? error.message : String(error)); }
  try { await verifyGlobalTopologyReceipt(); } catch (error) { errors.push(error instanceof Error ? error.message : String(error)); }
  const packageJson = JSON.parse(await readFile(resolve(REPO_ROOT, "package.json"), "utf8"));
  const declaredIds = PARITY_ROWS.map((row) => row.id);
  const certifiedIds = (local.certifications ?? []).map((row) => row.rowId).sort();
  if (new Set(declaredIds).size !== declaredIds.length) errors.push("Parity row specifications contain duplicate row ids.");
  if (declaredIds.slice().sort().join("|") !== certifiedIds.join("|")) {
    errors.push(`Parity row specs do not equal the local certification ratchet (${declaredIds.length}/${certifiedIds.length}).`);
  }
  if (parityManifest.denominator !== 133 || parityManifest.rows.length !== 133) errors.push("The fixed parity denominator is not 133.");
  for (const row of PARITY_ROWS) {
    for (const group of row.sourceGroups) if (!(group in SOURCE_GROUPS)) errors.push(`${row.id}: unknown source group ${group}.`);
    for (const source of expandRowSources(row)) {
      try { await access(resolve(REPO_ROOT, source)); } catch { errors.push(`${row.id}: missing source ${source}.`); }
    }
    for (const [kind, evidencePath] of Object.entries(row.evidence)) {
      try { await access(resolve(REPO_ROOT, evidencePath)); } catch { errors.push(`${row.id}: missing ${kind} evidence ${evidencePath}.`); }
    }
    for (const receipt of row.receipts ?? []) {
      try { await access(resolve(REPO_ROOT, receipt.path)); } catch { errors.push(`${row.id}: missing ${receipt.kind} receipt ${receipt.path}.`); }
    }
    for (const [stage, script] of Object.entries(row.stages)) {
      if (!packageJson.scripts?.[script]) errors.push(`${row.id}: ${stage} references missing npm script ${script}.`);
    }
  }
  for (const [source, rowIds] of Object.entries(UNCERTIFIED_SOURCE_ROWS)) {
    try { await access(resolve(REPO_ROOT, source)); } catch { errors.push(`Uncertified source mapping is missing ${source}.`); }
    for (const rowId of rowIds) {
      if (!isAuditRowId(rowId)) errors.push(`Uncertified source mapping ${source} has invalid audit row ${rowId}.`);
      if (declaredIds.includes(rowId)) errors.push(`Certified row ${rowId} must use sourceGroups instead of UNCERTIFIED_SOURCE_ROWS.`);
    }
  }
  const graph = sourceToRows();
  for (const source of await runtimeSources()) if (!graph.has(source)) errors.push(`Runtime source is not mapped to an F-row: ${source}.`);
  for (const source of repositoryFiles().filter((file) => CERTIFICATION_SOURCE_ROOTS.some((root) => file.startsWith(`${root}/`)))) {
    if (!graph.has(source) && inferredRowIds(source).length === 0) errors.push(`Certification source is not mapped to an F-row: ${source}.`);
  }
  if (checkContentAddresses) {
    const expectedPath = resolve(REPO_ROOT, "parity/content-addresses.json");
    try {
      const stored = JSON.parse(await readFile(expectedPath, "utf8"));
      const current = await buildContentAddressManifest();
      if (JSON.stringify(stored) !== JSON.stringify(current)) errors.push("parity/content-addresses.json is stale; run npm run parity:content-addresses:update.");
    } catch (error) {
      errors.push(`Cannot validate parity/content-addresses.json: ${error.message}`);
    }
  }
  return { errors, rows: declaredIds.length, runtimeSources: (await runtimeSources()).length, graph };
}
