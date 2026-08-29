#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const evidenceDirectory = "evidence/security";
const manifestPath = `${evidenceDirectory}/gitleaks-source-manifest.json`;
const reportPath = `${evidenceDirectory}/gitleaks-report.json`;
const runPath = `${evidenceDirectory}/gitleaks-run.json`;
const generatedPaths = new Set([manifestPath, reportPath, runPath]);
const ciGeneratedPaths = new Set(["results.sarif"]);
const bindingExcludedPaths = new Set([...generatedPaths, ...ciGeneratedPaths]);
const expectedCommand = "gitleaks dir --no-banner --redact --config .gitleaks.toml --report-format json --report-path evidence/security/gitleaks-report.json .";

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function canonicalSourceBytes(bytes) {
  if (bytes.includes(0)) return bytes;
  return Buffer.from(bytes.toString("utf8").replaceAll("\r\n", "\n"), "utf8");
}

async function collectSourceTree() {
  const listed = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
    cwd: root,
    encoding: "utf8",
  });
  const paths = listed
    .split("\0")
    .filter(Boolean)
    .map((path) => path.replaceAll("\\", "/"))
    .filter((path) => !bindingExcludedPaths.has(path))
    .sort((a, b) => a.localeCompare(b, "en"));
  const files = await Promise.all(paths.map(async (path) => {
    const bytes = canonicalSourceBytes(await readFile(resolve(root, path)));
    return { path, size: bytes.byteLength, sha256: sha256(bytes) };
  }));
  const sourceTreeSha256 = sha256(JSON.stringify(files));
  return {
    schemaVersion: 1,
    algorithm: "sha256",
    fileSelection: "git ls-files --cached --others --exclude-standard",
    generatedEvidenceExcluded: [...generatedPaths].sort(),
    ciArtifactsExcluded: [...ciGeneratedPaths].sort(),
    fileCount: files.length,
    sourceTreeSha256,
    files,
  };
}

async function writeManifest() {
  const manifest = await collectSourceTree();
  await writeFile(resolve(root, manifestPath), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(`Gitleaks source manifest written (${manifest.fileCount} files, ${manifest.sourceTreeSha256}).`);
}

async function scanEvidence() {
  const executablePath = process.env.GITLEAKS_CMD;
  if (!executablePath) throw new Error("GITLEAKS_CMD must point to the pinned gitleaks executable for --scan.");
  await writeManifest();
  const version = execFileSync(executablePath, ["version"], { cwd: root, encoding: "utf8" }).trim();
  const previousRun = JSON.parse(await readFile(resolve(root, runPath), "utf8"));
  if (previousRun.version !== version || !/^[a-f0-9]{64}$/u.test(previousRun.releaseArchiveSha256 ?? "")) {
    throw new Error(`Pinned release provenance is unavailable for gitleaks ${version}.`);
  }
  execFileSync(executablePath, [
    "dir", "--no-banner", "--redact", "--config", ".gitleaks.toml",
    "--report-format", "json", "--report-path", reportPath, ".",
  ], { cwd: root, stdio: "inherit" });
  const [manifestBytes, reportBytes, configBytes, executableBytes] = await Promise.all([
    readFile(resolve(root, manifestPath)),
    readFile(resolve(root, reportPath)),
    readFile(resolve(root, ".gitleaks.toml")),
    readFile(executablePath),
  ]);
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  const report = JSON.parse(reportBytes.toString("utf8"));
  if (!Array.isArray(report) || report.length !== 0) throw new Error("Gitleaks reported one or more findings.");
  const run = {
    schemaVersion: 1,
    tool: "gitleaks",
    version,
    releaseArchiveSha256: previousRun.releaseArchiveSha256,
    executableSha256: sha256(executableBytes),
    status: "PASS",
    leakCount: 0,
    scannedAt: new Date().toISOString(),
    command: expectedCommand,
    sourceScope: "git-visible public repository tree, including tracked and untracked non-ignored files",
    networkRequired: false,
    configuration: { path: ".gitleaks.toml", sha256: sha256(configBytes) },
    sourceManifest: { path: manifestPath, sha256: sha256(manifestBytes), sourceTreeSha256: manifest.sourceTreeSha256 },
    report: { path: reportPath, sha256: sha256(reportBytes) },
  };
  await writeFile(resolve(root, runPath), `${JSON.stringify(run, null, 2)}\n`, "utf8");
  console.log(`Gitleaks evidence written (${version}, 0 findings, ${manifest.sourceTreeSha256}).`);
}

async function verifyEvidence() {
  const [storedManifestBytes, reportBytes, runBytes, configBytes] = await Promise.all([
    readFile(resolve(root, manifestPath)),
    readFile(resolve(root, reportPath)),
    readFile(resolve(root, runPath)),
    readFile(resolve(root, ".gitleaks.toml")),
  ]);
  const storedManifest = JSON.parse(storedManifestBytes.toString("utf8"));
  const currentManifest = await collectSourceTree();
  const report = JSON.parse(reportBytes.toString("utf8"));
  const run = JSON.parse(runBytes.toString("utf8"));
  const errors = [];
  if (JSON.stringify(storedManifest) !== JSON.stringify(currentManifest)) {
    errors.push("Public source tree changed after the Gitleaks manifest was written.");
    const storedFiles = new Map((storedManifest.files ?? []).map((file) => [file.path, file.sha256]));
    const currentFiles = new Map(currentManifest.files.map((file) => [file.path, file.sha256]));
    const changedPaths = [...new Set([...storedFiles.keys(), ...currentFiles.keys()])]
      .filter((path) => storedFiles.get(path) !== currentFiles.get(path))
      .sort()
      .slice(0, 20);
    if (changedPaths.length) errors.push(`Changed source paths: ${changedPaths.join(", ")}`);
  }
  if (!Array.isArray(report) || report.length !== 0) errors.push("Gitleaks report is not an empty finding list.");
  if (run.status !== "PASS" || run.leakCount !== 0) errors.push("Gitleaks run metadata is not PASS/0.");
  if (run.command !== expectedCommand) errors.push("Gitleaks command does not match the fixed directory-scan command.");
  if (run.configuration?.path !== ".gitleaks.toml" || run.configuration?.sha256 !== sha256(configBytes)) errors.push("Gitleaks configuration hash mismatch.");
  if (run.sourceManifest?.path !== manifestPath || run.sourceManifest?.sha256 !== sha256(storedManifestBytes)) errors.push("Gitleaks source-manifest hash mismatch.");
  if (run.sourceManifest?.sourceTreeSha256 !== currentManifest.sourceTreeSha256) errors.push("Gitleaks source-tree hash mismatch.");
  if (run.report?.path !== reportPath || run.report?.sha256 !== sha256(reportBytes)) errors.push("Gitleaks report hash mismatch.");
  if (!Number.isFinite(Date.parse(run.scannedAt ?? ""))) errors.push("Gitleaks scan timestamp is invalid.");
  if (errors.length) {
    console.error(errors.join("\n"));
    process.exit(1);
  }
  console.log(`Gitleaks evidence PASS (${currentManifest.fileCount} source files bound to ${currentManifest.sourceTreeSha256}).`);
}

if (process.argv.includes("--scan")) await scanEvidence();
else if (process.argv.includes("--write")) await writeManifest();
else await verifyEvidence();
