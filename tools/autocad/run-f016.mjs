#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const root = process.cwd();
const executable = process.env.AUTOCAD_CORE ?? "C:\\Program Files\\Autodesk\\AutoCAD 2024\\accoreconsole.exe";
const fixturePath = resolve(root, "parity/fixtures/F-016-empty-mm.dxf");
const scriptPath = resolve(root, "parity/autocad/F-016.scr");
const outputPath = resolve(root, process.argv[2] ?? "evidence/artifacts/F-016-autocad-readback.json");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function runCoreConsole() {
  return new Promise((resolveRun, reject) => {
    const child = spawn(executable, ["/i", fixturePath, "/s", scriptPath, "/l", "en-US"], {
      cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    const timeout = setTimeout(() => { child.kill(); reject(new Error("AutoCAD Core Console exceeded the 45 second timeout.")); }, 45_000);
    child.on("error", (error) => { clearTimeout(timeout); reject(error); });
    child.on("close", (code) => {
      clearTimeout(timeout);
      const out = Buffer.concat(stdout).toString("utf16le");
      const errorText = Buffer.concat(stderr).toString("utf16le");
      if (code !== 0) return reject(new Error(`AutoCAD Core Console exited ${code}: ${errorText}`));
      resolveRun(out);
    });
  });
}

const stdout = await runCoreConsole();
const marker = (name) => {
  const matches = [...stdout.matchAll(new RegExp(`F016_${name}=([^"\\\\\\r\\n]+)`, "g"))];
  return matches.at(-1)?.[1]?.trim() ?? null;
};
const point = (name) => marker(name)?.split(",").map(Number) ?? null;
const result = {
  schemaVersion: 1,
  rowId: "F-016",
  benchmark: "AutoCAD 2024.1.2 / Windows / 2D Drafting & Annotation",
  engine: "Autodesk AutoCAD Core Console 2024",
  engineVersion: marker("ACADVER"),
  command: "MOVE",
  result: {
    vector: [500, 750],
    after: [
      { start: point("AFTER1_START"), end: point("AFTER1_END") },
      { start: point("AFTER2_START"), end: point("AFTER2_END") },
    ],
    afterUndo: [
      { start: point("UNDO1_START"), end: point("UNDO1_END") },
      { start: point("UNDO2_START"), end: point("UNDO2_END") },
    ],
    mixed: { editableStarts: [point("MIX1_START"), point("MIX2_START")], lockedStart: point("LOCKED_START") },
  },
  fixtureSha256: sha256(await readFile(fixturePath)),
  scriptSha256: sha256(await readFile(scriptPath)),
  observedAt: new Date().toISOString(),
  status: marker("DONE") === "1" ? "PASS" : "FAIL",
};
if (
  !result.engineVersion?.startsWith("24.3") ||
  JSON.stringify(result.result.after) !== JSON.stringify([
    { start: [510, 760], end: [680, 840] }, { start: [500, 1750], end: [1500, 2250] },
  ]) ||
  JSON.stringify(result.result.afterUndo) !== JSON.stringify([
    { start: [10, 10], end: [180, 90] }, { start: [0, 1000], end: [1000, 1500] },
  ]) ||
  JSON.stringify(result.result.mixed) !== JSON.stringify({ editableStarts: [[110, 60], [100, 1050]], lockedStart: [0, 2000] }) ||
  result.status !== "PASS"
) throw new Error(`F-016 AutoCAD result mismatch: ${JSON.stringify(result)}`);

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(`F-016 AutoCAD live PASS (${result.engineVersion}, exact +500/+750, U, locked layer).`);
