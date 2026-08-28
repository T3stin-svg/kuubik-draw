#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const artifacts = resolve(root, "evidence/artifacts");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const artifactPaths = {
  autocad: "evidence/artifacts/F-107-autocad-readback.json",
  browser: "evidence/artifacts/F-107-browser-readback.json",
  readback: "evidence/artifacts/F-107-independent-readback.json",
};
const artifactBytes = Object.fromEntries(await Promise.all(Object.entries(artifactPaths).map(async ([key, path]) => [key, await readFile(resolve(root, path))])));
const autocad = JSON.parse(artifactBytes.autocad.toString("utf8"));
const browser = JSON.parse(artifactBytes.browser.toString("utf8"));
const readback = JSON.parse(artifactBytes.readback.toString("utf8"));
const sourcePaths = {
  autocadMarker: "parity/autocad/F-107.scr",
  autocadMatrix: "tools/autocad/f107-page-setups.ps1",
  autocadRunner: "tools/autocad/run-f107.mjs",
  browserE2e: "e2e/f107-named-page-setups.spec.ts",
  fixture: "parity/fixtures/f107-document.ts",
  browserCapture: "tools/parity/capture-f107-browser.mjs",
  browserBuilder: "tools/parity/build-f107-browser-readback.mjs",
  readbackRunner: "tools/parity/run-f107-readback.mjs",
  app: "apps/web/src/App.tsx",
  style: "apps/web/src/style.css",
  library: "packages/cad-core/src/page-setups.ts",
  layouts: "packages/cad-core/src/layouts.ts",
  transaction: "packages/cad-core/src/transaction.ts",
  container: "packages/cad-core/src/container.ts",
  unitTests: "packages/cad-core/test/page-setups.test.ts",
  mutationTests: "packages/cad-core/test/f107-mutation-proven.test.ts",
  scope: "parity/F-107-scope.md",
  crossChecker: "tools/parity/check-f107-cross-evidence.mjs",
};
const implementationSha256 = Object.fromEntries(await Promise.all(Object.entries(sourcePaths).map(async ([key, path]) => [key, sha256(await readFile(resolve(root, path)))])));
const allTrue = (value) => value && Object.values(value).every((entry) => entry === true);
const close = (actual, expected, tolerance = 0.01) => Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance;
const template = browser.template?.parsed;
const named = template?.pageSetups?.[0];
const setup = named?.pageSetup;
const forbiddenGeometry = (value) => Array.isArray(value)
  ? value.some(forbiddenGeometry)
  : value && typeof value === "object" && Object.entries(value).some(([key, entry]) => key === "entities" || key === "blocks" || forbiddenGeometry(entry));
