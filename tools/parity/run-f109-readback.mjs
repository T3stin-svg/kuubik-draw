#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { exportDxf } from "../../packages/cad-dxf/src/index.ts";
import { createF109Document } from "../../parity/fixtures/f109-document.ts";

const root = process.cwd();
const artifacts = resolve(root, "evidence/artifacts");
const dxfPath = resolve(artifacts, "F-109-production.dxf");
const independentPath = resolve(artifacts, "F-109-independent-readback.json");
const browserDxfPath = resolve(artifacts, "F-109-browser.dxf");
const browserIndependentPath = resolve(artifacts, "F-109-browser-independent-readback.json");
const reportPath = resolve(artifacts, "F-109-readback.json");
const expectedPath = resolve(root, "parity/expected/F-109.json");
await mkdir(artifacts, { recursive: true });

const document = createF109Document();
const exported = exportDxf(document);
if (exported.report.skipped.length) throw new Error(`F-109 skipped entities: ${JSON.stringify(exported.report.skipped)}`);
if (exported.report.emittedHandles.length !== 40) throw new Error(`F-109 emitted ${exported.report.emittedHandles.length}, expected 40.`);
await writeFile(dxfPath, exported.bytes);

async function readWithEzdxf(source, target) {
  await new Promise((resolveRun, rejectRun) => {
    const process = spawn("python", [resolve(root, "tools/parity/read-f109-dxf.py"), source, target], {
    cwd: root, windowsHide: true, stdio: "inherit",
    });
    process.on("error", rejectRun);
    process.on("close", (code) => code === 0 ? resolveRun() : rejectRun(new Error(`F-109 ezdxf read-back exited ${code}.`)));
  });
}
await readWithEzdxf(dxfPath, independentPath);
const productionBytes = await readFile(dxfPath);
const browserBytes = await readFile(browserDxfPath);
if (!productionBytes.equals(browserBytes)) throw new Error("F-109 browser download differs from a fresh production export.");
await readWithEzdxf(browserDxfPath, browserIndependentPath);

const independent = JSON.parse(await readFile(independentPath, "utf8"));
const browserIndependent = JSON.parse(await readFile(browserIndependentPath, "utf8"));
const expected = JSON.parse(await readFile(expectedPath, "utf8"));
const exact = (actual, wanted) => isDeepStrictEqual(actual, wanted);
const semanticSha256ByHandle = Object.fromEntries(Object.entries(independent.semanticEntities).map(([handle, record]) => [handle, createHash("sha256").update(JSON.stringify(record)).digest("hex")]));
if (!exact(independent.entities, expected.entities)) {
  throw new Error(`F-109 entity manifest mismatch: ${JSON.stringify(independent.entities)}`);
}
if (independent.dxfVersion !== expected.dxfVersion || independent.encoding !== expected.encoding || independent.units !== expected.units || independent.handseed !== expected.handseed || independent.totalEntities !== expected.totalEntities || independent.bulgedPolylines !== expected.bulgedPolylines) {
  throw new Error(`F-109 unit/count/bulge mismatch: ${JSON.stringify(independent)}`);
}
if (!exact(independent.headerExtents, expected.headerExtents)) throw new Error(`F-109 header extents mismatch: ${JSON.stringify(independent.headerExtents)}`);
if (!exact(semanticSha256ByHandle, expected.semanticSha256ByHandle)) throw new Error("F-109 per-handle semantic geometry golden mismatch.");
for (const [handle, record] of Object.entries(expected.requiredSemanticRecords)) {
  if (!exact(independent.semanticEntities[handle], record)) throw new Error(`F-109 semantic record ${handle} mismatch: ${JSON.stringify(independent.semanticEntities[handle])}`);
}
for (const [name, wanted] of Object.entries(expected.layers)) {
  const actual = independent.layers[name];
  if (!actual || actual.color !== wanted.color || actual.lineweight !== wanted.lineweight || actual.linetype.toUpperCase() !== wanted.linetype || actual.trueColor !== wanted.trueColor || actual.transparencyRaw !== wanted.transparencyRaw) {
    throw new Error(`F-109 layer ${name} mismatch: ${JSON.stringify(actual)}`);
  }
}
for (const style of expected.styles) if (!independent.styles.some((actual) => actual.toUpperCase() === style)) throw new Error(`F-109 missing text style ${style}.`);
if (!exact(independent.dimensionStyleRecords, expected.dimensionStyleRecords)) throw new Error(`F-109 dimension style mismatch: ${JSON.stringify(independent.dimensionStyleRecords)}`);
if (JSON.stringify(browserIndependent) !== JSON.stringify({ ...independent, source: "F-109-browser.dxf" })) {
  throw new Error("F-109 independent readers disagree between direct production and browser download.");
}

const bytes = productionBytes;
const sourcePaths = {
  exporter: "packages/cad-dxf/src/index.ts",
  plotStyle: "packages/cad-core/src/plot-style.ts",
  aciPalette: "packages/cad-core/src/aci-palette.ts",
  exportTests: "packages/cad-dxf/test/f109-export.test.ts",
  mutationTests: "packages/cad-dxf/test/f109-mutation-proven.test.ts",
  fixture: "parity/fixtures/f109-document.ts",
  expected: "parity/expected/F-109.json",
  independentReader: "tools/parity/read-f109-dxf.py",
  readbackRunner: "tools/parity/run-f109-readback.mjs",
  crossChecker: "tools/parity/check-f109-cross-evidence.mjs",
  semanticNormalizer: "tools/parity/f109-semantics.mjs",
  packageLock: "package-lock.json",
  scope: "parity/F-109-scope.md",
};
const sourceSha256 = Object.fromEntries(await Promise.all(Object.entries(sourcePaths).map(async ([key, path]) => [key, createHash("sha256").update(await readFile(resolve(root, path))).digest("hex")])));
const report = {
  featureId: "F-109",
  checkedAt: new Date().toISOString(),
  sourceCommit: "539c673e74905ef6205206a3acec963f8b910ffc",
  workingTreeWave: "F-109 DXF core export certification",
  productionPath: "App.downloadDxf -> @kuubik/cad-dxf.exportDxf",
  artifact: "evidence/artifacts/F-109-production.dxf",
  bytes: bytes.length,
  sha256: createHash("sha256").update(bytes).digest("hex"),
  exportReport: exported.report,
  independent,
  browserIndependent,
  semanticSha256ByHandle,
  sourceSha256,
  browserExactByteMatch: true,
  passed: true,
};
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report, null, 2));
