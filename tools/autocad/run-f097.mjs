#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const root = process.cwd();
const scriptPath = resolve(root, "parity/autocad/F-097.scr");
const matrixScriptPath = resolve(root, "tools/autocad/f097-layout-tabs.ps1");
const outputPath = resolve(root, process.argv[2] ?? "evidence/artifacts/F-097-autocad-readback.json");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function runMatrix() {
  return new Promise((resolveRun, reject) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", matrixScriptPath], {
      cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = []; const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    const timeout = setTimeout(() => { child.kill(); reject(new Error("AutoCAD F-097 matrix exceeded the 300 second timeout.")); }, 300_000);
    child.on("error", (error) => { clearTimeout(timeout); reject(error); });
    child.on("close", async (code) => {
      clearTimeout(timeout);
      const output = Buffer.concat(stdout).toString("utf8").trim();
      const errorText = Buffer.concat(stderr).toString("utf8").trim();
      const processMatch = output.match(/\[F-097\] automation-process pid=(\d+) owned=True/i);
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
      if (automationProcessId > 0 && !automationProcessTerminated) return reject(new Error(`Owned AutoCAD process ${automationProcessId} remained after F-097.`));
      if (code !== 0) return reject(new Error(`AutoCAD F-097 matrix exited ${code}: ${errorText || output}`));
      try {
        const start = output.indexOf("{"); const end = output.lastIndexOf("}");
        if (start < 0 || end < start) throw new Error("PowerShell output did not contain JSON.");
        resolveRun({ ...JSON.parse(output.slice(start, end + 1)), automationProcessTerminated });
      } catch (error) {
        reject(new Error(`AutoCAD F-097 JSON parse failed: ${error.message}\n${output}`));
      }
    });
  });
}

const matrix = await runMatrix();
if (
  matrix.schemaVersion !== 1 || matrix.rowId !== "F-097" || !matrix.engineVersion?.startsWith("24.3") ||
  !matrix.automationProcessOwned || !matrix.automationProcessTerminated || !Number.isInteger(matrix.automationProcessId) ||
  Object.values(matrix.checks ?? {}).some((value) => value !== true) || matrix.activeAfterDelete !== "F097 PLAN" ||
  matrix.dwg?.bytes <= 0 || !/^[a-f0-9]{64}$/.test(matrix.dwg?.sha256 ?? "") || matrix.dwg?.retained !== false ||
  !matrix.userDocument?.isolatedOwnedProcess || !matrix.userDocument?.blankRestored || matrix.status !== "PASS"
) throw new Error(`F-097 AutoCAD result mismatch: ${JSON.stringify(matrix)}`);

const result = {
  ...matrix,
  scriptSha256: sha256(await readFile(scriptPath)),
  matrixScriptSha256: sha256(await readFile(matrixScriptPath)),
  observedAt: new Date().toISOString(),
};
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(`F-097 AutoCAD live PASS (${result.engineVersion}, native create/copy/reorder/delete, viewport and paper-entity independence, limits, DWG reopen).`);