const checks = {
  threeAuthoritiesPassed: autocad.status === "PASS" && browser.status === "PASS" && readback.status === "PASS" && allTrue(autocad.checks) && allTrue(browser.checks) && allTrue(readback.checks),
  autoCadOwnedAndClean: autocad.engineVersion?.startsWith("24.3") && autocad.automationProcessOwned === true && autocad.automationProcessTerminated === true && autocad.processSetRestored === true && autocad.userDocument?.isolatedOwnedProcess === true && autocad.userDocument?.blankRestored === true,
  nativeNamedSetupCrud: autocad.operations?.create === "F-107 A4 Monochrome" && autocad.operations?.applyTo === "Layout1" && autocad.operations?.renameTo === "F-107 A4 Issue" && autocad.operations?.deleted === "F-107 DELETE" && autocad.counts?.withDelete === autocad.counts?.beforeDelete + 1 && autocad.counts?.afterDelete === autocad.counts?.beforeDelete,
  nativeDwtReopened: autocad.dwt?.bytes > 0 && autocad.dwt?.header === "AC1032" && autocad.dwt?.saveAsType === 66 && autocad.counts?.reopened === 1 && autocad.savedSetup?.name === autocad.reopenedSetup?.name && autocad.savedSetup?.canonicalMediaName === autocad.reopenedSetup?.canonicalMediaName && autocad.savedLayout?.canonicalMediaName === autocad.reopenedLayout?.canonicalMediaName,
  nativeUnitsOriginMarginsAndScaleReopened:
    autocad.insertionUnits?.saved === 4 && autocad.insertionUnits?.reopened === 4 && autocad.savedSetup?.paperUnits === 1 && autocad.reopenedSetup?.paperUnits === 1 &&
    autocad.savedSetup?.customScale === 0 && autocad.reopenedSetup?.customScale === 0 && close(autocad.savedSetup?.plotOrigin?.x, 0) && close(autocad.savedSetup?.plotOrigin?.y, 0) &&
    Number.isFinite(autocad.savedSetup?.paperMargins?.lowerLeft?.x) && Number.isFinite(autocad.savedSetup?.paperMargins?.lowerLeft?.y) && Number.isFinite(autocad.savedSetup?.paperMargins?.upperRight?.x) && Number.isFinite(autocad.savedSetup?.paperMargins?.upperRight?.y) &&
    close(autocad.savedSetup?.paperMargins?.lowerLeft?.x, autocad.reopenedSetup?.paperMargins?.lowerLeft?.x) && close(autocad.savedSetup?.paperMargins?.lowerLeft?.y, autocad.reopenedSetup?.paperMargins?.lowerLeft?.y) && close(autocad.savedSetup?.paperMargins?.upperRight?.x, autocad.reopenedSetup?.paperMargins?.upperRight?.x) && close(autocad.savedSetup?.paperMargins?.upperRight?.y, autocad.reopenedSetup?.paperMargins?.upperRight?.y),
  sameA4LayoutOneToOneContract:
    autocad.savedSetup?.configName === "DWG To PDF.pc3" && close(autocad.savedSetup?.paper?.widthMm, 210) && close(autocad.savedSetup?.paper?.heightMm, 297) && autocad.savedSetup?.plotType === 5 && autocad.savedSetup?.paperUnits === 1 && autocad.savedSetup?.useStandardScale === true && autocad.savedSetup?.standardScale === 1 && autocad.savedSetup?.customScale === 0 && autocad.savedSetup?.centerPlot === false && close(autocad.savedSetup?.plotOrigin?.x, 0) && close(autocad.savedSetup?.plotOrigin?.y, 0) && autocad.savedSetup?.plotWithLineweights === true && autocad.savedSetup?.plotWithPlotStyles === true && autocad.savedSetup?.styleSheet === "monochrome.ctb" &&
    setup?.mediaName === "ISO_A4" && setup?.orientation === "portrait" && setup?.plotArea?.kind === "layout" && setup?.plotScale?.mode === "custom" && close(setup?.plotScale?.paperUnits, 1) && close(setup?.plotScale?.drawingUnits, 1) && setup?.centerPlot === false && close(setup?.plotOriginMm?.x, 0) && close(setup?.plotOriginMm?.y, 0) && setup?.plotStyle?.profile === "monochrome" && setup?.plotStyle?.plotLineweights === true,
  strictGeometryFreeTemplate: template?.format === "kuubik-draw-page-setup-template" && template?.pageSetups?.length === 1 && template?.layouts?.length === 2 && forbiddenGeometry(template) === false && browser.matrix?.template?.geometryFree === true,
  browserCrudAndAtomicPersistence: browser.matrix?.finalDocument?.revision === 8 && browser.matrix?.finalDocument?.layouts === 3 && browser.matrix?.finalDocument?.library?.setups?.[0]?.name === "F-107 A4 FINAL" && browser.matrix?.finalDocument?.library?.assignments?.["layout-2"] === "page-setup-1" && browser.matrix?.consoleErrors?.length === 0,
  productionBytesAndChecksumAgree: readback.sourceSha256?.browserTemplate === browser.template?.sha256 && readback.template?.sha256 === browser.template?.sha256 && readback.kdraw?.bytes > 0 && readback.kdraw?.manifest?.entries?.length === 1 && readback.kdraw?.manifest?.entries?.[0]?.sha256?.length === 64,
  drawingGeometryPreserved: readback.restored?.modelEntityHandles?.join("|") === "10|11" && readback.restored?.layouts?.[1]?.entities?.map((entity) => entity.handle).join("|") === "12" && readback.restored?.layouts?.[2]?.entities?.length === 0,
  rejectionAndMutationProven: readback.mutations?.danglingRejected === true && readback.mutations?.staleRejected === true && readback.mutations?.plotProfileSha256 !== readback.template?.sha256,
  evidenceMatchesCurrentSources:
    autocad.scriptSha256 === implementationSha256.autocadMarker && autocad.matrixScriptSha256 === implementationSha256.autocadMatrix && autocad.runnerScriptSha256 === implementationSha256.autocadRunner &&
    browser.sourceSha256?.e2e === implementationSha256.browserE2e && browser.sourceSha256?.fixture === implementationSha256.fixture && browser.sourceSha256?.capture === implementationSha256.browserCapture && browser.sourceSha256?.builder === implementationSha256.browserBuilder && browser.sourceSha256?.app === implementationSha256.app && browser.sourceSha256?.style === implementationSha256.style && browser.sourceSha256?.library === implementationSha256.library &&
    readback.sourceSha256?.runner === implementationSha256.readbackRunner && readback.sourceSha256?.fixture === implementationSha256.fixture && readback.sourceSha256?.library === implementationSha256.library && readback.sourceSha256?.container === implementationSha256.container && readback.sourceSha256?.browserEvidence === sha256(artifactBytes.browser) && readback.sourceSha256?.browserTemplate === browser.template?.sha256 && /^[a-f0-9]{64}$/u.test(implementationSha256.crossChecker),
};
if (Object.values(checks).some((value) => value !== true)) throw new Error(`F-107 cross-evidence mismatch: ${JSON.stringify(checks)}`);
const result = {
  schemaVersion: 1,
  rowId: "F-107",
  source: "AutoCAD 2024 native named PlotConfiguration/DWT against Chromium named setup CRUD and deterministic geometry-free Kuubik template/KDRAW1 read-back",
  sourceSha256: Object.fromEntries(Object.entries(artifactBytes).map(([key, bytes]) => [key, sha256(bytes)])),
  implementationSha256,
  checks,
  status: "PASS",
};
await writeFile(resolve(artifacts, "F-107-cross-evidence.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log("F-107 AutoCAD/Chromium/template cross-evidence PASS.");
