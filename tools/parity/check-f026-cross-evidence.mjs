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
const productionDxf = await readFile(resolve(root, "evidence/artifacts/F-026-kuubik.dxf"));

const checks = {
  allRowsExact: [browser, browserMatrix, production, autocad, autocadCore, oracles].every((report) => report.rowId === "F-026"),
  browserPass: browser.status === "PASS" && Object.values(browser.checks ?? {}).every(Boolean) && browserMatrix.status === "PASS" && browserMatrix.consoleErrors?.length === 0,
  browserArtifactExact: browser.artifacts?.["evidence/artifacts/F-026-browser.dxf"]?.sha256 === sha256(browserDxf),
  productionPass: production.status === "PASS" && production.undoRedo?.exactSourceRestored === true && production.undoRedo?.exactCommittedRestored === true,
  productionArtifactExact: production.dxf?.sha256 === sha256(productionDxf),
  desktopAutoCadPass: autocad.status === "PASS" && autocad.certificationAuthority === true && autocad.engineVersion?.startsWith("24.3") === true && Object.values(autocad.checks ?? {}).every(Boolean),
  desktopProcessIsolation: autocad.automationProcessOwned === true && autocad.automationProcessTerminated === true && autocad.processSetRestored === true && autocad.userDocument?.isolatedOwnedProcess === true,
  coreReferencePass: autocadCore.status === "PASS" && autocadCore.certificationAuthority === false && Object.values(autocadCore.checks ?? {}).every(Boolean),
  nativeLayerSemantics: autocadCore.markers?.LOCKED_COUNT === "1" && autocadCore.markers?.OFF_COUNT === "2" && autocadCore.markers?.FROZEN_COUNT === "2",
  oracleReportComplete: oracles.status === "SECONDARY_ORACLE_REPORT_COMPLETE" && oracles.certificationAuthority === false && oracles.reports?.every((report) => report.certificationAuthority === false && report.status === "FIXTURE_PASS_NOT_NETWORK_ISOLATED") === true,
  oracleExactProductionInput: oracles.sourceArtifactSha256 === sha256(productionDxf),
  sameFamiliesAcrossNativeAndKuubik: autocadCore.markers?.SPLINE_COUNT === "2" && autocadCore.markers?.DEFAULT_COUNT === "2" && autocadCore.markers?.AT_COUNT === "2" && production.output?.independentTypes?.includes("50:SPLINE") && production.output?.independentTypes?.includes("53:SPLINE"),
  closedAtPointRefused: production.closedAtPoint?.changes?.length === 0 && production.closedAtPoint?.rejected?.[0]?.reason === "closed-at-point",
};
const failed = Object.entries(checks).filter(([, pass]) => !pass).map(([name]) => name);
if (failed.length) throw new Error(`F-026 cross-evidence failed closed: ${failed.join(", ")}. Desktop AutoCAD evidence is mandatory and cannot be replaced by Core Console or an oracle.`);

const report = { schemaVersion: 1, rowId: "F-026", status: "PASS", observedAt: new Date().toISOString(), checks, evidenceSha256: Object.fromEntries(Object.entries(entries).map(([name, entry]) => [paths[name], sha256(entry.bytes)])), browserDxfSha256: sha256(browserDxf), productionDxfSha256: sha256(productionDxf), certificationAuthorities: { desktopAutoCad: true, coreConsole: false, libreCad: false, freeCad: false } };
await mkdir(dirname(outputPath), { recursive: true }); await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log("F-026 AutoCAD/Chromium/DXF/KDRAW/oracle cross-evidence PASS.");
