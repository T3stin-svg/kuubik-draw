#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parsePageSetupTemplate, serializePageSetupTemplate } from "../../packages/cad-core/src/index.ts";

const root = process.cwd();
const artifacts = resolve(root, "evidence/artifacts");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const matrixBytes = await readFile(resolve(artifacts, "F-107-browser-matrix.json"));
const templateBytes = await readFile(resolve(artifacts, "F-107-browser-template.json"));
const screenshotBytes = await readFile(resolve(artifacts, "F-107-browser-page-setups.png"));
const matrix = JSON.parse(matrixBytes.toString("utf8"));
const template = parsePageSetupTemplate(templateBytes.toString("utf8"));
const forbidden = (value) => Array.isArray(value)
  ? value.some(forbidden)
  : value && typeof value === "object" && Object.entries(value).some(([key, entry]) => key === "entities" || key === "blocks" || forbidden(entry));
const sourcePaths = {
  e2e: "e2e/f107-named-page-setups.spec.ts",
  fixture: "parity/fixtures/f107-document.ts",
  capture: "tools/parity/capture-f107-browser.mjs",
  builder: "tools/parity/build-f107-browser-readback.mjs",
  app: "apps/web/src/App.tsx",
  style: "apps/web/src/style.css",
  library: "packages/cad-core/src/page-setups.ts",
};
const sourceSha256 = Object.fromEntries(await Promise.all(Object.entries(sourcePaths).map(async ([key, path]) => [key, sha256(await readFile(resolve(root, path)))])));
const checks = {
  matrixPassed: matrix.schemaVersion === 1 && matrix.rowId === "F-107" && matrix.status === "PASS" && matrix.consoleErrors?.length === 0,
  exactTemplateBytes: serializePageSetupTemplate(template) === templateBytes.toString("utf8") && matrix.template?.sha256 === sha256(templateBytes),
  geometryFree: forbidden(template) === false && matrix.template?.geometryFree === true,
  completeTemplate: template.format === "kuubik-draw-page-setup-template" && template.name === "F-107 office template" && template.pageSetups.length === 1 && template.layouts.length === 2,
  fullNamedSetup: template.pageSetups[0]?.name === "F-107 A4 FINAL" && template.pageSetups[0]?.pageSetup?.mediaName === "ISO_A4" && template.pageSetups[0]?.pageSetup?.orientation === "portrait" && template.pageSetups[0]?.pageSetup?.plotArea?.kind === "layout" && template.pageSetups[0]?.pageSetup?.plotScale?.paperUnits === 1 && template.pageSetups[0]?.pageSetup?.plotScale?.drawingUnits === 1 && template.pageSetups[0]?.pageSetup?.centerPlot === false && template.pageSetups[0]?.pageSetup?.plotOriginMm?.x === 0 && template.pageSetups[0]?.pageSetup?.plotOriginMm?.y === 0,
  persistedAtomicWorkflow: matrix.finalDocument?.revision === 8 && matrix.finalDocument?.layouts === 3 && matrix.finalDocument?.modelEntities === 2 && matrix.finalDocument?.preservedPaperEntities === 1 && matrix.finalDocument?.importedPaperEntities === 0,
  referencesValid: matrix.finalDocument?.library?.setups?.length === 1 && matrix.finalDocument?.library?.assignments?.["layout-2"] === "page-setup-1",
  screenshotPresent: screenshotBytes.byteLength > 1000,
};
if (Object.values(checks).some((value) => value !== true)) throw new Error(`F-107 browser read-back mismatch: ${JSON.stringify(checks)}`);
const result = {
  schemaVersion: 1,
  rowId: "F-107",
  source: "Chromium 1920x1080 named page setup CRUD, geometry-free download/file-input import, atomic Undo/Redo and IndexedDB reload",
  sourceSha256,
  matrix,
  template: { bytes: templateBytes.byteLength, sha256: sha256(templateBytes), parsed: template },
  screenshot: { bytes: screenshotBytes.byteLength, sha256: sha256(screenshotBytes) },
  checks,
  status: "PASS",
};
await writeFile(resolve(artifacts, "F-107-browser-readback.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log("F-107 Chromium named page setup/template read-back PASS.");
