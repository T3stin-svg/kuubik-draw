#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const root = process.cwd();
const executable = process.env.AUTOCAD_CORE ?? "C:\\Program Files\\Autodesk\\AutoCAD 2024\\accoreconsole.exe";
const fixturePath = resolve(root, "parity/fixtures/F-003-empty-mm.dxf");
const scriptPath = resolve(root, "parity/autocad/F-003.scr");
const outputPath = resolve(root, process.argv[2] ?? "evidence/artifacts/F-003-autocad-readback.json");

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
  const matches = [...stdout.matchAll(new RegExp(`F003_${name}=([^"\\\\\\r\\n]+)`, "g"))];
  return matches.at(-1)?.[1]?.trim() ?? null;
};
const vertices = (marker("VERTICES") ?? "")
  .split(";")
  .filter(Boolean)
  .map((pair) => pair.split(",").map(Number));
const result = {
  schemaVersion: 1,
  rowId: "F-003",
  benchmark: "AutoCAD 2024.1.2 / Windows / 2D Drafting & Annotation",
  engine: "Autodesk AutoCAD Core Console 2024",
  engineVersion: marker("ACADVER"),
  command: "RECTANG",
  input: { firstCorner: [125.25, -200.5], otherCorner: [600.75, 900.125] },
  result: {
    entityType: marker("TYPE"),
    closed: marker("CLOSED") === "1",
    vertexCount: Number(marker("VERTEX_COUNT")),
    vertices,
  },
  fixtureSha256: sha256(await readFile(fixturePath)),
  scriptSha256: sha256(await readFile(scriptPath)),
  observedAt: new Date().toISOString(),
  status: marker("DONE") === "1" ? "PASS" : "FAIL",
};
const expectedVertices = [[125.25, -200.5], [600.75, -200.5], [600.75, 900.125], [125.25, 900.125]];
if (
  !result.engineVersion?.startsWith("24.3") ||
  result.result.entityType !== "LWPOLYLINE" ||
  !result.result.closed ||
  result.result.vertexCount !== 4 ||
  JSON.stringify(result.result.vertices) !== JSON.stringify(expectedVertices) ||
  result.status !== "PASS"
) {
  throw new Error(`F-003 AutoCAD result mismatch: ${JSON.stringify(result)}`);
}
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(`F-003 AutoCAD live PASS (${result.engineVersion}, 4 closed LWPOLYLINE vertices).`);
