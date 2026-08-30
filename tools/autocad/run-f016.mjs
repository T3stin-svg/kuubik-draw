#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const root = process.cwd();
const executable = process.env.AUTOCAD_CORE ?? "C:\\Program Files\\Autodesk\\AutoCAD 2024\\accoreconsole.exe";
const fixturePath = resolve(root, "parity/fixtures/F-016-empty-mm.dxf");
const scriptPath = resolve(root, "parity/autocad/F-016.scr");
const matrixScriptPath = resolve(root, "tools/autocad/f016-standard-matrix.ps1");
const outputPath = resolve(root, process.argv[2] ?? "evidence/artifacts/F-016-autocad-readback.json");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function acadProcessIdentities() {
  const script = "@(Get-Process acad -ErrorAction SilentlyContinue | ForEach-Object { [ordered]@{ processId=[int]$_.Id; executablePath=[IO.Path]::GetFullPath([string]$_.Path); startTimeUtc=$_.StartTime.ToUniversalTime().ToString('o') } }) | ConvertTo-Json -Compress";
  const output = execFileSync("powershell.exe", ["-NoProfile", "-Command", script], { windowsHide: true, encoding: "utf8" }).trim();
  if (!output) return [];
  const parsed = JSON.parse(output);
  return (Array.isArray(parsed) ? parsed : [parsed]).toSorted((left, right) => left.processId - right.processId);
}

function identityMatches(expected, current) {
  return current?.processId === expected?.processId
    && current.executablePath?.toLowerCase() === expected.executablePath?.toLowerCase()
    && current.startTimeUtc === expected.startTimeUtc;
}

function processIdentity(processId) {
  return acadProcessIdentities().find((identity) => identity.processId === processId) ?? null;
}

function newAutomationSidecars(preExisting) {
  const existing = new Set(preExisting.map(({ processId }) => processId));
  const script = "Get-CimInstance Win32_Process -Filter \"Name='acad.exe'\" | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress";
  const output = execFileSync("powershell.exe", ["-NoProfile", "-Command", script], { windowsHide: true, encoding: "utf8" }).trim();
  if (!output) return [];
  const records = JSON.parse(output);
  return (Array.isArray(records) ? records : [records])
    .filter((record) => !existing.has(Number(record.ProcessId)) && /\/Automation\s+-Embedding/iu.test(String(record.CommandLine ?? "")))
    .map((record) => processIdentity(Number(record.ProcessId)))
    .filter(Boolean);
}

async function terminateIdentity(identity) {
  if (!identity) return false;
  let current = acadProcessIdentities().find(({ processId }) => processId === identity.processId);
  if (!current) return true;
  if (!identityMatches(identity, current)) throw new Error(`F-016 refuses to terminate PID ${identity.processId}: process identity changed.`);
  try { process.kill(identity.processId); } catch (error) { if (error?.code === "ESRCH") return true; throw error; }
  for (let attempt = 0; attempt < 100; attempt += 1) {
    await new Promise((done) => setTimeout(done, 100));
    current = acadProcessIdentities().find(({ processId }) => processId === identity.processId);
    if (!current) return true;
    if (!identityMatches(identity, current)) throw new Error(`F-016 PID ${identity.processId} was reused during cleanup.`);
  }
  return false;
}

async function restoreProcessSet(preExisting, reportedIdentity) {
  const preExistingIds = new Set(preExisting.map(({ processId }) => processId));
  let current = acadProcessIdentities();
  if (reportedIdentity) {
    if (preExistingIds.has(reportedIdentity.processId)) throw new Error("F-016 matrix reported a pre-existing AutoCAD PID as owned.");
    const candidate = current.find(({ processId }) => processId === reportedIdentity.processId);
    if (candidate && !identityMatches(reportedIdentity, candidate)) throw new Error("F-016 reported AutoCAD identity does not match the live process.");
    if (candidate && !(await terminateIdentity(reportedIdentity))) throw new Error("F-016 owned AutoCAD process did not terminate.");
  } else {
    const orphanCandidates = newAutomationSidecars(preExisting);
    if (orphanCandidates.length === 1) {
      if (!(await terminateIdentity(orphanCandidates[0]))) throw new Error("F-016 orphan AutoCAD automation process did not terminate.");
    } else if (orphanCandidates.length > 1) {
      throw new Error(`F-016 refuses ambiguous orphan cleanup: ${orphanCandidates.map(({ processId }) => processId).join(",")}.`);
    }
  }
  for (let attempt = 0; attempt < 100; attempt += 1) {
    current = acadProcessIdentities();
    if (JSON.stringify(current) === JSON.stringify(preExisting)) return true;
    await new Promise((done) => setTimeout(done, 100));
  }
  return false;
}

function runCoreConsole() {
  return new Promise((resolveRun, reject) => {
    const child = spawn(executable, ["/i", fixturePath, "/s", scriptPath, "/l", "en-US"], {
      cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    const timeout = setTimeout(() => {
      try { execFileSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }); }
      catch { child.kill(); }
      reject(new Error("AutoCAD Core Console exceeded the 45 second timeout."));
    }, 45_000);
    child.on("error", (error) => { clearTimeout(timeout); reject(error); });
    child.on("close", (code) => {
      clearTimeout(timeout);
      const out = Buffer.concat(stdout).toString("utf16le");
      const errorText = Buffer.concat(stderr).toString("utf16le");
      if (code !== 0) return reject(new Error(`AutoCAD Core Console exited ${code}: ${errorText}`));
      resolveRun(out);
    });
  });
}

