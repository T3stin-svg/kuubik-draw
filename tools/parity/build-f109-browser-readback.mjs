#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const artifacts = resolve(root, "evidence/artifacts");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const matrixBytes = await readFile(resolve(artifacts, "F-109-browser-matrix.json"));
const dxfBytes = await readFile(resolve(artifacts, "F-109-browser.dxf"));
const screenshotBytes = await readFile(resolve(artifacts, "F-109-browser-export.png"));
const matrix = JSON.parse(matrixBytes.toString("utf8"));
const sourcePaths = {
  browserE2e: "e2e/f109-dxf-export.spec.ts",
  exportTests: "packages/cad-dxf/test/f109-export.test.ts",
  mutationTests: "packages/cad-dxf/test/f109-mutation-proven.test.ts",
  fixture: "parity/fixtures/f109-document.ts",
  expected: "parity/expected/F-109.json",
  scope: "parity/F-109-scope.md",
  browserCapture: "tools/parity/capture-f109-browser.mjs",
  browserBuilder: "tools/parity/build-f109-browser-readback.mjs",
  app: "apps/web/src/App.tsx",
  exporter: "packages/cad-dxf/src/index.ts",
  plotStyle: "packages/cad-core/src/plot-style.ts",
  aciPalette: "packages/cad-core/src/aci-palette.ts",
  packageLock: "package-lock.json",
  crossChecker: "tools/parity/check-f109-cross-evidence.mjs",
  semanticNormalizer: "tools/parity/f109-semantics.mjs",
};
const sourceSha256 = Object.fromEntries(await Promise.all(Object.entries(sourcePaths).map(async ([key, path]) => [key, sha256(await readFile(resolve(root, path)))])));
const checks = {
  matrixPassed: matrix.schemaVersion === 1 && matrix.rowId === "F-109" && matrix.status === "PASS",
  exactProductionBytes: matrix.exactProductionBytes === true,
  exactManifest: matrix.entityCount === 40 && matrix.revision === 0,
  expectedViewport: matrix.viewport?.width === 1920 && matrix.viewport?.height === 1080,
  cleanRuntime: Array.isArray(matrix.consoleErrors) && matrix.consoleErrors.length === 0,
  downloadMatchesMatrix: matrix.bytes === dxfBytes.length && matrix.sha256 === sha256(dxfBytes),
  screenshotCaptured: screenshotBytes.length > 0,
};
if (Object.values(checks).some((value) => value !== true)) throw new Error(`F-109 browser read-back mismatch: ${JSON.stringify(checks)}`);
const result = {
  schemaVersion: 1,
  rowId: "F-109",
  authority: "kuubik-draw-browser",
  status: "PASS",
  observedAt: new Date().toISOString(),
  workflow: matrix.workflow,
  matrix,
  dxf: { artifact: "evidence/artifacts/F-109-browser.dxf", bytes: dxfBytes.length, sha256: sha256(dxfBytes) },
  screenshot: { artifact: "evidence/artifacts/F-109-browser-export.png", bytes: screenshotBytes.length, sha256: sha256(screenshotBytes) },
  sourceSha256,
  checks,
};
await writeFile(resolve(artifacts, "F-109-browser-readback.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log("F-109 Chromium exact-byte DXF export read-back PASS.");
