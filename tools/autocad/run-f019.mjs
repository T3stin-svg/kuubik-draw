#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

const root = process.cwd();
const scriptPath = resolve(root, "parity/autocad/F-019.scr");
const matrixScriptPath = resolve(root, "tools/autocad/f019-standard-matrix.ps1");
const escapeHelperPath = resolve(root, "tools/autocad/send-escape.ps1");
const outputPath = resolve(root, process.argv[2] ?? "evidence/artifacts/F-019-autocad-readback.json");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const tempRoot = await mkdtemp(resolve(tmpdir(), "KuubikDraw-F019-"));
const pidPath = resolve(tempRoot, "F019.pid");
const ownershipToken = randomUUID();

function acadProcessIds() {
  const output = execFileSync("powershell.exe", ["-NoProfile", "-Command", "@(Get-Process acad -ErrorAction SilentlyContinue | ForEach-Object { $_.Id }) -join [Environment]::NewLine"], { windowsHide: true, encoding: "utf8" }).trim();
  return output ? output.split(/\r?\n/u).map(Number).filter((value) => Number.isInteger(value) && value > 0).toSorted((a, b) => a - b) : [];
}
const preExistingProcessIds = acadProcessIds();
async function ownedPid() {
  try {
    const sidecar = JSON.parse(await readFile(pidPath, "utf8"));
    return sidecar.token === ownershipToken && sidecar.owned === true ? sidecar.processId : 0;
  } catch (error) {
    if (error?.code === "ENOENT") return 0;
    throw error;
  }
}
async function terminate(processId) {
  if (!(processId > 0)) return false;
  try { process.kill(processId); } catch (error) { if (error?.code === "ESRCH") return true; throw error; }
  for (let attempt = 0; attempt < 80; attempt += 1) {
    await new Promise((done) => setTimeout(done, 100));
    try { process.kill(processId, 0); } catch { return true; }
  }
  return false;
}
async function restoredProcessSet() {
  const expected = preExistingProcessIds.join("|");
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (acadProcessIds().join("|") === expected) return true;
    await new Promise((done) => setTimeout(done, 100));
  }
  return false;
}

async function runStandardMatrix() {
  let processId = 0;
  try {
    const childResult = await new Promise((resolveRun, reject) => {
      const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", matrixScriptPath, "-PidPath", pidPath, "-OwnershipToken", ownershipToken], {
        cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
      });
      const stdout = [];
      const stderr = [];
      child.stdout.on("data", (chunk) => stdout.push(chunk));
      child.stderr.on("data", (chunk) => stderr.push(chunk));
      let timedOut = false; let forceTimeout;
      const timeout = setTimeout(() => { timedOut = true; child.kill(); forceTimeout = setTimeout(() => { try { execFileSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }); } catch {} }, 5_000); }, 180_000);
      child.on("error", (error) => { clearTimeout(timeout); clearTimeout(forceTimeout); reject(error); });
      child.on("close", (code) => {
        clearTimeout(timeout); clearTimeout(forceTimeout);
        resolveRun({ code, timedOut, output: Buffer.concat(stdout).toString("utf8").trim(), errorText: Buffer.concat(stderr).toString("utf8").trim() });
      });
    });
    processId = await ownedPid();
    const automationProcessTerminated = await terminate(processId);
    const processSetRestored = await restoredProcessSet();
    if (childResult.timedOut) throw new Error(`AutoCAD F-019 matrix exceeded the 180 second timeout; authenticated PID=${processId || "missing"}.`);
    if (!(processId > 0) || !automationProcessTerminated || !processSetRestored) throw new Error(`F-019 did not restore its owned AutoCAD process: ${JSON.stringify({ processId, automationProcessTerminated, processSetRestored })}`);
    if (childResult.code !== 0) throw new Error(`AutoCAD F-019 matrix exited ${childResult.code}: ${childResult.errorText || childResult.output}`);
    const start = childResult.output.indexOf("{"); const end = childResult.output.lastIndexOf("}");
    if (start < 0 || end < start) throw new Error("PowerShell output did not contain JSON.");
    return { ...JSON.parse(childResult.output.slice(start, end + 1)), automationProcessTerminated, processSetRestored, preExistingProcessIds };
  } finally {
    try { if (!(processId > 0)) processId = await ownedPid(); if (processId > 0) await terminate(processId); }
    finally { await rm(tempRoot, { recursive: true, force: true }); }
  }
}

