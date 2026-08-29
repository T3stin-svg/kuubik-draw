#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { exportDxf, importDxf } from "../../packages/cad-dxf/src/index.ts";
import { createF109Document } from "../../parity/fixtures/f109-document.ts";

const root = process.cwd();
const artifacts = resolve(root, "evidence/artifacts");
const paths = {
  source: resolve(artifacts, "F-111-source.dxf"),
  roundtrip: resolve(artifacts, "F-111-roundtrip.dxf"),
  browser: resolve(artifacts, "F-111-browser-roundtrip.dxf"),
  sourceReadback: resolve(artifacts, "F-111-source-ezdxf.json"),
  roundtripReadback: resolve(artifacts, "F-111-roundtrip-ezdxf.json"),
  browserReadback: resolve(artifacts, "F-111-browser-ezdxf.json"),
  browserMatrix: resolve(artifacts, "F-111-browser-matrix.json"),
  report: resolve(artifacts, "F-111-readback.json"),
  browserReport: resolve(artifacts, "F-111-browser-readback.json"),
};
await mkdir(artifacts, { recursive: true });
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

const source = exportDxf(createF109Document("F-111-source"));
if (source.report.skipped.length || source.report.emittedHandles.length !== 40) throw new Error(`F-111 source export is incomplete: ${JSON.stringify(source.report)}`);
const imported = importDxf(source.bytes, { documentId: "F-111-roundtrip", now: "2026-08-29T08:00:00.000Z" });
if (imported.report.skipped.length || imported.report.importedHandles.length !== 40) throw new Error(`F-111 import is incomplete: ${JSON.stringify(imported.report)}`);
const roundtrip = exportDxf(imported.document);
if (roundtrip.report.skipped.length || roundtrip.report.emittedHandles.length !== 40) throw new Error(`F-111 second export is incomplete: ${JSON.stringify(roundtrip.report)}`);
await writeFile(paths.source, source.bytes);
await writeFile(paths.roundtrip, roundtrip.bytes);
const browserBytes = await readFile(paths.browser);
const sourceBytes = await readFile(paths.source);
const roundtripBytes = await readFile(paths.roundtrip);
if (!sourceBytes.equals(roundtripBytes) || !sourceBytes.equals(browserBytes)) throw new Error("F-111 source, direct roundtrip and Chromium roundtrip bytes differ.");

async function readWithEzdxf(sourcePath, targetPath) {
  await new Promise((resolveRun, rejectRun) => {
    const child = spawn("python", [resolve(root, "tools/parity/read-f109-dxf.py"), sourcePath, targetPath], {
      cwd: root,
      windowsHide: true,
      stdio: "inherit",
    });
    child.on("error", rejectRun);
    child.on("close", (code) => code === 0 ? resolveRun() : rejectRun(new Error(`F-111 ezdxf read-back exited ${code}.`)));
  });
}
await readWithEzdxf(paths.source, paths.sourceReadback);
await readWithEzdxf(paths.roundtrip, paths.roundtripReadback);
await readWithEzdxf(paths.browser, paths.browserReadback);

