#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const corePath = resolve(root, "evidence/artifacts/F-109-autocad-core-readback.json");
const desktopPath = resolve(root, "evidence/artifacts/F-109-autocad-desktop-readback.json");
const palettePath = resolve(root, "evidence/artifacts/F-109-autocad-aci-palette.json");
const outputPath = resolve(root, "evidence/artifacts/F-109-autocad-readback.json");
const runnerPath = resolve(root, "tools/autocad/run-f109-all.mjs");
const crossCheckerPath = resolve(root, "tools/parity/check-f109-cross-evidence.mjs");
const packageLockPath = resolve(root, "package-lock.json");
const semanticNormalizerPath = resolve(root, "tools/parity/f109-semantics.mjs");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
function run(script) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, [resolve(root, script)], { cwd: root, windowsHide: true, stdio: "inherit" });
    child.on("error", rejectRun); child.on("close", (code) => code === 0 ? resolveRun() : rejectRun(new Error(`${script} exited ${code}`)));
  });
}
await run("tools/autocad/run-f109-desktop.mjs");
await run("tools/autocad/run-f109-aci-palette.mjs");
await run("tools/autocad/run-f109.mjs");
const coreBytes = await readFile(corePath); const desktopBytes = await readFile(desktopPath); const paletteBytes = await readFile(palettePath);
const core = JSON.parse(coreBytes.toString("utf8")); const desktop = JSON.parse(desktopBytes.toString("utf8")); const palette = JSON.parse(paletteBytes.toString("utf8"));
const closePoint = (left, right, tolerance = 0.001) => Array.isArray(left) && Array.isArray(right) && left.length === 2 && left.every((value, index) => Math.abs(value - right[index]) <= tolerance);
if (core.status !== "PASS" || desktop.status !== "PASS" || palette.status !== "PASS" || Object.values(palette.checks ?? {}).some((value) => value !== true) || core.sourceSha256 !== desktop.sourceSha256 || core.totalEntities !== desktop.totalEntities || !closePoint(core.extents?.min, desktop.extents?.min) || !closePoint(core.extents?.max, desktop.extents?.max)) {
  throw new Error(`F-109 native readers disagree: ${JSON.stringify({ core, desktop, palette })}`);
}
const result = {
  schemaVersion: 1, rowId: "F-109", authority: "autocad-2024.1.2-live", status: "PASS",
  observedAt: new Date().toISOString(), sourceSha256: core.sourceSha256,
  workflow: "Open the exact Kuubik production DXF in AutoCAD 2024 Core Console and a separately owned visible desktop AutoCAD process, read native entities/tables, close without saving, and restore the prior process set.",
  core, desktop, palette,
  evidenceSha256: { core: sha256(coreBytes), desktop: sha256(desktopBytes), palette: sha256(paletteBytes) },
  implementationSha256: {
    autocadAll: sha256(await readFile(runnerPath)),
    crossChecker: sha256(await readFile(crossCheckerPath)),
    packageLock: sha256(await readFile(packageLockPath)),
    semanticNormalizer: sha256(await readFile(semanticNormalizerPath)),
    ...core.implementationSha256,
    ...desktop.implementationSha256,
    ...palette.implementationSha256,
  },
};
await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log("F-109 AutoCAD Core Console + desktop COM cross-read-back PASS.");
