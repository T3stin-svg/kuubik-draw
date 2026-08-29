#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

const root = process.cwd();
const scriptPath = resolve(root, "parity/autocad/F-021.scr");
const matrixScriptPath = resolve(root, "tools/autocad/f021-standard-matrix.ps1");
const runnerScriptPath = resolve(root, "tools/autocad/run-f021.mjs");
const outputPath = resolve(root, process.argv[2] ?? "evidence/artifacts/F-021-autocad-readback.json");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const tempRoot = await mkdtemp(resolve(tmpdir(), "KuubikDraw-F021-"));
const pidPath = resolve(tempRoot, "F021.pid");
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
      const stdout = []; const stderr = [];
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
    if (childResult.timedOut) throw new Error(`AutoCAD F-021 matrix exceeded the 180 second timeout; authenticated PID=${processId || "missing"}.`);
    if (childResult.code !== 0) throw new Error(`AutoCAD F-021 matrix exited ${childResult.code} after cleanup ${JSON.stringify({ processId, automationProcessTerminated, processSetRestored })}: ${childResult.errorText || childResult.output}`);
    if (!(processId > 0) || !automationProcessTerminated || !processSetRestored) throw new Error(`F-021 did not restore its owned AutoCAD process: ${JSON.stringify({ processId, automationProcessTerminated, processSetRestored })}`);
    const start = childResult.output.indexOf("{"); const end = childResult.output.lastIndexOf("}");
    if (start < 0 || end < start) throw new Error("PowerShell output did not contain JSON.");
    return { ...JSON.parse(childResult.output.slice(start, end + 1)), automationProcessTerminated, processSetRestored, preExistingProcessIds };
  } finally {
    try { if (!(processId > 0)) processId = await ownedPid(); if (processId > 0) await terminate(processId); }
    finally { await rm(tempRoot, { recursive: true, force: true }); }
  }
}

const matrix = await runStandardMatrix();
const expectedFamilies = ["line", "polyline", "circle", "arc", "ellipse"];
if (
  matrix.schemaVersion !== 1 || matrix.rowId !== "F-021" || !matrix.engineVersion?.startsWith("24.3") ||
  !matrix.automationProcessOwned || !matrix.automationProcessTerminated || !matrix.processSetRestored || !Number.isInteger(matrix.automationProcessId) ||
  matrix.offsetLayer !== "Source-explicit" || Object.values(matrix.options ?? {}).some((value) => value !== true) ||
  JSON.stringify(matrix.familyChecks?.map(({ family }) => family)) !== JSON.stringify(expectedFamilies) ||
  matrix.familyChecks?.some((check) => !check.passed) || Object.values(matrix.extendedChecks ?? {}).some((value) => value !== true) ||
  matrix.lockedLayer?.behavior !== "refused" || !matrix.lockedLayer?.passed ||
  !matrix.userDocument?.isolatedOwnedProcess || !matrix.userDocument?.blankRestored || matrix.status !== "PASS"
) throw new Error(`F-021 AutoCAD result mismatch: ${JSON.stringify(matrix)}`);

const result = {
  ...matrix,
  scriptSha256: sha256(await readFile(scriptPath)),
  matrixScriptSha256: sha256(await readFile(matrixScriptPath)),
  runnerScriptSha256: sha256(await readFile(runnerScriptPath)),
  observedAt: new Date().toISOString(),
};
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(`F-021 AutoCAD live PASS (${result.engineVersion}, six options, five geometry families, closed/bulged/invalid edge matrix, locked-layer behavior=${result.lockedLayer.behavior}).`);