const sourceReadback = JSON.parse(await readFile(paths.sourceReadback, "utf8"));
const roundtripReadback = JSON.parse(await readFile(paths.roundtripReadback, "utf8"));
const browserReadback = JSON.parse(await readFile(paths.browserReadback, "utf8"));
const browserMatrix = JSON.parse(await readFile(paths.browserMatrix, "utf8"));
const expected = JSON.parse(await readFile(resolve(root, "parity/expected/F-109.json"), "utf8"));
const semanticHashes = (report) => Object.fromEntries(Object.entries(report.semanticEntities).map(([handle, record]) => [handle, sha256(JSON.stringify(record))]));
const normalize = (report) => ({ ...report, source: "<file>", sha256: "<exact-same-bytes>" });
if (!isDeepStrictEqual(normalize(sourceReadback), normalize(roundtripReadback)) || !isDeepStrictEqual(normalize(sourceReadback), normalize(browserReadback))) {
  throw new Error("F-111 strict readers disagree across source, direct roundtrip and browser roundtrip.");
}
if (!isDeepStrictEqual(sourceReadback.entities, expected.entities) || sourceReadback.totalEntities !== 40 || sourceReadback.units !== 4 || sourceReadback.bulgedPolylines !== 2) {
  throw new Error(`F-111 exact entity/unit manifest mismatch: ${JSON.stringify(sourceReadback)}`);
}
if (!isDeepStrictEqual(semanticHashes(sourceReadback), expected.semanticSha256ByHandle)) throw new Error("F-111 semantic per-handle golden mismatch.");
if (sourceReadback.auditErrors !== 0 || sourceReadback.auditFixes !== 0 || !sourceReadback.passed) throw new Error("F-111 strict source audit is not clean.");
if (browserMatrix.status !== "PASS" || browserMatrix.rowId !== "F-111" || browserMatrix.viewport?.width !== 1920 || browserMatrix.viewport?.height !== 1080 || browserMatrix.exactProductionBytes !== undefined || browserMatrix.roundtrip?.exactProductionBytes !== true || browserMatrix.consoleErrors?.length !== 0) {
  throw new Error(`F-111 browser matrix is invalid: ${JSON.stringify(browserMatrix)}`);
}

const sourcePaths = {
  importer: "packages/cad-dxf/src/import.ts",
  exporter: "packages/cad-dxf/src/index.ts",
  transaction: "packages/cad-core/src/transaction.ts",
  app: "apps/web/src/App.tsx",
  unitTests: "packages/cad-dxf/test/f111-roundtrip.test.ts",
  mutationTests: "packages/cad-dxf/test/f111-mutation-proven.test.ts",
  transactionTests: "packages/cad-core/test/transaction.test.ts",
  browserE2e: "e2e/f111-dxf-roundtrip.spec.ts",
  browserCapture: "tools/parity/capture-f111-browser.mjs",
  independentReader: "tools/parity/read-f109-dxf.py",
  readbackRunner: "tools/parity/run-f111-readback.mjs",
  fixture: "parity/fixtures/f109-document.ts",
  expected: "parity/expected/F-109.json",
  scope: "parity/F-111-scope.md",
  packageLock: "package-lock.json",
};
const implementationSha256 = Object.fromEntries(await Promise.all(Object.entries(sourcePaths).map(async ([key, path]) => [key, sha256(await readFile(resolve(root, path)))])));
const exactSha = sha256(sourceBytes);
const report = {
  schemaVersion: 1,
  rowId: "F-111",
  checkedAt: new Date().toISOString(),
  productionPath: "App.importDxfFile -> @kuubik/cad-dxf.importDxf -> CadSession DXFIN -> @kuubik/cad-dxf.exportDxf",
  exactByteAgreement: true,
  source: { path: "evidence/artifacts/F-111-source.dxf", bytes: sourceBytes.length, sha256: exactSha },
  roundtrip: { path: "evidence/artifacts/F-111-roundtrip.dxf", bytes: roundtripBytes.length, sha256: exactSha },
  browser: { path: "evidence/artifacts/F-111-browser-roundtrip.dxf", bytes: browserBytes.length, sha256: exactSha },
  importReport: imported.report,
  sourceReadback,
  roundtripReadback,
  browserReadback,
  semanticSha256ByHandle: semanticHashes(sourceReadback),
  implementationSha256,
  passed: true,
};
await writeFile(paths.report, `${JSON.stringify(report, null, 2)}\n`, "utf8");
await writeFile(paths.browserReport, `${JSON.stringify({
  schemaVersion: 1,
  rowId: "F-111",
  checkedAt: new Date().toISOString(),
  matrix: browserMatrix,
  independent: browserReadback,
  implementationSha256,
  passed: true,
}, null, 2)}\n`, "utf8");
console.log("F-111 source/direct/browser DXF roundtrip + strict ezdxf read-back PASS.");
