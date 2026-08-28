#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const root = process.cwd();
const executable = process.env.AUTOCAD_CORE ?? "C:\\Program Files\\Autodesk\\AutoCAD 2024\\accoreconsole.exe";
const fixturePath = resolve(root, "parity/fixtures/F-015-empty-mm.dxf");
const scriptPath = resolve(root, "parity/autocad/F-015.scr");
const outputPath = resolve(root, process.argv[2] ?? "evidence/artifacts/F-015-autocad-readback.json");

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

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
      reject(new Error("AutoCAD Core Console exceeded the 45 second timeout."));
    }, 45_000);
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
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
  const matches = [...stdout.matchAll(new RegExp(`F015_${name}=([^"\\\\\\r\\n]+)`, "g"))];
  return matches.at(-1)?.[1]?.trim() ?? null;
};
const result = {
  schemaVersion: 1,
  rowId: "F-015",
  benchmark: "AutoCAD 2024.1.2 / Windows / 2D Drafting & Annotation",
  engine: "Autodesk AutoCAD Core Console 2024",
  engineVersion: marker("ACADVER"),
  command: "ERASE",
  result: {
    before: Number(marker("BEFORE")),
    afterErase: Number(marker("AFTER_ERASE")),
    afterUndo: Number(marker("AFTER_UNDO")),
    afterLockedErase: Number(marker("AFTER_LOCKED")),
    lockedLayerSurvived: marker("LOCKED_SURVIVED") === "1",
  },
  fixtureSha256: sha256(await readFile(fixturePath)),
  scriptSha256: sha256(await readFile(scriptPath)),
  observedAt: new Date().toISOString(),
  status: marker("DONE") === "1" ? "PASS" : "FAIL",
};
if (
  !result.engineVersion?.startsWith("24.3") ||
  result.result.before !== 3 || result.result.afterErase !== 1 || result.result.afterUndo !== 3 ||
  result.result.afterLockedErase !== 3 || !result.result.lockedLayerSurvived || result.status !== "PASS"
) {
  throw new Error(`F-015 AutoCAD result mismatch: ${JSON.stringify(result)}`);
}
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(`F-015 AutoCAD live PASS (${result.engineVersion}, 3 -> 1 -> 3, locked survives).`);
