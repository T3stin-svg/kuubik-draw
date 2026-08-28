#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const root = process.cwd();
const scriptPath = resolve(root, "parity/autocad/F-020.scr");
const matrixScriptPath = resolve(root, "tools/autocad/f020-standard-matrix.ps1");
const escapeHelperPath = resolve(root, "tools/autocad/send-escape.ps1");
const outputPath = resolve(root, process.argv[2] ?? "evidence/artifacts/F-020-autocad-readback.json");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function runStandardMatrix() {
  return new Promise((resolveRun, reject) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", matrixScriptPath], {
      cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = []; const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    const timeout = setTimeout(() => { child.kill(); reject(new Error("AutoCAD F-020 matrix exceeded the 180 second timeout.")); }, 180_000);
    child.on("error", (error) => { clearTimeout(timeout); reject(error); });
    child.on("close", async (code) => {
      clearTimeout(timeout);
      const output = Buffer.concat(stdout).toString("utf8").trim();
      const errorText = Buffer.concat(stderr).toString("utf8").trim();
      const processMatch = output.match(/\[F-020\] automation-process pid=(\d+) owned=True/i);
      const automationProcessId = processMatch ? Number(processMatch[1]) : 0;
      let automationProcessTerminated = false;
      if (automationProcessId > 0) {
        try {
          process.kill(automationProcessId);
          for (let attempt = 0; attempt < 40; attempt += 1) {
            await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
            try { process.kill(automationProcessId, 0); } catch { automationProcessTerminated = true; break; }
          }
        } catch (error) {
          if (error?.code === "ESRCH") automationProcessTerminated = true;
          else return reject(new Error(`Could not terminate owned AutoCAD process ${automationProcessId}: ${error.message}`));
        }
      }
      if (automationProcessId > 0 && !automationProcessTerminated) return reject(new Error(`Owned AutoCAD process ${automationProcessId} remained after the F-020 matrix.`));
      if (code !== 0) return reject(new Error(`AutoCAD F-020 matrix exited ${code}: ${errorText || output}`));
      try {
        const start = output.indexOf("{"); const end = output.lastIndexOf("}");
        if (start < 0 || end < start) throw new Error("PowerShell output did not contain JSON.");
        resolveRun({ ...JSON.parse(output.slice(start, end + 1)), automationProcessTerminated });
      } catch (error) {
        reject(new Error(`AutoCAD F-020 JSON parse failed: ${error.message}\n${output}`));
      }
    });
  });
}

const matrix = await runStandardMatrix();
const expectedFamilies = ["line", "polyline", "circle", "arc", "ellipse", "spline", "text", "mtext", "leader", "dimension", "hatch", "blockRef"];
const expectedObjectNames = ["AcDbLine", "AcDbPolyline", "AcDbCircle", "AcDbArc", "AcDbEllipse", "AcDbSpline", "AcDbText", "AcDbMText", "AcDbLeader", "AcDbAlignedDimension", "AcDbHatch", "AcDbBlockReference"];
if (
  matrix.schemaVersion !== 1 || matrix.rowId !== "F-020" || !matrix.engineVersion?.startsWith("24.3") ||
  !matrix.automationProcessOwned || !matrix.automationProcessTerminated || !Number.isInteger(matrix.automationProcessId) ||
  matrix.mirrtext !== 0 || JSON.stringify(matrix.axisStart) !== JSON.stringify([1500, -500]) || JSON.stringify(matrix.axisEnd) !== JSON.stringify([1500, 1500]) ||
  JSON.stringify(matrix.before?.map(({ family }) => family)) !== JSON.stringify(expectedFamilies) ||
  JSON.stringify(matrix.before?.map(({ objectName }) => objectName)) !== JSON.stringify(expectedObjectNames) ||
  matrix.defaultNo?.entityCount !== 24 || matrix.defaultNo?.checks?.length !== 12 || matrix.defaultNo?.failed?.length !== 0 || !matrix.defaultNo?.undoPassed ||
  matrix.defaultNo?.checks?.some((check) => !check.found || !check.freshHandle || !check.reflectedGeometry || !check.propertiesPreserved || !check.familySemantics) ||
  matrix.eraseYes?.checks?.length !== 12 || matrix.eraseYes?.failed?.length !== 0 || !matrix.eraseYes?.undoPassed ||
  matrix.eraseYes?.checks?.some((check) => !check.stableHandle || !check.reflectedGeometry || !check.propertiesPreserved || !check.familySemantics) ||
  JSON.stringify(matrix.tiltedAxis?.axisStart) !== JSON.stringify([0, 0]) || JSON.stringify(matrix.tiltedAxis?.axisEnd) !== JSON.stringify([100, 100]) ||
  !matrix.tiltedAxis?.linePassed || !matrix.tiltedAxis?.textPassed || !matrix.tiltedAxis?.blockPassed || !matrix.tiltedAxis?.passed ||
  !matrix.mixedLocked?.passed || !matrix.coincidentAxis?.passed ||
  !matrix.userDocument?.isolatedOwnedProcess || !matrix.userDocument?.blankRestored || matrix.status !== "PASS"
) throw new Error(`F-020 AutoCAD result mismatch: ${JSON.stringify(matrix)}`);

const result = {
  ...matrix,
  scriptSha256: sha256(await readFile(scriptPath)),
  matrixScriptSha256: sha256(await readFile(matrixScriptPath)),
  escapeHelperSha256: sha256(await readFile(escapeHelperPath)),
  observedAt: new Date().toISOString(),
};
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(`F-020 AutoCAD live PASS (${result.engineVersion}, MIRROR default No/Yes, 12 families, 45-degree axis, U, locked layer, coincident refusal).`);
