#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

const root = process.cwd();
const dxfPath = resolve(root, "evidence/artifacts/F-109-production.dxf");
const matrixPath = resolve(root, "tools/autocad/f109-desktop-readback.ps1");
const runnerPath = resolve(root, "tools/autocad/run-f109-desktop.mjs");
const expectedPath = resolve(root, "parity/expected/F-109.json");
const outputPath = resolve(root, process.argv[2] ?? "evidence/artifacts/F-109-autocad-desktop-readback.json");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const ownershipToken = randomUUID();
const tempRoot = await mkdtemp(resolve(tmpdir(), "KuubikDraw-F109-"));
const pidPath = resolve(tempRoot, "F109.pid");
const preExistingProcessIds = acadProcessIds();

function acadProcessIds() {
  const output = execFileSync("powershell.exe", ["-NoProfile", "-Command", "@(Get-Process acad -ErrorAction SilentlyContinue | ForEach-Object { $_.Id }) -join [Environment]::NewLine"], { windowsHide: true, encoding: "utf8" }).trim();
  return output ? output.split(/\r?\n/u).map(Number).filter((value) => Number.isInteger(value) && value > 0).toSorted((a, b) => a - b) : [];
}
function processIdentity(processId) {
  const script = `$process = Get-Process -Id ${processId} -ErrorAction SilentlyContinue; if ($process) { [ordered]@{ processId = [int]$process.Id; executablePath = [IO.Path]::GetFullPath([string]$process.Path); startTimeUtc = $process.StartTime.ToUniversalTime().ToString('o') } | ConvertTo-Json -Compress }; exit 0`;
  const output = execFileSync("powershell.exe", ["-NoProfile", "-Command", script], { windowsHide: true, encoding: "utf8" }).trim();
  return output ? JSON.parse(output) : null;
}
function identityMatches(sidecar, current) {
  return current?.processId === sidecar.processId
    && current.executablePath?.toLowerCase() === sidecar.executablePath.toLowerCase()
    && current.startTimeUtc === sidecar.startTimeUtc;
}
function newAutomationSidecars() {
  const existing = new Set(preExistingProcessIds);
  const script = "Get-CimInstance Win32_Process -Filter \"Name='acad.exe'\" | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress";
  const output = execFileSync("powershell.exe", ["-NoProfile", "-Command", script], { windowsHide: true, encoding: "utf8" }).trim();
  if (!output) return [];
  const records = JSON.parse(output);
  return (Array.isArray(records) ? records : [records])
    .filter((record) => !existing.has(Number(record.ProcessId)) && /\/Automation\s+-Embedding/iu.test(String(record.CommandLine ?? "")))
    .map((record) => processIdentity(Number(record.ProcessId)))
    .filter(Boolean);
}
async function ownedSidecar() {
  try {
    const sidecar = JSON.parse(await readFile(pidPath, "utf8"));
    if (sidecar.token !== ownershipToken || sidecar.owned !== true || !Number.isInteger(sidecar.processId) || sidecar.processId <= 0
      || typeof sidecar.executablePath !== "string" || !sidecar.executablePath.toLowerCase().endsWith("\\acad.exe")
      || typeof sidecar.startTimeUtc !== "string" || preExistingProcessIds.includes(sidecar.processId)) return null;
    return sidecar;
  } catch (error) { if (error?.code === "ENOENT") return null; throw error; }
}
async function terminate(sidecar) {
  if (!sidecar) return false;
  let current = processIdentity(sidecar.processId);
  if (!current) return true;
  if (!identityMatches(sidecar, current)) throw new Error(`Refusing to terminate PID ${sidecar.processId}: process identity changed after F-109 authentication.`);
  try { process.kill(sidecar.processId); } catch (error) { if (error?.code === "ESRCH") return true; throw error; }
  for (let attempt = 0; attempt < 80; attempt += 1) {
    await new Promise((done) => setTimeout(done, 100));
    current = processIdentity(sidecar.processId);
    if (!current) return true;
    if (!identityMatches(sidecar, current)) throw new Error(`PID ${sidecar.processId} was reused while waiting for F-109 AutoCAD termination.`);
  }
  return false;
}
async function restoredProcessSet() {
  const expected = preExistingProcessIds.join("|");
  for (let attempt = 0; attempt < 80; attempt += 1) { if (acadProcessIds().join("|") === expected) return true; await new Promise((done) => setTimeout(done, 100)); }
  return false;
}

