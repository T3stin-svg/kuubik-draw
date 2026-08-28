#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const root = process.cwd();
const scriptPath = resolve(root, "parity/autocad/F-017.scr");
const matrixScriptPath = resolve(root, "tools/autocad/f017-standard-matrix.ps1");
const outputPath = resolve(root, process.argv[2] ?? "evidence/artifacts/F-017-autocad-readback.json");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function runStandardMatrix() {
  return new Promise((resolveRun, reject) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", matrixScriptPath], {
      cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    const timeout = setTimeout(() => { child.kill(); reject(new Error("AutoCAD F-017 matrix exceeded the 120 second timeout.")); }, 120_000);
    child.on("error", (error) => { clearTimeout(timeout); reject(error); });
    child.on("close", (code) => {
      clearTimeout(timeout);
      const output = Buffer.concat(stdout).toString("utf8").trim();
      const errorText = Buffer.concat(stderr).toString("utf8").trim();
      if (code !== 0) return reject(new Error(`AutoCAD F-017 matrix exited ${code}: ${errorText || output}`));
      try {
        const start = output.indexOf("{");
        const end = output.lastIndexOf("}");
        if (start < 0 || end < start) throw new Error("PowerShell output did not contain JSON.");
        resolveRun(JSON.parse(output.slice(start, end + 1)));
      } catch (error) {
        reject(new Error(`AutoCAD F-017 JSON parse failed: ${error.message}\n${output}`));
      }
    });
  });
}

const matrix = await runStandardMatrix();
const expectedFamilies = ["line", "polyline", "circle", "arc", "ellipse", "spline", "text", "mtext", "leader", "dimension", "hatch", "blockRef"];
const expectedObjectNames = ["AcDbLine", "AcDbPolyline", "AcDbCircle", "AcDbArc", "AcDbEllipse", "AcDbSpline", "AcDbText", "AcDbMText", "AcDbLeader", "AcDbAlignedDimension", "AcDbHatch", "AcDbBlockReference"];
if (
  matrix.schemaVersion !== 1 || matrix.rowId !== "F-017" || !matrix.engineVersion?.startsWith("24.3") ||
  JSON.stringify(matrix.vectors) !== JSON.stringify([[500, 750], [-300, 100]]) ||
  JSON.stringify(matrix.before?.map(({ family }) => family)) !== JSON.stringify(expectedFamilies) ||
  JSON.stringify(matrix.before?.map(({ objectName }) => objectName)) !== JSON.stringify(expectedObjectNames) ||
  matrix.checks?.length !== 12 || matrix.checks.some((check) =>
    check.count !== 3 || !check.originalPresent || !check.firstCopy || !check.secondCopy ||
    !check.propertiesPreserved || !check.uniqueHandles || !check.undoRestored) ||
  matrix.mixedLocked?.checks?.editableCount !== 2 || matrix.mixedLocked?.checks?.lockedCount !== 1 ||
  !matrix.mixedLocked?.checks?.editableCopied || !matrix.mixedLocked?.checks?.lockedUnchanged ||
  matrix.cmdNamesAfter !== "" || matrix.status !== "PASS"
) throw new Error(`F-017 AutoCAD result mismatch: ${JSON.stringify(matrix)}`);

const result = {
  ...matrix,
  scriptSha256: sha256(await readFile(scriptPath)),
  matrixScriptSha256: sha256(await readFile(matrixScriptPath)),
  observedAt: new Date().toISOString(),
};
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(`F-017 AutoCAD live PASS (${result.engineVersion}, repeated COPY, 12 families, U, locked layer).`);
