#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const root = process.cwd();
const scriptPath = resolve(root, "parity/autocad/F-021.scr");
const matrixScriptPath = resolve(root, "tools/autocad/f021-standard-matrix.ps1");
const outputPath = resolve(root, process.argv[2] ?? "evidence/artifacts/F-021-autocad-readback.json");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function runStandardMatrix() {
  return new Promise((resolveRun, reject) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", matrixScriptPath], {
      cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = []; const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    const timeout = setTimeout(() => { child.kill(); reject(new Error("AutoCAD F-021 matrix exceeded the 180 second timeout.")); }, 180_000);
    child.on("error", (error) => { clearTimeout(timeout); reject(error); });
    child.on("close", async (code) => {
      clearTimeout(timeout);
      const output = Buffer.concat(stdout).toString("utf8").trim();
      const errorText = Buffer.concat(stderr).toString("utf8").trim();
      const processMatch = output.match(/\[F-021\] automation-process pid=(\d+) owned=True/i);
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
      if (automationProcessId > 0 && !automationProcessTerminated) return reject(new Error(`Owned AutoCAD process ${automationProcessId} remained after F-021.`));
      if (code !== 0) return reject(new Error(`AutoCAD F-021 matrix exited ${code}: ${errorText || output}`));
      try {
        const start = output.indexOf("{"); const end = output.lastIndexOf("}");
        if (start < 0 || end < start) throw new Error("PowerShell output did not contain JSON.");
        resolveRun({ ...JSON.parse(output.slice(start, end + 1)), automationProcessTerminated });
      } catch (error) {
        reject(new Error(`AutoCAD F-021 JSON parse failed: ${error.message}\n${output}`));
      }
    });
  });
}

const matrix = await runStandardMatrix();
const expectedFamilies = ["line", "polyline", "circle", "arc", "ellipse"];
if (
  matrix.schemaVersion !== 1 || matrix.rowId !== "F-021" || !matrix.engineVersion?.startsWith("24.3") ||
  !matrix.automationProcessOwned || !matrix.automationProcessTerminated || !Number.isInteger(matrix.automationProcessId) ||
  matrix.offsetLayer !== "Source-explicit" || Object.values(matrix.options ?? {}).some((value) => value !== true) ||
  JSON.stringify(matrix.familyChecks?.map(({ family }) => family)) !== JSON.stringify(expectedFamilies) ||
  matrix.familyChecks?.some((check) => !check.passed) || Object.values(matrix.extendedChecks ?? {}).some((value) => value !== true) ||
  matrix.lockedLayer?.behavior !== "refused" || !matrix.lockedLayer?.passed ||
  !matrix.userDocument?.isolatedOwnedProcess || !matrix.userDocument?.blankRestored || matrix.status !== "PASS"
) throw new Error(`F-021 AutoCAD result mismatch: ${JSON.stringify(matrix)}`);

const result = {
  ...matrix,
  scriptSha256: sha256(await readFile(scriptPath)),
  matrixScriptSha256: sha256(await readFile(matrixScriptPath)),
  observedAt: new Date().toISOString(),
};
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(`F-021 AutoCAD live PASS (${result.engineVersion}, six options, five geometry families, closed/bulged/invalid edge matrix, locked-layer behavior=${result.lockedLayer.behavior}).`);
