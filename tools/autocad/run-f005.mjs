#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const root = process.cwd();
const executable = process.env.AUTOCAD_CORE ?? "C:\\Program Files\\Autodesk\\AutoCAD 2024\\accoreconsole.exe";
// Reuse the repository's allowlisted synthetic empty millimetre fixture. The
// F-005 script and independent hashes make an eventual live run reproducible.
const fixturePath = resolve(root, "parity/fixtures/F-003-empty-mm.dxf");
const scriptPath = resolve(root, "parity/autocad/F-005.scr");
const outputPath = resolve(root, process.argv[2] ?? "evidence/artifacts/F-005-autocad-readback.json");

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function runCoreConsole() {
  return new Promise((resolveRun, reject) => {
    const child = spawn(executable, ["/i", fixturePath, "/s", scriptPath, "/l", "en-US"], {
      cwd: root,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("F-005 AutoCAD Core Console exceeded the 60 second timeout."));
    }, 60_000);
    child.on("error", (error) => { clearTimeout(timeout); reject(error); });
    child.on("close", (code) => {
      clearTimeout(timeout);
      const output = Buffer.concat(stdout).toString("utf16le");
      const errorText = Buffer.concat(stderr).toString("utf16le");
      if (code !== 0) return reject(new Error(`F-005 AutoCAD Core Console exited ${code}: ${errorText}`));
      resolveRun(output);
    });
  });
}

function marker(stdout, name) {
  const matches = [...stdout.matchAll(new RegExp(`F005_${name}=([^"\\\\\\r\\n]+)`, "g"))];
  return matches.at(-1)?.[1]?.trim() ?? null;
}

const stdout = await runCoreConsole();
const arcs = (marker(stdout, "ARCS") ?? "").split(";").filter(Boolean).map((record) => {
  const [handle, layer, x, y, radius, startAngleDeg, endAngleDeg] = record.split(",");
  return {
    handle,
    layer,
    center: [Number(x), Number(y)],
    radius: Number(radius),
    startAngleDeg: Number(startAngleDeg),
    endAngleDeg: Number(endAngleDeg),
  };
});
const result = {
  schemaVersion: 1,
  rowId: "F-005",
  benchmark: "AutoCAD 2024.1.2 / Windows / 2D Drafting & Annotation",
  engine: "Autodesk AutoCAD Core Console 2024",
  engineVersion: marker(stdout, "ACADVER"),
  variants: [
    "3P",
    "Start-Center-End",
    "Start-Center-Angle",
    "Start-Center-Length",
    "Start-End-Angle",
    "Start-End-Direction",
    "Start-End-Radius",
    "Center-Start-End",
    "Center-Start-Angle",
    "Center-Start-Length",
  ],
  arcs,
  history: {
    before: Number(marker(stdout, "COUNT_BEFORE")),
    undo: Number(marker(stdout, "COUNT_UNDO")),
    redo: Number(marker(stdout, "COUNT_REDO")),
  },
  fixtureSha256: sha256(await readFile(fixturePath)),
  scriptSha256: sha256(await readFile(scriptPath)),
  observedAt: new Date().toISOString(),
  status: marker(stdout, "DONE") === "1" ? "PASS" : "FAIL",
};
const expected = [
  [0, 0, 10, 0, 180],
  [30, 0, 10, 0, 90],
  [60, 0, 10, 0, 90],
  [90, 0, 10, 0, 60],
  [125, 0, 5, 180, 0],
  [150, 10, 10, 270, 0],
  [180, 8.660254038, 10, 240, 300],
  [210, 0, 10, 0, 90],
  [240, 0, 10, 0, 90],
  [270, 0, 10, 0, 60],
];
const close = (actual, target) => Math.abs(actual - target) <= 1e-7;
if (!result.engineVersion?.startsWith("24.3") || arcs.length !== 10
  || expected.some(([x, y, radius, start, end], index) => !close(arcs[index]?.center[0], x)
    || !close(arcs[index]?.center[1], y) || !close(arcs[index]?.radius, radius)
    || !close(arcs[index]?.startAngleDeg, start) || !close(arcs[index]?.endAngleDeg, end))
  || arcs.some((arc) => !arc.handle || arc.layer !== "ARC_TEST")
  || result.history.before !== 10 || result.history.undo !== 9 || result.history.redo !== 10
  || result.status !== "PASS") {
  throw new Error(`F-005 AutoCAD result mismatch: ${JSON.stringify(result)}`);
}
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(`F-005 AutoCAD live PASS (${result.engineVersion}, ten ARC variants with Undo/Redo read-back).`);
