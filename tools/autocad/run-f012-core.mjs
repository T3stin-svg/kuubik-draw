#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseF012CoreOutput, validateF012CoreResult } from "./f012-core-evidence.mjs";

const root = process.cwd();
const executable = process.env.AUTOCAD_CORE ?? "C:\\Program Files\\Autodesk\\AutoCAD 2024\\accoreconsole.exe";
const fixturePath = resolve(root, "parity/fixtures/F-003-empty-mm.dxf");
const scriptPath = resolve(root, "parity/autocad/F-012.scr");
const runnerPath = resolve(root, "tools/autocad/run-f012-core.mjs");
const parserPath = resolve(root, "tools/autocad/f012-core-evidence.mjs");
const outputPath = resolve(root, process.argv[2] ?? "evidence/artifacts/F-012-autocad-core-readback.json");
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
      reject(new Error("F-012 AutoCAD Core Console exceeded the 45 second timeout."));
    }, 45_000);
    child.on("error", (error) => { clearTimeout(timeout); reject(error); });
    child.on("close", (code) => {
      clearTimeout(timeout);
      const out = Buffer.concat(stdout).toString("utf16le");
      const errorText = Buffer.concat(stderr).toString("utf16le");
      if (code !== 0) return reject(new Error(`F-012 AutoCAD Core Console exited ${code}: ${errorText || out}`));
      resolveRun(out);
    });
  });
}

const result = parseF012CoreOutput(await runCoreConsole());
const checks = validateF012CoreResult(result);
if (Object.values(checks).some((value) => value !== true)) throw new Error(`F-012 AutoCAD core result mismatch: ${JSON.stringify({ result, checks })}`);
const report = {
  schemaVersion: 1,
  rowId: "F-012",
  benchmark: "AutoCAD 2024.1.2 / Windows / 2D Drafting & Annotation",
  engine: "Autodesk AutoCAD Core Console 2024",
  certificationAuthority: true,
  certificationScope: "SPLINE Fit creation, pointer tangents, zero/non-zero Fit Tolerance and mirrored bound probes, PEDIT spline-fit polyline Object conversion, plus SPLINEDIT Reverse/Open/Close/Fit Kink/CV Add/CV Elevate/Convert to Polyline/command-local Undo subset; not the complete F-012 matrix",
  workflow: "synthetic scratch DXF; command-line SPLINE and repeated SPLINEDIT prompts; no user document",
  ...result,
  checks,
  executableSha256: sha256(await readFile(executable)),
  fixtureSha256: sha256(await readFile(fixturePath)),
  scriptSha256: sha256(await readFile(scriptPath)),
  runnerSha256: sha256(await readFile(runnerPath)),
  parserSha256: sha256(await readFile(parserPath)),
  observedAt: new Date().toISOString(),
  status: "PASS",
};
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log("F-012 AutoCAD 2024 Core Console SPLINE/SPLINEDIT subset PASS.");
