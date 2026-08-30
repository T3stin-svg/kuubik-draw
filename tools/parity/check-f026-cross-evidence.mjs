#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const root = process.cwd();
const paths = {
  browser: "evidence/artifacts/F-026-browser-readback.json",
  browserMatrix: "evidence/artifacts/F-026-browser-matrix.json",
  production: "evidence/artifacts/F-026-independent-readback.json",
  autocad: "evidence/artifacts/F-026-autocad-readback.json",
  autocadCore: "evidence/artifacts/F-026-autocad-core.json",
  oracles: "evidence/artifacts/F-026-oracles.json",
};
const outputPath = resolve(root, "evidence/artifacts/F-026-cross-evidence.json");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function currentReceiptMap(receipts) {
  const entries = await Promise.all(Object.entries(receipts ?? {}).map(async ([path, expected]) => {
    const bytes = await readFile(resolve(root, path));
    return [path, { expected, actual: sha256(bytes), byteLength: bytes.length }];
  }));
  return Object.fromEntries(entries);
}
const receiptsExact = (receipts) => Object.values(receipts).every(({ expected, actual }) => expected === actual);
async function load(path) {
  try { const bytes = await readFile(resolve(root, path)); return { bytes, value: JSON.parse(bytes.toString("utf8")) }; }
  catch (error) {
    if (error?.code === "ENOENT" && path === paths.autocad) throw new Error("F-026 desktop AutoCAD evidence is missing; Core Console and LibreCAD/FreeCAD cannot certify the row.");
    throw error;
  }
}

const entries = Object.fromEntries(await Promise.all(Object.entries(paths).map(async ([name, path]) => [name, await load(path)])));
const { browser, browserMatrix, production, autocad, autocadCore, oracles } = Object.fromEntries(Object.entries(entries).map(([name, entry]) => [name, entry.value]));
const browserDxf = await readFile(resolve(root, "evidence/artifacts/F-026-browser.dxf"));
const browserKdraw = await readFile(resolve(root, "evidence/artifacts/F-026-browser.kdraw"));
const productionDxf = await readFile(resolve(root, "evidence/artifacts/F-026-kuubik.dxf"));
const productionKdraw = await readFile(resolve(root, "evidence/artifacts/F-026-kuubik.kdraw"));
const browserSourceReceipts = await currentReceiptMap(browser.sourceSha256);
const browserArtifactReceipts = await currentReceiptMap(Object.fromEntries(Object.entries(browser.artifacts ?? {}).map(([path, receipt]) => [path, receipt.sha256])));
const browserArtifactLengthsExact = Object.entries(browser.artifacts ?? {}).every(([path, receipt]) => browserArtifactReceipts[path]?.byteLength === receipt.byteLength);
const productionSourceReceipts = await currentReceiptMap(production.implementationSha256);
const autocadSourceReceipts = await currentReceiptMap({
  "evidence/artifacts/F-022-browser-spline-source.dxf": autocad.fixtureSha256,
  "tools/autocad/f026-standard-matrix.ps1": autocad.matrixScriptSha256,
  "tools/autocad/run-f026.mjs": autocad.runnerSha256,
  "tools/autocad/process-ownership.mjs": autocad.processOwnershipSha256,
  "tools/autocad/send-escape.ps1": autocad.escapeHelperSha256,
});
const coreSourceReceipts = await currentReceiptMap({
  "evidence/artifacts/F-022-browser-spline-source.dxf": autocadCore.fixtureSha256,
  "parity/autocad/F-026-core.scr": autocadCore.scriptSha256,
  "tools/autocad/run-f026-core.mjs": autocadCore.runnerSha256,
});
const oracleSourceReceipts = await currentReceiptMap({
  [oracles.sourceArtifact]: oracles.sourceArtifactSha256,
  [oracles.readbackArtifact]: oracles.readbackArtifactSha256,
  ...oracles.implementationSha256,
});

