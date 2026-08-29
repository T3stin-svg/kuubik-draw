#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

const root = process.cwd();
const matrixPath = resolve(root, "tools/autocad/f109-aci-palette.ps1");
const runnerPath = resolve(root, "tools/autocad/run-f109-aci-palette.mjs");
const paletteSourcePath = resolve(root, "packages/cad-core/src/aci-palette.ts");
const outputPath = resolve(root, process.argv[2] ?? "evidence/artifacts/F-109-autocad-aci-palette.json");
const tempRoot = await mkdtemp(resolve(tmpdir(), "KuubikDraw-F109-ACI-"));
const pidPath = resolve(tempRoot, "F109-ACI.pid");
const ownershipToken = randomUUID();
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

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

let processId = 0;
try {
  const child = await new Promise((resolveRun, rejectRun) => {
    const running = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", matrixPath, "-PidPath", pidPath, "-OwnershipToken", ownershipToken], { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const stdout = []; const stderr = []; let timedOut = false; let force;
    const timeout = setTimeout(() => { timedOut = true; running.kill(); force = setTimeout(() => { try { execFileSync("taskkill.exe", ["/PID", String(running.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }); } catch {} }, 5_000); }, 120_000);
    running.stdout.on("data", (chunk) => stdout.push(chunk)); running.stderr.on("data", (chunk) => stderr.push(chunk));
    running.on("error", rejectRun);
    running.on("close", (code) => { clearTimeout(timeout); clearTimeout(force); resolveRun({ code, timedOut, stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") }); });
  });
  processId = await ownedPid();
  if (child.timedOut) throw new Error(`AutoCAD F-109 ACI read-back timed out; authenticated PID=${processId || "missing"}.`);
  if (child.code !== 0) throw new Error(`AutoCAD F-109 ACI read-back exited ${child.code}: ${child.stderr || child.stdout}`);
  const start = child.stdout.indexOf("{"); const end = child.stdout.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("F-109 ACI PowerShell output did not contain JSON.");
  const matrix = JSON.parse(child.stdout.slice(start, end + 1));
  const sourceText = await readFile(paletteSourcePath, "utf8");
  const paletteLiteral = /=\s*(\[[\s\S]*?\])\s*as const/u.exec(sourceText)?.[1];
  if (!paletteLiteral) throw new Error("Could not read the checked-in ACI palette literal.");
  const checkedInPalette = [...paletteLiteral.matchAll(/"(#[0-9a-f]{6})"/gu)].map((match) => match[1]);
  if (checkedInPalette.length !== 255) throw new Error(`Checked-in ACI palette has ${checkedInPalette.length} entries instead of 255.`);
  const livePaletteSha256 = sha256(JSON.stringify(matrix.palette));
  const checkedInPaletteSha256 = sha256(JSON.stringify(checkedInPalette));
  const automationProcessTerminated = await terminate(processId);
  const processSetRestored = await restoredProcessSet();
  const checks = {
    exactAutoCadVersion: matrix.engineVersion?.startsWith("24.3"),
    exactly255Indices: matrix.palette?.length === 255,
    liveEqualsCheckedInPalette: livePaletteSha256 === checkedInPaletteSha256,
    exactKnownPaletteSha256: livePaletteSha256 === "5ff10c83691cd9934aecef90345b7435d4bbbc9e435a2853e9863cead6092d88",
    ownedProcess: matrix.automationProcessId === processId && matrix.automationProcessOwned === true,
    processTerminatedAndRestored: automationProcessTerminated && processSetRestored,
  };
  if (matrix.status !== "PASS" || Object.values(checks).some((value) => value !== true)) throw new Error(`F-109 AutoCAD ACI mismatch: ${JSON.stringify(checks)}`);
  const result = {
    ...matrix,
    livePaletteSha256,
    checkedInPaletteSha256,
    checks,
    automationProcessTerminated,
    processSetRestored,
    preExistingProcessIds,
    implementationSha256: {
      aciPalette: sha256(await readFile(paletteSourcePath)),
      autocadAciMatrix: sha256(await readFile(matrixPath)),
      autocadAciRunner: sha256(await readFile(runnerPath)),
    },
    observedAt: new Date().toISOString(),
  };
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(`F-109 AutoCAD live ACI palette PASS (${matrix.palette.length}/255, ${livePaletteSha256}).`);
} finally {
  try { if (!(processId > 0)) processId = await ownedPid(); if (processId > 0) await terminate(processId); }
  finally { await rm(tempRoot, { recursive: true, force: true }); }
}
