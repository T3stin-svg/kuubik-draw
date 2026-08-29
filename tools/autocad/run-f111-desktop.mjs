#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

const root = process.cwd();
const dxfPath = resolve(root, "evidence/artifacts/F-111-browser-roundtrip.dxf");
const matrixPath = resolve(root, "tools/autocad/f109-desktop-readback.ps1");
const runnerPath = resolve(root, "tools/autocad/run-f111-desktop.mjs");
const expectedPath = resolve(root, "parity/expected/F-109.json");
const outputPath = resolve(root, process.argv[2] ?? "evidence/artifacts/F-111-autocad-desktop-readback.json");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const ownershipToken = randomUUID();
const tempRoot = await mkdtemp(resolve(tmpdir(), "KuubikDraw-F111-"));
const pidPath = resolve(tempRoot, "F111.pid");
const preExistingProcessIds = acadProcessIds();

function acadProcessIds() {
  const output = execFileSync("powershell.exe", ["-NoProfile", "-Command", "@(Get-Process acad -ErrorAction SilentlyContinue | ForEach-Object { $_.Id }) -join [Environment]::NewLine"], { windowsHide: true, encoding: "utf8" }).trim();
  return output ? output.split(/\r?\n/u).map(Number).filter((value) => Number.isInteger(value) && value > 0).toSorted((a, b) => a - b) : [];
}
function newAutomationProcessIds() {
  const existing = new Set(preExistingProcessIds);
  const script = "Get-CimInstance Win32_Process -Filter \"Name='acad.exe'\" | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress";
  const output = execFileSync("powershell.exe", ["-NoProfile", "-Command", script], { windowsHide: true, encoding: "utf8" }).trim();
  if (!output) return [];
  const records = JSON.parse(output);
  return (Array.isArray(records) ? records : [records])
    .filter((record) => !existing.has(Number(record.ProcessId)) && /\/Automation\s+-Embedding/iu.test(String(record.CommandLine ?? "")))
    .map((record) => Number(record.ProcessId));
}
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

let processId = 0;
try {
  const child = await new Promise((resolveRun, rejectRun) => {
    const running = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", matrixPath, "-DxfPath", dxfPath, "-PidPath", pidPath, "-OwnershipToken", ownershipToken], {
      cwd: root,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    let timedOut = false;
    let force;
    const timeout = setTimeout(() => {
      timedOut = true;
      running.kill();
      force = setTimeout(() => {
        try { execFileSync("taskkill.exe", ["/PID", String(running.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }); } catch {}
      }, 5000);
    }, 120_000);
    running.stdout.on("data", (chunk) => stdout.push(chunk));
    running.stderr.on("data", (chunk) => stderr.push(chunk));
    running.on("error", rejectRun);
    running.on("close", (code) => {
      clearTimeout(timeout);
      clearTimeout(force);
      resolveRun({ code, timedOut, stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") });
    });
  });
  processId = await ownedPid();
  if (child.timedOut) throw new Error(`AutoCAD F-111 desktop read-back timed out; authenticated PID=${processId || "missing"}.`);
  if (child.code !== 0) throw new Error(`AutoCAD F-111 desktop read-back exited ${child.code}: ${child.stderr || child.stdout}`);
  const start = child.stdout.indexOf("{");
  const end = child.stdout.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("F-111 desktop PowerShell output did not contain JSON.");
  const matrix = JSON.parse(child.stdout.slice(start, end + 1));
  const expected = JSON.parse(await readFile(expectedPath, "utf8"));
  if (matrix.automationProcessId !== processId) throw new Error("F-111 desktop PID sidecar and COM read-back disagreed.");
  if (JSON.stringify(Object.keys(matrix.nativeRecords ?? {}).sort()) !== JSON.stringify(Object.keys(expected.semanticSha256ByHandle).sort())) {
    throw new Error("F-111 desktop native handle set differs from the fixed semantic manifest.");
  }
  const closePoint = (actual, wanted, tolerance = 0.001) => Array.isArray(actual) && Array.isArray(wanted) && actual.length === 2 && actual.every((value, index) => Math.abs(value - wanted[index]) <= tolerance);
  if (!closePoint(matrix.extents?.min, expected.autoCadExtents?.min) || !closePoint(matrix.extents?.max, expected.autoCadExtents?.max)) {
    throw new Error(`F-111 desktop extents differ from the live golden: ${JSON.stringify(matrix.extents)}`);
  }
  const automationProcessTerminated = await terminate(processId);
  const processSetRestored = await restoredProcessSet();
  if (matrix.status !== "PASS" || !matrix.engineVersion?.startsWith("24.3") || !matrix.automationProcessOwned || !automationProcessTerminated || !processSetRestored || Object.values(matrix.checks ?? {}).some((value) => value !== true)) {
    throw new Error(`F-111 desktop AutoCAD mismatch: ${JSON.stringify({ matrix, automationProcessTerminated, processSetRestored })}`);
  }
  const result = {
    ...matrix,
    rowId: "F-111",
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
  console.log(`F-111 desktop AutoCAD live PASS (${result.engineVersion}, ${result.totalEntities} native entities).`);
} finally {
  try {
    if (!(processId > 0)) processId = await ownedPid();
    if (processId > 0) {
      await terminate(processId);
    } else {
      // AutoCAD can launch its COM server and still reject the first COM call
      // before the PID sidecar exists. Clean up only one new /Automation
      // process that was absent from the immutable pre-run process set.
      const orphanCandidates = newAutomationProcessIds();
      if (orphanCandidates.length === 1) await terminate(orphanCandidates[0]);
      else if (orphanCandidates.length > 1) throw new Error(`F-111 found multiple unauthenticated AutoCAD automation processes: ${orphanCandidates.join(", ")}`);
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}
