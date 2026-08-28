#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  CadSession,
  createPageSetupTemplate,
  deserializeKDraw,
  importPageSetupTemplate,
  parsePageSetupTemplate,
  renameNamedPageSetup,
  resolvePageSetupLibrary,
  saveNamedPageSetup,
  serializeKDraw,
  serializePageSetupTemplate,
} from "../../packages/cad-core/src/index.ts";
import { createF107Document } from "../../parity/fixtures/f107-document.ts";

const root = process.cwd();
const artifacts = resolve(root, "evidence/artifacts");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const browserEvidenceBytes = await readFile(resolve(artifacts, "F-107-browser-readback.json"));
const browserTemplateBytes = await readFile(resolve(artifacts, "F-107-browser-template.json"));
const browser = JSON.parse(browserEvidenceBytes.toString("utf8"));
const browserTemplate = parsePageSetupTemplate(browserTemplateBytes.toString("utf8"));

const sourceSession = new CadSession(createF107Document("local"));
const saved = saveNamedPageSetup(sourceSession.document, "layout-1", "F-107 A4 ISSUE");
sourceSession.commit({ opId: "f107-save", baseRevision: 0, commandId: "PAGESETUP_SAVE", args: {}, targetHandles: [], resultHandles: [] }, saved.changes, "2026-08-29T00:00:00.000Z");
const renamed = renameNamedPageSetup(sourceSession.document, saved.setupId, "F-107 A4 FINAL");
sourceSession.commit({ opId: "f107-rename", baseRevision: 1, commandId: "PAGESETUP_RENAME", args: {}, targetHandles: [], resultHandles: [] }, renamed.changes, "2026-08-29T00:00:00.000Z");
const productionTemplate = serializePageSetupTemplate(createPageSetupTemplate(sourceSession.document, "F-107 office template"));

const targetSession = new CadSession(createF107Document("local"));
const imported = importPageSetupTemplate(targetSession.document, browserTemplate);
targetSession.commit({ opId: "f107-import", baseRevision: 0, commandId: "PAGESETUP_TEMPLATE_IMPORT", args: {}, targetHandles: [], resultHandles: [] }, imported.changes, "2026-08-29T00:00:00.000Z");
const kdrawBytes = await serializeKDraw(targetSession.document, [], "2026-08-29T00:00:00.000Z");
const restored = await deserializeKDraw(kdrawBytes);
const restoredLibrary = resolvePageSetupLibrary(restored.document);
const templateMutation = structuredClone(browserTemplate);
templateMutation.pageSetups[0].pageSetup.plotStyle.profile = "color";
for (const layout of templateMutation.layouts) {
  if (layout.pageSetupId === templateMutation.pageSetups[0].id) layout.pageSetup.plotStyle.profile = "color";
}
const mutationBytes = serializePageSetupTemplate(templateMutation);
const dangling = structuredClone(browserTemplate);
dangling.layouts[1].pageSetupId = "missing";
let danglingRejected = false;
try { parsePageSetupTemplate(JSON.stringify(dangling)); } catch { danglingRejected = true; }
const stale = structuredClone(browserTemplate);
stale.layouts[1].pageSetup.plotStyle.profile = "color";
let staleRejected = false;
try { parsePageSetupTemplate(JSON.stringify(stale)); } catch { staleRejected = true; }
const checks = {
  browserAuthorityPassed: browser.status === "PASS" && Object.values(browser.checks ?? {}).every((value) => value === true),
  productionBytesMatchBrowser: productionTemplate === browserTemplateBytes.toString("utf8"),
  deterministicTemplate: serializePageSetupTemplate(browserTemplate) === browserTemplateBytes.toString("utf8"),
  mutationSensitive: sha256(mutationBytes) !== sha256(browserTemplateBytes),
  danglingRejected,
  staleRejected,
  kdrawChecksumReadback: new TextDecoder().decode(kdrawBytes).startsWith("KDRAW1\n") && restored.manifest.entries.length === 1 && restored.attachments.size === 0,
  drawingGeometryPreserved: restored.document.entities.map((entity) => entity.handle).join("|") === "10|11" && restored.document.layouts[1]?.entities?.map((entity) => entity.handle).join("|") === "12" && restored.document.layouts[2]?.entities?.length === 0,
  importedLayoutAndReference: restored.document.layouts[2]?.name === "F-107 ISSUE LAYOUT (2)" && restoredLibrary.setups[0]?.name === "F-107 A4 FINAL" && restoredLibrary.assignments["layout-2"] === "page-setup-1",
};
if (Object.values(checks).some((value) => value !== true)) throw new Error(`F-107 independent read-back mismatch: ${JSON.stringify(checks)}`);
await mkdir(artifacts, { recursive: true });
await writeFile(resolve(artifacts, "F-107-independent.kdraw"), kdrawBytes);
const sourcePaths = {
  runner: "tools/parity/run-f107-readback.mjs",
  fixture: "parity/fixtures/f107-document.ts",
  library: "packages/cad-core/src/page-setups.ts",
  container: "packages/cad-core/src/container.ts",
};
const result = {
  schemaVersion: 1,
  rowId: "F-107",
  source: "Exact production template serialization plus checksum-verified KDRAW1 import/reopen and mutation/dangling-reference rejection",
  sourceSha256: {
    ...Object.fromEntries(await Promise.all(Object.entries(sourcePaths).map(async ([key, path]) => [key, sha256(await readFile(resolve(root, path)))]))),
    browserEvidence: sha256(browserEvidenceBytes),
    browserTemplate: sha256(browserTemplateBytes),
  },
  template: { bytes: browserTemplateBytes.byteLength, sha256: sha256(browserTemplateBytes), parsed: browserTemplate },
  kdraw: { bytes: kdrawBytes.byteLength, sha256: sha256(kdrawBytes), manifest: restored.manifest },
  restored: { revision: restored.document.revision, layouts: restored.document.layouts, library: restoredLibrary, modelEntityHandles: restored.document.entities.map((entity) => entity.handle) },
  mutations: { plotProfileSha256: sha256(mutationBytes), danglingRejected, staleRejected },
  checks,
  status: "PASS",
};
await writeFile(resolve(artifacts, "F-107-independent-readback.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log("F-107 production template/KDRAW1 independent read-back PASS.");
