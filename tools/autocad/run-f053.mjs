#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { validateF053Dxf } from "./f053-dxf-readback.mjs";
import { runOwnedDesktopMatrix, sha256 } from "./owned-desktop-matrix.mjs";

const root = process.cwd();
const matrixScriptPath = resolve(root, "tools/autocad/f053-units-matrix.ps1");
const outputPath = resolve(root, process.argv[2] ?? "evidence/autocad/F-053.json");
const implementationPaths = [
  "tools/autocad/f053-units-matrix.ps1",
  "tools/autocad/run-f053.mjs",
  "tools/autocad/f053-dxf-readback.mjs",
  "tools/autocad/f053-runner.test.mjs",
  "tools/autocad/f053-dxf-readback.test.mjs",
  "tools/autocad/f053-content-address.test.mjs",
  "tools/autocad/owned-desktop-matrix.mjs",
  "tools/autocad/process-ownership.mjs",
  "packages/cad-dxf/test/fixtures/synthetic/F-053-units-header.dxf",
];

const matrix = await runOwnedDesktopMatrix({
  rowId: "F-053",
  matrixScriptPath,
  timeoutEnvironmentName: "F053_AUTOCAD_TIMEOUT_MS",
  validateDxf: validateF053Dxf,
});
const blocked = matrix.observations?.blocked ?? [];
const checksPass = Object.values(matrix.checks ?? {}).every((value) => value === true);
if (matrix.schemaVersion !== 1 || matrix.rowId !== "F-053"
  || !matrix.engineVersion?.startsWith("24.3")
  || matrix.automationProcessIdentity?.fileVersion !== "R24.3.152.0.0"
  || matrix.automationProcessIdentity?.productVersion !== "R24.3.152.0.0"
  || matrix.installedUpdateIdentity?.displayName !== "Autodesk AutoCAD 2024.1.2 Update"
  || matrix.installedUpdateIdentity?.displayVersion !== "24.3.152.0"
  || matrix.automationProcessOwned !== true || matrix.automationProcessTerminated !== true || matrix.processSetRestored !== true
  || matrix.userDocument?.isolatedOwnedProcess !== true || matrix.userDocument?.userDocumentTouched !== false
  || matrix.cmdNamesAfter !== "" || matrix.status !== "PARTIAL" || !checksPass
  || matrix.dxfReadback?.sha256 !== matrix.dxfOutputSha256
  || matrix.dxfReadback?.requiredHeaderVariablesExact !== true || matrix.dxfReadback?.geometryCoordinatesWithinEightUlps !== true
  || blocked.length !== 2 || blocked.some((item) => item.status !== "NOT_RUN")) {
  throw new Error(`F-053 AutoCAD result mismatch: ${JSON.stringify(matrix)}`);
}

const implementationSha256 = Object.fromEntries(await Promise.all(implementationPaths.map(async (path) => [
  path,
  sha256(await readFile(resolve(root, path))),
])));
const report = {
  ...matrix,
  certificationAuthority: false,
  certificationScope: "Live AutoCAD 2024.1.2 COM system-variable and scratch DXF reference only; no parity score authority.",
  workflow: "new owned AutoCAD process + blank scratch document + COM UNITS variables + atomic Undo/Redo + independent raw DXF header/geometry read-back",
  implementationSha256,
  remainingCertificationRequirements: blocked.map(({ capability, reason }) => ({ capability, reason })),
  observedAt: new Date().toISOString(),
};
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`F-053 AutoCAD 2024.1.2 live UNITS reference ${report.status}; proven checks=${Object.keys(report.checks).length}; NOT_RUN=${blocked.length}.`);
