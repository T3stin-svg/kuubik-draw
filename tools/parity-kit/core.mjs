import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, readFile, readdir } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parityManifest } from "../../parity/autocad-2024-2d.manifest.mjs";
import { CERTIFICATION_SOURCE_ROOTS, PARITY_ROWS, RUNTIME_SOURCE_ROOTS, SOURCE_GROUPS } from "../../parity/rows.mjs";

export const REPO_ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
export const PARITY_STAGE_ORDER = Object.freeze(["browser", "readback", "oracle", "autocad", "cross"]);

export function normalizeRepoPath(path) {
  return path.replaceAll("\\", "/").replace(/^\.\//u, "");
}

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function sourceContentAddress(bytes) {
  return sha256(Buffer.from(bytes.toString("utf8").replace(/\r\n?/gu, "\n"), "utf8"));
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

export function semanticValue(value) {
  if (Array.isArray(value)) return value.map(semanticValue);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !volatileTimeKeys.has(key) && !volatileProvenanceHashKeys.has(key))
    .sort(([left], [right]) => left.localeCompare(right))
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
    }).sort(([left], [right]) => left.localeCompare(right));
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

export function inferredRowIds(file) {
  const ids = [...normalizeRepoPath(file).matchAll(/f-?(\d{3})/giu)]
    .map((match) => `F-${match[1]}`)
    .filter((rowId) => PARITY_ROWS.some((row) => row.id === rowId));
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
  const rows = [];
  for (const row of PARITY_ROWS) {
    const sources = Object.fromEntries(await Promise.all(expandRowSources(row).map(async (sourcePath) => {
      const sourceBytes = await readFile(resolve(REPO_ROOT, sourcePath));
      return [sourcePath, sourceContentAddress(sourceBytes)];
    })));
    const evidence = {};
    for (const [kind, descriptorPath] of Object.entries(row.evidence)) {
      const descriptorBytes = await readFile(resolve(REPO_ROOT, descriptorPath));
      const descriptor = JSON.parse(descriptorBytes.toString("utf8"));
      const artifactPath = normalizeRepoPath(descriptor.artifact);
      const artifactBytes = await readFile(resolve(REPO_ROOT, artifactPath));
      evidence[kind] = {
        descriptorPath,
        descriptorSha256: sha256(descriptorBytes),
        descriptorContentSha256: semanticContentAddress(descriptorBytes, descriptorPath),
        artifactPath,
        artifactSha256: sha256(artifactBytes),
        artifactContentSha256: semanticContentAddress(artifactBytes, artifactPath),
      };
    }
    const receipts = {};
    for (const receipt of row.receipts ?? []) {
      const receiptBytes = await readFile(resolve(REPO_ROOT, receipt.path));
      receipts[receipt.kind] = {
        path: receipt.path,
        sha256: sha256(receiptBytes),
        contentSha256: semanticContentAddress(receiptBytes, receipt.path),
      };
    }
    rows.push({ rowId: row.id, sources, evidence, receipts });
  }
  return { schemaVersion: 3, normalization: "canonical-json-without-allowlisted-time-or-provenance-hashes; canonical-LF sources; KDRAW1 semantic file addresses; exact stage receipts; other binaries exact", rows };
}

export function staleEvidenceBindings(previous, current) {
  if (previous?.schemaVersion !== 3) return [];
  const previousRows = new Map((previous.rows ?? []).map((row) => [row.rowId, row]));
  const errors = [];
  for (const row of current.rows ?? []) {
    const prior = previousRows.get(row.rowId);
    if (!prior || JSON.stringify(prior.sources) === JSON.stringify(row.sources)) continue;
    for (const kind of Object.keys(row.evidence ?? {})) {
      const before = prior.evidence?.[kind];
      const after = row.evidence?.[kind];
      if (before?.descriptorSha256 === after?.descriptorSha256 && before?.artifactSha256 === after?.artifactSha256) {
        errors.push(`${row.rowId}: source changed without refreshed ${kind} evidence.`);
      }
    }
    for (const kind of Object.keys(row.receipts ?? {})) {
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
