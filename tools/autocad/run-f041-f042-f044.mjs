#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { validateCoordinateDxf } from "./f041-f044-dxf-readback.mjs";
import { runOwnedDesktopMatrix, sha256 } from "./owned-desktop-matrix.mjs";

const root = process.cwd();
const outputPath = resolve(root, process.argv[2] ?? "evidence/autocad/F-041-F-042-F-044.json");
const implementationPaths = [
  "tools/autocad/f041-f042-f044-coordinate-matrix.ps1",
  "tools/autocad/run-f041-f042-f044.mjs",
  "tools/autocad/f041-f044-dxf-readback.mjs",
  "tools/autocad/f041-f044-runner.test.mjs",
  "tools/autocad/f041-f044-dxf-readback.test.mjs",
  "tools/autocad/f041-f044-content-address.test.mjs",
  "tools/autocad/owned-desktop-matrix.mjs",
  "tools/autocad/process-ownership.mjs",
  "packages/cad-core/test/fixtures/autocad-2024-coordinate-reference.json",
  "packages/cad-core/test/f041-f044-autocad-reference.test.ts",
  "packages/cad-dxf/test/fixtures/synthetic/F-041-F-042-coordinate-entry.dxf",
];

const matrix = await runOwnedDesktopMatrix({
  rowId: "F-041-F-042-F-044",
  matrixScriptPath: resolve(root, "tools/autocad/f041-f042-f044-coordinate-matrix.ps1"),
  timeoutEnvironmentName: "F041_F044_AUTOCAD_TIMEOUT_MS",
  validateDxf: validateCoordinateDxf,
});
const blocked = matrix.observations?.blocked ?? [];
const checksPass = Object.values(matrix.checks ?? {}).every((value) => value === true);
if (matrix.schemaVersion !== 1 || JSON.stringify(matrix.rowIds) !== JSON.stringify(["F-041", "F-042", "F-044"])
  || !matrix.engineVersion?.startsWith("24.3")
  || matrix.automationProcessIdentity?.fileVersion !== "R24.3.152.0.0"
  || matrix.installedUpdateIdentity?.displayName !== "Autodesk AutoCAD 2024.1.2 Update"
  || matrix.installedUpdateIdentity?.displayVersion !== "24.3.152.0"
  || matrix.automationProcessOwned !== true || matrix.automationProcessTerminated !== true || matrix.processSetRestored !== true
  || matrix.userDocument?.isolatedOwnedProcess !== true || matrix.userDocument?.userDocumentTouched !== false
  || matrix.status !== "PARTIAL" || !checksPass || matrix.cmdNamesAfter !== ""
  || matrix.dxfReadback?.sha256 !== matrix.dxfOutputSha256
  || matrix.dxfReadback?.requiredHeaderVariablesExact !== true || matrix.dxfReadback?.entityCountExact !== true
  || matrix.dxfReadback?.entityCoordinatesWithinEightUlps !== true
  || blocked.length !== 3 || blocked.some((item) => item.status !== "NOT_RUN")) {
  throw new Error(`F-041/F-042/F-044 AutoCAD result mismatch: ${JSON.stringify(matrix)}`);
}

const implementationSha256 = Object.fromEntries(await Promise.all(implementationPaths.map(async (path) => [path, sha256(await readFile(resolve(root, path)))])));
const report = {
  ...matrix,
  certificationAuthority: false,
  certificationScope: "Live AutoCAD 2024.1.2 WCS command-line and scratch DXF reference only; no integrated Kuubik browser/read-back or parity-score authority.",
  workflow: "new owned AutoCAD process + blank scratch document + typed LINE/PLINE/MOVE command tokens + atomic Undo/Redo + independent raw DXF header/entity read-back",
  implementationSha256,
  remainingCertificationRequirements: blocked.map(({ capability, rowId, reason }) => ({ capability, rowId, reason })),
  observedAt: new Date().toISOString(),
};
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`F-041/F-042/F-044 AutoCAD coordinate reference ${report.status}; proven checks=${Object.keys(report.checks).length}; NOT_RUN=${blocked.length}.`);