let sidecar = null; let primaryError = null;
try {
  const child = await new Promise((resolveRun, rejectRun) => {
    const running = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", matrixPath, "-DxfPath", dxfPath, "-ExpectedPath", expectedPath, "-PidPath", pidPath, "-OwnershipToken", ownershipToken], { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const stdout = []; const stderr = []; let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      try { execFileSync("taskkill.exe", ["/PID", String(running.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }); }
      catch { running.kill(); }
    }, 120_000);
    running.stdout.on("data", (chunk) => stdout.push(chunk)); running.stderr.on("data", (chunk) => stderr.push(chunk));
    running.on("error", (error) => { clearTimeout(timeout); rejectRun(error); });
    running.on("close", (code) => { clearTimeout(timeout); resolveRun({ code, timedOut, stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") }); });
  });
  sidecar = await ownedSidecar();
  const processId = sidecar?.processId ?? 0;
  if (child.timedOut) throw new Error(`AutoCAD F-109 desktop read-back timed out; authenticated PID=${processId || "missing"}.`);
  if (child.code !== 0) throw new Error(`AutoCAD F-109 desktop read-back exited ${child.code}: ${child.stderr || child.stdout}`);
  const start = child.stdout.indexOf("{"); const end = child.stdout.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("F-109 desktop PowerShell output did not contain JSON.");
  const matrix = JSON.parse(child.stdout.slice(start, end + 1));
  const expected = JSON.parse(await readFile(expectedPath, "utf8"));
  if (matrix.automationProcessId !== processId) throw new Error("F-109 desktop PID sidecar and COM read-back disagreed.");
  if (JSON.stringify(Object.keys(matrix.nativeRecords ?? {}).sort()) !== JSON.stringify(Object.keys(expected.semanticSha256ByHandle).sort())) {
    throw new Error("F-109 desktop native handle set differs from the fixed semantic manifest.");
  }
  const closePoint = (actual, wanted, tolerance = 0.001) => Array.isArray(actual) && Array.isArray(wanted) && actual.length === 2 && actual.every((value, index) => Math.abs(value - wanted[index]) <= tolerance);
  if (!closePoint(matrix.extents?.min, expected.autoCadExtents?.min) || !closePoint(matrix.extents?.max, expected.autoCadExtents?.max)) {
    throw new Error(`F-109 desktop extents differ from the live golden: ${JSON.stringify(matrix.extents)}`);
  }
  if (JSON.stringify(matrix.polylineClosuresAfterFirstRegen) !== JSON.stringify(expected.nativePolylineClosedByHandle) || JSON.stringify(matrix.polylineClosuresAfterRegen) !== JSON.stringify(expected.nativePolylineClosedByHandle)) {
    throw new Error(`F-109 desktop polyline closures did not produce two consecutive exact golden snapshots: ${JSON.stringify(matrix.polylineClosurePasses)}`);
  }
  const automationProcessTerminated = await terminate(sidecar);
  const processSetRestored = await restoredProcessSet();
  if (matrix.status !== "PASS" || !matrix.engineVersion?.startsWith("24.3") || !matrix.automationProcessOwned || !automationProcessTerminated || !processSetRestored || Object.values(matrix.checks ?? {}).some((value) => value !== true)) {
    throw new Error(`F-109 desktop AutoCAD mismatch: ${JSON.stringify({ matrix, automationProcessTerminated, processSetRestored })}`);
  }
  const result = {
    ...matrix,
    sourceSha256: sha256(await readFile(dxfPath)),
    matrixScriptSha256: sha256(await readFile(matrixPath)),
    runnerScriptSha256: sha256(await readFile(runnerPath)),
    implementationSha256: {
      autocadDesktopMatrix: sha256(await readFile(matrixPath)),
      autocadDesktop: sha256(await readFile(runnerPath)),
      expected: sha256(await readFile(expectedPath)),
    },
    automationProcessTerminated,
    processSetRestored,
    preExistingProcessIds,
    observedAt: new Date().toISOString(),
  };
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(`F-109 desktop AutoCAD live PASS (${result.engineVersion}, ${result.totalEntities} native entities).`);
} catch (error) {
  primaryError = error;
  throw error;
} finally {
  const cleanupErrors = [];
  try {
    if (!sidecar) sidecar = await ownedSidecar();
    if (!sidecar) {
      const orphanCandidates = newAutomationSidecars();
      if (orphanCandidates.length === 1) sidecar = orphanCandidates[0];
      else if (orphanCandidates.length > 1) cleanupErrors.push(new Error(`F-109 found multiple unauthenticated AutoCAD automation processes: ${orphanCandidates.map(({ processId }) => processId).join(", ")}`));
    }
    if (sidecar && !await terminate(sidecar)) cleanupErrors.push(new Error(`Owned AutoCAD process ${sidecar.processId} remained after F-109 desktop cleanup.`));
  } catch (error) { cleanupErrors.push(error); }
  try { if (!await restoredProcessSet()) cleanupErrors.push(new Error("F-109 desktop AutoCAD process set was not restored during cleanup.")); }
  catch (error) { cleanupErrors.push(error); }
  try { await rm(tempRoot, { recursive: true, force: true }); } catch (error) { cleanupErrors.push(error); }
  if (cleanupErrors.length > 0) throw new AggregateError(primaryError ? [primaryError, ...cleanupErrors] : cleanupErrors, "F-109 desktop cleanup verification failed.");
}