function runStandardMatrix() {
  return new Promise((resolveRun, reject) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", matrixScriptPath], {
      cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    const timeout = setTimeout(() => {
      try { execFileSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }); }
      catch { child.kill(); }
      reject(new Error("AutoCAD standard matrix exceeded the 90 second timeout."));
    }, 90_000);
    child.on("error", (error) => { clearTimeout(timeout); reject(error); });
    child.on("close", (code) => {
      clearTimeout(timeout);
      const output = Buffer.concat(stdout).toString("utf8").trim();
      const errorText = Buffer.concat(stderr).toString("utf8").trim();
      if (code !== 0) return reject(new Error(`AutoCAD standard matrix exited ${code}: ${errorText || output}`));
      try {
        const start = output.indexOf("{");
        const end = output.lastIndexOf("}");
        if (start < 0 || end < start) throw new Error("PowerShell output did not contain JSON.");
        resolveRun(JSON.parse(output.slice(start, end + 1)));
      } catch (error) {
        reject(new Error(`AutoCAD standard matrix JSON parse failed: ${error.message}\n${output}`));
      }
    });
  });
}

const stdout = await runCoreConsole();
const preExistingProcesses = acadProcessIdentities();
let standardMatrix;
let processSetRestored = false;
let primaryError = null;
try {
  standardMatrix = await runStandardMatrix();
} catch (error) {
  primaryError = error;
  throw error;
} finally {
  const cleanupErrors = [];
  try {
    processSetRestored = await restoreProcessSet(preExistingProcesses, standardMatrix?.automationProcessIdentity ?? null);
    if (!processSetRestored) cleanupErrors.push(new Error("F-016 AutoCAD process set was not restored during cleanup."));
  } catch (error) { cleanupErrors.push(error); }
  if (cleanupErrors.length > 0) throw new AggregateError(primaryError ? [primaryError, ...cleanupErrors] : cleanupErrors, "F-016 cleanup verification failed.");
}
const marker = (name) => {
  const matches = [...stdout.matchAll(new RegExp(`F016_${name}=([^"\\\\\\r\\n]+)`, "g"))];
  return matches.at(-1)?.[1]?.trim() ?? null;
};
const point = (name) => marker(name)?.split(",").map(Number) ?? null;
const result = {
  schemaVersion: 1,
  rowId: "F-016",
  benchmark: "AutoCAD 2024.1.2 / Windows / 2D Drafting & Annotation",
  engine: "Autodesk AutoCAD Core Console 2024",
  engineVersion: marker("ACADVER"),
  command: "MOVE",
  result: {
    vector: [500, 750],
    after: [
      { start: point("AFTER1_START"), end: point("AFTER1_END") },
      { start: point("AFTER2_START"), end: point("AFTER2_END") },
    ],
    afterUndo: [
      { start: point("UNDO1_START"), end: point("UNDO1_END") },
      { start: point("UNDO2_START"), end: point("UNDO2_END") },
    ],
    mixed: { editableStarts: [point("MIX1_START"), point("MIX2_START")], lockedStart: point("LOCKED_START") },
    standardMatrix: { ...standardMatrix, processSetRestored },
  },
  fixtureSha256: sha256(await readFile(fixturePath)),
  scriptSha256: sha256(await readFile(scriptPath)),
  matrixScriptSha256: sha256(await readFile(matrixScriptPath)),
  observedAt: new Date().toISOString(),
  status: marker("DONE") === "1" && standardMatrix.status === "PASS" ? "PASS" : "FAIL",
};
const expectedFamilies = ["line", "polyline", "circle", "arc", "ellipse", "spline", "text", "mtext", "leader", "dimension", "hatch", "blockRef"];
const expectedObjectNames = ["AcDbLine", "AcDbPolyline", "AcDbCircle", "AcDbArc", "AcDbEllipse", "AcDbSpline", "AcDbText", "AcDbMText", "AcDbLeader", "AcDbAlignedDimension", "AcDbHatch", "AcDbBlockReference"];
if (
  !result.engineVersion?.startsWith("24.3") ||
  JSON.stringify(result.result.after) !== JSON.stringify([
    { start: [510, 760], end: [680, 840] }, { start: [500, 1750], end: [1500, 2250] },
  ]) ||
  JSON.stringify(result.result.afterUndo) !== JSON.stringify([
    { start: [10, 10], end: [180, 90] }, { start: [0, 1000], end: [1000, 1500] },
  ]) ||
  JSON.stringify(result.result.mixed) !== JSON.stringify({ editableStarts: [[110, 60], [100, 1050]], lockedStart: [0, 2000] }) ||
  !standardMatrix.engineVersion?.startsWith("24.3") ||
  standardMatrix.automationProcessOwned !== true || !Number.isInteger(standardMatrix.automationProcessId) ||
  standardMatrix.automationProcessId !== standardMatrix.automationProcessIdentity?.processId || !processSetRestored ||
  preExistingProcesses.some(({ processId }) => processId === standardMatrix.automationProcessId) ||
  JSON.stringify(standardMatrix.before?.map(({ family }) => family)) !== JSON.stringify(expectedFamilies) ||
  JSON.stringify(standardMatrix.before?.map(({ objectName }) => objectName)) !== JSON.stringify(expectedObjectNames) ||
  standardMatrix.checks?.length !== 12 || standardMatrix.checks.some(({ translated, restored }) => !translated || !restored) ||
  standardMatrix.cmdNamesAfter !== "" ||
  result.status !== "PASS"
) throw new Error(`F-016 AutoCAD result mismatch: ${JSON.stringify(result)}`);

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(`F-016 AutoCAD live PASS (${result.engineVersion}, exact +500/+750, U, locked layer, 12 standard families).`);
