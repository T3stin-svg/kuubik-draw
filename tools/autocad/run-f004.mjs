#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const root = process.cwd();
const executable = process.env.AUTOCAD_CORE ?? "C:\\Program Files\\Autodesk\\AutoCAD 2024\\accoreconsole.exe";
// Reuse the repository's allowlisted synthetic empty millimetre fixture. The
// F-004 script and their independent hashes still make this run reproducible.
const fixturePath = resolve(root, "parity/fixtures/F-003-empty-mm.dxf");
const scriptPath = resolve(root, "parity/autocad/F-004.scr");
const outputPath = resolve(root, process.argv[2] ?? "evidence/artifacts/F-004-autocad-readback.json");

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
      reject(new Error("F-004 AutoCAD Core Console exceeded the 60 second timeout."));
    }, 60_000);
    child.on("error", (error) => { clearTimeout(timeout); reject(error); });
    child.on("close", (code) => {
      clearTimeout(timeout);
      const output = Buffer.concat(stdout).toString("utf16le");
      const errorText = Buffer.concat(stderr).toString("utf16le");
      if (code !== 0) return reject(new Error(`F-004 AutoCAD Core Console exited ${code}: ${errorText}`));
      resolveRun(output);
    });
  });
}

function marker(stdout, name) {
  const matches = [...stdout.matchAll(new RegExp(`F004_${name}=([^"\\\\\\r\\n]+)`, "g"))];
  return matches.at(-1)?.[1]?.trim() ?? null;
}

const stdout = await runCoreConsole();
const circles = (marker(stdout, "CIRCLES") ?? "").split(";").filter(Boolean).map((record) => {
  const [handle, layer, x, y, radius] = record.split(",");
  return { handle, layer, center: [Number(x), Number(y)], radius: Number(radius) };
});
const result = {
  schemaVersion: 1,
  rowId: "F-004",
  benchmark: "AutoCAD 2024.1.2 / Windows / 2D Drafting & Annotation",
  engine: "Autodesk AutoCAD Core Console 2024",
  engineVersion: marker(stdout, "ACADVER"),
  variants: ["Center-Radius", "Center-Diameter", "2P", "3P", "TTR", "TTT"],
  circles,
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
const tttRadius = 20 - 10 * Math.SQRT2;
const expected = [
  [10, 10, 5],
  [30, 10, 4],
  [50, 10, 4],
  [70, 10, 5],
  [95, 5, 5],
  [120 + tttRadius, tttRadius, tttRadius],
];
const close = (actual, target) => Math.abs(actual - target) <= 1e-7;
if (!result.engineVersion?.startsWith("24.3") || circles.length !== 6
  || expected.some(([x, y, radius], index) => !close(circles[index]?.center[0], x) || !close(circles[index]?.center[1], y) || !close(circles[index]?.radius, radius))
  || circles.some((circle) => !circle.handle || circle.layer !== "CIRCLE_TEST")
  || result.history.before !== 6 || result.history.undo !== 5 || result.history.redo !== 6
  || result.status !== "PASS") {
  throw new Error(`F-004 AutoCAD result mismatch: ${JSON.stringify(result)}`);
}
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(`F-004 AutoCAD live PASS (${result.engineVersion}, six CIRCLE variants with Undo/Redo read-back).`);