const matrix = await runStandardMatrix();
const expectedFamilies = ["line", "polyline", "circle", "arc", "ellipse", "spline", "text", "mtext", "leader", "dimension", "hatch", "blockRef"];
const expectedObjectNames = ["AcDbLine", "AcDbPolyline", "AcDbCircle", "AcDbArc", "AcDbEllipse", "AcDbSpline", "AcDbText", "AcDbMText", "AcDbLeader", "AcDbAlignedDimension", "AcDbHatch", "AcDbBlockReference"];
if (
  matrix.schemaVersion !== 1 || matrix.rowId !== "F-019" || !matrix.engineVersion?.startsWith("24.3") ||
  !matrix.automationProcessOwned || !matrix.automationProcessTerminated || !matrix.processSetRestored || !Number.isInteger(matrix.automationProcessId) ||
  matrix.referenceLength !== 1000 || matrix.newLength !== 2000 || matrix.factor !== 2 ||
  JSON.stringify(matrix.before?.map(({ family }) => family)) !== JSON.stringify(expectedFamilies) ||
  JSON.stringify(matrix.before?.map(({ objectName }) => objectName)) !== JSON.stringify(expectedObjectNames) ||
  matrix.checks?.length !== 12 || matrix.checks.some((check) =>
    !check.sameHandle || !check.scaledBounds || !check.propertiesPreserved || !check.undoRestored) ||
  matrix.copy?.entityCount !== 24 || matrix.copy?.undoCount !== 12 || matrix.copy?.checks?.length !== 12 ||
  matrix.copy?.checks?.some((check) => !check.found || !check.scaledBounds || !check.freshHandle || !check.propertiesPreserved) || !matrix.copy?.passed ||
  !matrix.inputModes?.standardNumeric?.passed || !matrix.inputModes?.dynamicDragPointProbe?.observed ||
  matrix.inputModes?.dynamicDragPointProbe?.certificationAuthority !== false ||
  !matrix.inputModes?.numericReferencePointTarget?.passed || !matrix.inputModes?.twoPointReferenceAndNewLength?.passed ||
  !matrix.inputModes?.factorOneNoOp?.passed || !matrix.inputModes?.factorOneNoOp?.undoBehaviorObserved ||
  !matrix.inputModes?.factorOneNoOp?.createsUndoEntry || matrix.inputModes?.factorOneNoOp?.revisionFree ||
  !matrix.inputModes?.zeroRefused?.passed ||
  !matrix.inputModes?.negativeRefused?.passed || !matrix.inputModes?.coincidentReferenceRefused?.passed ||
  !matrix.inputModes?.passed || !matrix.mixedLocked?.passed ||
  matrix.gate?.failedCount !== 0 || matrix.gate?.copyFailedCount !== 0 || !matrix.gate?.matrixPassed ||
  !matrix.gate?.copyPassed || !matrix.gate?.inputModesPassed || !matrix.gate?.mixedLockedPassed ||
  !matrix.userDocument?.isolatedOwnedProcess || !matrix.userDocument?.ownedDocumentsClean ||
  !matrix.userDocument?.blankRestored || matrix.cmdNamesAfter !== "" || matrix.status !== "PASS"
) throw new Error(`F-019 AutoCAD result mismatch: ${JSON.stringify(matrix)}`);

const result = {
  ...matrix,
  scriptSha256: sha256(await readFile(scriptPath)),
  matrixScriptSha256: sha256(await readFile(matrixScriptPath)),
  escapeHelperSha256: sha256(await readFile(escapeHelperPath)),
  observedAt: new Date().toISOString(),
};
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(`F-019 AutoCAD live PASS (${result.engineVersion}, SCALE Reference/Copy, 12 families, U, refused inputs, locked layer).`);