const checks = {
  allRowsExact: [browser, browserMatrix, production, autocad, autocadCore, oracles].every((report) => report.rowId === "F-026"),
  browserPass: browser.status === "PASS" && Object.values(browser.checks ?? {}).every(Boolean) && browserMatrix.status === "PASS" && browserMatrix.consoleErrors?.length === 0,
  browserArtifactExact: browser.artifacts?.["evidence/artifacts/F-026-browser.dxf"]?.sha256 === sha256(browserDxf),
  browserKdrawExact: browser.artifacts?.["evidence/artifacts/F-026-browser.kdraw"]?.sha256 === sha256(browserKdraw),
  browserNestedArtifactsCurrent: receiptsExact(browserArtifactReceipts) && browserArtifactLengthsExact,
  browserSourcesCurrent: receiptsExact(browserSourceReceipts),
  productionPass: production.status === "PASS" && production.undoRedo?.exactSourceRestored === true && production.undoRedo?.exactCommittedRestored === true,
  productionArtifactExact: production.dxf?.sha256 === sha256(productionDxf),
  productionKdrawExact: production.kdraw?.sha256 === sha256(productionKdraw) && production.kdraw?.byteLength === productionKdraw.length,
  productionSourcesCurrent: receiptsExact(productionSourceReceipts),
  desktopAutoCadPass: autocad.status === "PASS" && autocad.certificationAuthority === true && autocad.engineVersion?.startsWith("24.3") === true && Object.values(autocad.checks ?? {}).every(Boolean),
  desktopProcessIsolation: autocad.automationProcessOwned === true && autocad.automationProcessTerminated === true && autocad.processSetRestored === true && autocad.userDocument?.isolatedOwnedProcess === true,
  desktopSourcesCurrent: receiptsExact(autocadSourceReceipts),
  coreReferencePass: autocadCore.status === "PASS" && autocadCore.certificationAuthority === false && Object.values(autocadCore.checks ?? {}).every(Boolean),
  coreSourcesCurrent: receiptsExact(coreSourceReceipts),
  nativeLayerSemantics: autocadCore.markers?.LOCKED_COUNT === "1" && autocadCore.markers?.OFF_COUNT === "2" && autocadCore.markers?.FROZEN_COUNT === "2",
  oracleReportComplete: oracles.status === "SECONDARY_ORACLE_REPORT_COMPLETE" && oracles.certificationAuthority === false && oracles.reports?.every((report) => report.certificationAuthority === false && report.status === "FIXTURE_PASS_NOT_NETWORK_ISOLATED") === true,
  oracleExactProductionInput: oracles.sourceArtifactSha256 === sha256(productionDxf),
  oracleInputsAndSourcesCurrent: receiptsExact(oracleSourceReceipts)
    && oracles.runnerSha256 === oracles.implementationSha256?.["tools/oracles/run-f026-oracles.mjs"]
    && oracles.freeCadScriptSha256 === oracles.implementationSha256?.["tools/oracles/freecad-f026-headless.py"],
  sameFamiliesAcrossNativeAndKuubik: autocadCore.markers?.SPLINE_COUNT === "2" && autocadCore.markers?.DEFAULT_COUNT === "2" && autocadCore.markers?.AT_COUNT === "2" && production.output?.independentTypes?.includes("50:SPLINE") && production.output?.independentTypes?.includes("53:SPLINE"),
  closedAtPointRefused: production.closedAtPoint?.changes?.length === 0 && production.closedAtPoint?.rejected?.[0]?.reason === "closed-at-point",
  atPointCapabilityExact: production.atPointCapabilities?.openEllipse?.changes?.length === 2
    && production.atPointCapabilities?.openEllipse?.rejected?.length === 0
    && production.atPointCapabilities?.openSpline?.changes?.length === 0
    && production.atPointCapabilities?.openSpline?.rejected?.[0]?.reason === "unsupported-target"
    && autocad.checks?.breakAtPointOpenEllipse === true
    && autocad.checks?.breakAtPointOpenSplineRefused === true,
};
const failed = Object.entries(checks).filter(([, pass]) => !pass).map(([name]) => name);
if (failed.length) throw new Error(`F-026 cross-evidence failed closed: ${failed.join(", ")}. Desktop AutoCAD evidence is mandatory and cannot be replaced by Core Console or an oracle.`);

const report = { schemaVersion: 1, rowId: "F-026", status: "PASS", checks, evidenceSha256: Object.fromEntries(Object.entries(entries).map(([name, entry]) => [paths[name], sha256(entry.bytes)])), nestedReceipts: { browserArtifacts: browserArtifactReceipts, browserSources: browserSourceReceipts, productionSources: productionSourceReceipts, desktopSources: autocadSourceReceipts, coreSources: coreSourceReceipts, oracleInputsAndSources: oracleSourceReceipts }, browserDxfSha256: sha256(browserDxf), browserKdrawSha256: sha256(browserKdraw), productionDxfSha256: sha256(productionDxf), productionKdrawSha256: sha256(productionKdraw), certificationAuthorities: { desktopAutoCad: true, coreConsole: false, libreCad: false, freeCad: false } };
await mkdir(dirname(outputPath), { recursive: true }); await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log("F-026 AutoCAD/Chromium/DXF/KDRAW/oracle cross-evidence PASS.");
