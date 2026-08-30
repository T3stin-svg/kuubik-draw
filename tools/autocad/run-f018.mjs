#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const root = process.cwd();
const scriptPath = resolve(root, "parity/autocad/F-018.scr");
const matrixScriptPath = resolve(root, "tools/autocad/f018-standard-matrix.ps1");
const outputPath = resolve(root, process.argv[2] ?? "evidence/artifacts/F-018-autocad-readback.json");
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
  if (!identityMatches(identity, current)) throw new Error(`F-018 refuses to terminate PID ${identity.processId}: process identity changed.`);
  try { process.kill(identity.processId); } catch (error) { if (error?.code === "ESRCH") return true; throw error; }
  for (let attempt = 0; attempt < 100; attempt += 1) {
    await new Promise((done) => setTimeout(done, 100));
    current = acadProcessIdentities().find(({ processId }) => processId === identity.processId);
    if (!current) return true;
    if (!identityMatches(identity, current)) throw new Error(`F-018 PID ${identity.processId} was reused during cleanup.`);
  }
  return false;
}

async function restoreProcessSet(preExisting, reportedIdentity) {
  const preExistingIds = new Set(preExisting.map(({ processId }) => processId));
  let current = acadProcessIdentities();
  if (reportedIdentity) {
    if (preExistingIds.has(reportedIdentity.processId)) throw new Error("F-018 matrix reported a pre-existing AutoCAD PID as owned.");
    const candidate = current.find(({ processId }) => processId === reportedIdentity.processId);
    if (candidate && !identityMatches(reportedIdentity, candidate)) throw new Error("F-018 reported AutoCAD identity does not match the live process.");
    if (candidate && !(await terminateIdentity(reportedIdentity))) throw new Error("F-018 owned AutoCAD process did not terminate.");
  } else {
    const orphanCandidates = newAutomationSidecars(preExisting);
    if (orphanCandidates.length === 1) {
      if (!(await terminateIdentity(orphanCandidates[0]))) throw new Error("F-018 orphan AutoCAD automation process did not terminate.");
    } else if (orphanCandidates.length > 1) {
      throw new Error(`F-018 refuses ambiguous orphan cleanup: ${orphanCandidates.map(({ processId }) => processId).join(",")}.`);
    }
  }
  for (let attempt = 0; attempt < 100; attempt += 1) {
    current = acadProcessIdentities();
    if (JSON.stringify(current) === JSON.stringify(preExisting)) return true;
    await new Promise((done) => setTimeout(done, 100));
  }
  return false;
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
      reject(new Error("AutoCAD F-018 matrix exceeded the 150 second timeout."));
    }, 150_000);
    child.on("error", (error) => { clearTimeout(timeout); reject(error); });
    child.on("close", (code) => {
      clearTimeout(timeout);
      const output = Buffer.concat(stdout).toString("utf8").trim();
      const errorText = Buffer.concat(stderr).toString("utf8").trim();
      if (code !== 0) return reject(new Error(`AutoCAD F-018 matrix exited ${code}: ${errorText || output}`));
      try {
        const start = output.indexOf("{");
        const end = output.lastIndexOf("}");
        if (start < 0 || end < start) throw new Error("PowerShell output did not contain JSON.");
        resolveRun(JSON.parse(output.slice(start, end + 1)));
      } catch (error) {
        reject(new Error(`AutoCAD F-018 JSON parse failed: ${error.message}\n${output}`));
      }
    });
  });
}

const preExistingProcesses = acadProcessIdentities();
let matrix;
let processSetRestored = false;
let primaryError = null;
try {
  matrix = await runStandardMatrix();
} catch (error) {
  primaryError = error;
  throw error;
} finally {
  const cleanupErrors = [];
  try {
    processSetRestored = await restoreProcessSet(preExistingProcesses, matrix?.userDocument?.automationProcessIdentity ?? null);
    if (!processSetRestored) cleanupErrors.push(new Error("F-018 AutoCAD process set was not restored during cleanup."));
  } catch (error) { cleanupErrors.push(error); }
  if (cleanupErrors.length > 0) throw new AggregateError(primaryError ? [primaryError, ...cleanupErrors] : cleanupErrors, "F-018 cleanup verification failed.");
}
matrix = { ...matrix, automationProcessTerminated: processSetRestored, processSetRestored };
const expectedFamilies = ["line", "polyline", "circle", "arc", "ellipse", "spline", "text", "mtext", "leader", "dimension", "hatch", "blockRef"];
const expectedObjectNames = ["AcDbLine", "AcDbPolyline", "AcDbCircle", "AcDbArc", "AcDbEllipse", "AcDbSpline", "AcDbText", "AcDbMText", "AcDbLeader", "AcDbAlignedDimension", "AcDbHatch", "AcDbBlockReference"];
if (
  matrix.schemaVersion !== 1 || matrix.rowId !== "F-018" || !matrix.engineVersion?.startsWith("24.3") ||
  !matrix.userDocument?.isolatedOwnedProcess || !matrix.automationProcessTerminated || !Number.isInteger(matrix.userDocument?.automationProcessId) ||
  matrix.userDocument.automationProcessId !== matrix.userDocument.automationProcessIdentity?.processId || !matrix.processSetRestored ||
  preExistingProcesses.some(({ processId }) => processId === matrix.userDocument.automationProcessId) ||
  matrix.referenceAngleDeg !== 45 || matrix.newAngleDeg !== 135 || matrix.deltaAngleDeg !== 90 ||
  JSON.stringify(matrix.before?.map(({ family }) => family)) !== JSON.stringify(expectedFamilies) ||
  JSON.stringify(matrix.before?.map(({ objectName }) => objectName)) !== JSON.stringify(expectedObjectNames) ||
  matrix.checks?.length !== 12 || matrix.checks.some((check) =>
    !check.sameHandle || !check.rotatedBounds || !check.propertiesPreserved || !check.undoRestored) ||
  !matrix.inputModes?.standardNumeric?.passed || !matrix.inputModes?.standardPoint?.passed ||
  !matrix.inputModes?.numericReferencePointTarget?.passed || !matrix.inputModes?.negativeNumeric?.passed ||
  !matrix.inputModes?.passed || !matrix.mixedLocked?.passed ||
  matrix.gate?.failedCount !== 0 || !matrix.gate?.matrixPassed || !matrix.gate?.inputModesPassed || !matrix.gate?.mixedLockedPassed ||
  !matrix.userDocument?.blankRestored ||
  matrix.cmdNamesAfter !== "" || matrix.status !== "PASS"
) throw new Error(`F-018 AutoCAD result mismatch: ${JSON.stringify(matrix)}`);

const result = {
  ...matrix,
  scriptSha256: sha256(await readFile(scriptPath)),
  matrixScriptSha256: sha256(await readFile(matrixScriptPath)),
  observedAt: new Date().toISOString(),
};
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(`F-018 AutoCAD live PASS (${result.engineVersion}, ROTATE Reference, 12 families, U, input modes, locked layer).`);
