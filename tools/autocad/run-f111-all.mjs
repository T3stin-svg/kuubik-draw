#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const corePath = resolve(root, "evidence/artifacts/F-111-autocad-core-readback.json");
const desktopPath = resolve(root, "evidence/artifacts/F-111-autocad-desktop-readback.json");
const outputPath = resolve(root, "evidence/artifacts/F-111-autocad-readback.json");
const runnerPath = resolve(root, "tools/autocad/run-f111-all.mjs");
const crossCheckerPath = resolve(root, "tools/parity/check-f111-cross-evidence.mjs");
const packageLockPath = resolve(root, "package-lock.json");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function run(script) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, [resolve(root, script)], { cwd: root, windowsHide: true, stdio: "inherit" });
    child.on("error", rejectRun);
    child.on("close", (code) => code === 0 ? resolveRun() : rejectRun(new Error(`${script} exited ${code}`)));
  });
}

await run("tools/autocad/run-f111-desktop.mjs");
await run("tools/autocad/run-f111-core.mjs");
const coreBytes = await readFile(corePath);
const desktopBytes = await readFile(desktopPath);
const core = JSON.parse(coreBytes.toString("utf8"));
const desktop = JSON.parse(desktopBytes.toString("utf8"));
const closePoint = (left, right, tolerance = 0.001) => Array.isArray(left) && Array.isArray(right) && left.length === 2 && left.every((value, index) => Math.abs(value - right[index]) <= tolerance);
if (core.status !== "PASS" || desktop.status !== "PASS" || core.sourceSha256 !== desktop.sourceSha256 || core.totalEntities !== desktop.totalEntities || !closePoint(core.extents?.min, desktop.extents?.min) || !closePoint(core.extents?.max, desktop.extents?.max)) {
  throw new Error(`F-111 native readers disagree: ${JSON.stringify({ core, desktop })}`);
}
const result = {
  schemaVersion: 1,
  rowId: "F-111",
  authority: "autocad-2024.1.2-live",
  status: "PASS",
  observedAt: new Date().toISOString(),
  sourceSha256: core.sourceSha256,
  workflow: "Open the exact Chromium second-generation DXF in AutoCAD 2024 Core Console and a separately owned visible desktop AutoCAD process, read native entities/tables, close without saving, and restore the prior process set.",
  core,
  desktop,
  evidenceSha256: { core: sha256(coreBytes), desktop: sha256(desktopBytes) },
  implementationSha256: {
    autocadAll: sha256(await readFile(runnerPath)),
    crossChecker: sha256(await readFile(crossCheckerPath)),
    packageLock: sha256(await readFile(packageLockPath)),
    ...core.implementationSha256,
    ...desktop.implementationSha256,
  },
};
await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log("F-111 AutoCAD Core Console + desktop COM cross-read-back PASS.");
