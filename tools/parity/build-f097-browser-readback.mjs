#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const artifactRoot = resolve(root, "evidence/artifacts");
const matrix = JSON.parse(await readFile(resolve(artifactRoot, "F-097-browser-layout-tabs.json"), "utf8"));
const createRename = JSON.parse(await readFile(resolve(artifactRoot, "F-097-browser-create-rename.json"), "utf8"));
const paperDomain = JSON.parse(await readFile(resolve(artifactRoot, "F-097-browser-paper-domain.json"), "utf8"));
const bytes = await readFile(resolve(artifactRoot, "F-097-browser-layout-tabs.kdraw"));
const text = bytes.toString("utf8");
if (!text.startsWith("KDRAW1\n")) throw new Error("F-097 browser .kdraw magic mismatch.");
const envelope = JSON.parse(text.slice("KDRAW1\n".length));
const documentBytes = Buffer.from(envelope.files?.["document.json"] ?? "", "base64");
const entry = envelope.manifest?.entries?.find((candidate) => candidate.path === "document.json");
const document = JSON.parse(documentBytes.toString("utf8"));
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const result = {
  schemaVersion: 1,
  rowId: "F-097",
  source: "Chromium IndexedDB operations and downloaded production KDRAW1 independently decoded",
  matrix,
  createRename,
  paperDomain,
  container: { sha256: sha256(bytes), documentSha256: sha256(documentBytes), bytes: bytes.byteLength },
  document,
  status: "PASS",
};
if (
  matrix.rowId !== "F-097" || matrix.status !== "PASS" || matrix.finalRevision !== 6 ||
  createRename.rowId !== "F-097" || createRename.status !== "PASS" || createRename.afterRedo?.revision !== 7 ||
  createRename.duplicateRejected !== true || !/^LAYOUT viga: Layout name already exists/u.test(createRename.duplicateError ?? "") ||
  createRename.beforeUndo?.layouts?.map((layout) => layout.name).join("|") !== "Model|F097 PLAN|Layout 1" ||
  createRename.afterUndo?.layouts?.map((layout) => layout.name).join("|") !== "Model|Layout 1" ||
  createRename.afterRedo?.layouts?.map((layout) => layout.name).join("|") !== "Model|F097 PLAN|Layout 1" ||
  createRename.operations?.map((operation) => operation.commandId).join("|") !== "LAYOUT_CREATE|LAYOUT_RENAME|LAYOUT_CREATE|UNDO|UNDO|LAYOUT_RENAME|LAYOUT_CREATE" ||
  !createRename.operations?.slice(-2).every((operation) => operation.opId.includes(":redo:")) ||
  paperDomain.rowId !== "F-097" || paperDomain.status !== "PASS" ||
  paperDomain.modelUndoBlockedInPaper !== true || paperDomain.modelRedoBlockedInPaper !== true ||
  JSON.stringify(paperDomain.beforeBlockedUndo) !== JSON.stringify(paperDomain.afterBlockedUndo) ||
  JSON.stringify(paperDomain.beforeBlockedRedo) !== JSON.stringify(paperDomain.afterBlockedRedo) ||
  paperDomain.beforeBlockedUndo?.entities?.length !== 1 || paperDomain.beforeBlockedRedo?.entities?.length !== 0 ||
  matrix.operations?.map((operation) => operation.commandId).join("|") !== "LAYOUT_COPY|LAYOUT_REORDER|LAYOUT_REORDER|LAYOUT_DELETE|UNDO|LAYOUT_DELETE" ||
  matrix.layouts?.map((layout) => layout.name).join("|") !== "Model|F097 NOTES|F097 PLAN" ||
  !entry || entry.byteLength !== documentBytes.byteLength || entry.sha256 !== sha256(documentBytes) ||
  document.layouts?.map((layout) => layout.name).join("|") !== "Model|F097 NOTES|F097 PLAN" ||
  document.layouts?.find((layout) => layout.name === "F097 PLAN")?.entities?.[0]?.radius !== 25
) throw new Error(`F-097 browser capture mismatch: ${JSON.stringify(result)}`);
await writeFile(resolve(artifactRoot, "F-097-browser-readback.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log("F-097 Chromium IndexedDB operations and production KDRAW1 read-back PASS.");
