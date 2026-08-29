#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { CadSession, copyPaperLayout, createEmptyDocument, createPaperLayout, deletePaperLayout, movePaperLayout, serializeKDraw } from "../../packages/cad-core/dist/index.js";

const root = process.cwd();
const copyPath = resolve(root, "evidence/artifacts/F-097-copy-matrix.kdraw");
const finalPath = resolve(root, "evidence/artifacts/F-097-layout-tabs.kdraw");
const reportPath = resolve(root, "evidence/artifacts/F-097-independent-readback.json");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function operation(baseRevision, commandId, args = {}) {
  return { opId: `F-097-${commandId}-${baseRevision}`, baseRevision, commandId, args, targetHandles: [], resultHandles: [] };
}

function independentRead(bytes) {
  const text = Buffer.from(bytes).toString("utf8");
  if (!text.startsWith("KDRAW1\n")) throw new Error("F-097 .kdraw magic mismatch.");
  const envelope = JSON.parse(text.slice("KDRAW1\n".length));
  if (envelope.format !== "application/vnd.kuubik.kdraw+json" || envelope.manifest?.containerVersion !== 1) {
    throw new Error("F-097 .kdraw envelope mismatch.");
  }
  const entry = envelope.manifest.entries.find((candidate) => candidate.path === "document.json");
  const documentBytes = Buffer.from(envelope.files?.["document.json"] ?? "", "base64");
  if (!entry || documentBytes.byteLength !== entry.byteLength || sha256(documentBytes) !== entry.sha256) {
    throw new Error("F-097 independent manifest checksum mismatch.");
  }
  return { document: JSON.parse(documentBytes.toString("utf8")), documentSha256: entry.sha256, containerSha256: sha256(bytes) };
}

const session = new CadSession(createEmptyDocument({ documentId: "F-097", now: "2026-08-28T00:00:00.000Z" }));
const plan = createPaperLayout(session.document, {
  name: "F097 PLAN",
  paper: { widthMm: 420, heightMm: 297, marginsMm: { top: 5, right: 6, bottom: 7, left: 8 } },
  viewports: [{
    id: "f097-source-vp", center: { x: 210, y: 148.5 }, width: 390, height: 267,
    viewCenter: { x: 1250, y: -750 }, viewHeight: 5000, twistAngleRad: Math.PI / 12,
    locked: true, layerOverrides: { "0": { color: "#336699", frozen: true } },
  }],
  entities: [{ kind: "circle", handle: "20", layerId: "0", center: { x: 50, y: 50 }, radius: 25 }],
});
session.commit(operation(0, "LAYOUT_CREATE", { name: "F097 PLAN" }), plan.changes, "2026-08-28T00:00:01.000Z");
const notes = createPaperLayout(session.document, { name: "F097 NOTES" });
session.commit(operation(1, "LAYOUT_CREATE", { name: "F097 NOTES" }), notes.changes, "2026-08-28T00:00:02.000Z");
const copied = copyPaperLayout(session.document, plan.layoutId);
session.commit(operation(2, "LAYOUT_COPY", { sourceLayoutId: plan.layoutId }), copied.changes, "2026-08-28T00:00:03.000Z");

const editedLayouts = structuredClone(session.document.layouts);
const editedSource = editedLayouts.find((layout) => layout.id === plan.layoutId);
if (editedSource?.entities?.[0]?.kind !== "circle") throw new Error("F-097 source paper circle missing.");
editedSource.entities[0].radius = 30;
session.commit(operation(3, "LAYOUT_EDIT", { layoutId: plan.layoutId }), [{ type: "set-layouts", layouts: editedLayouts }], "2026-08-28T00:00:04.000Z");
const movedOnce = movePaperLayout(session.document, notes.layoutId, -1);
session.commit(operation(4, "LAYOUT_REORDER", { layoutId: notes.layoutId, delta: -1 }), movedOnce.changes, "2026-08-28T00:00:05.000Z");
const movedTwice = movePaperLayout(session.document, notes.layoutId, -1);
session.commit(operation(5, "LAYOUT_REORDER", { layoutId: notes.layoutId, delta: -1 }), movedTwice.changes, "2026-08-28T00:00:06.000Z");

const copyBytes = await serializeKDraw(session.document, [], "2026-08-28T00:00:06.000Z");
const copyRead = independentRead(copyBytes);
const copySource = copyRead.document.layouts.find((layout) => layout.id === plan.layoutId);
const copyLayout = copyRead.document.layouts.find((layout) => layout.id === copied.layoutId);
if (
  copyRead.document.layouts.map((layout) => layout.name).join("|") !== "Model|F097 NOTES|F097 PLAN (2)|F097 PLAN" ||
  copySource?.entities?.[0]?.radius !== 30 || copyLayout?.entities?.[0]?.radius !== 25 ||
  copySource.viewports?.[0]?.id === copyLayout.viewports?.[0]?.id ||
  copySource.entities?.[0]?.handle === copyLayout.entities?.[0]?.handle
) throw new Error("F-097 independent copy/reorder read-back mismatch.");

const deleted = deletePaperLayout(session.document, copied.layoutId);
if (deleted.layoutId !== plan.layoutId) throw new Error("F-097 adjacent activation target mismatch.");
session.commit(operation(6, "LAYOUT_DELETE", { layoutId: copied.layoutId }), deleted.changes, "2026-08-28T00:00:07.000Z");
const afterDelete = session.document.layouts.map((layout) => layout.name);
session.undo("2026-08-28T00:00:08.000Z");
const afterUndo = session.document.layouts.map((layout) => layout.name);
session.redo("2026-08-28T00:00:09.000Z");
const afterRedo = session.document.layouts.map((layout) => layout.name);
const finalBytes = await serializeKDraw(session.document, [], "2026-08-28T00:00:09.000Z");
const finalRead = independentRead(finalBytes);
if (
  afterDelete.join("|") !== "Model|F097 NOTES|F097 PLAN" ||
  afterUndo.join("|") !== "Model|F097 NOTES|F097 PLAN (2)|F097 PLAN" ||
  afterRedo.join("|") !== "Model|F097 NOTES|F097 PLAN" ||
  finalRead.document.layouts.map((layout) => layout.name).join("|") !== afterRedo.join("|") ||
  finalRead.document.layouts.find((layout) => layout.id === plan.layoutId)?.entities?.[0]?.radius !== 30
) throw new Error("F-097 delete/undo/redo/final read-back mismatch.");

const result = {
  schemaVersion: 1,
  rowId: "F-097",
  observedAt: new Date().toISOString(),
  source: "independent KDRAW1 magic/base64/SHA-256/JSON reader",
  copyMatrix: {
    layouts: copyRead.document.layouts,
    sourceLayoutId: plan.layoutId,
    copyLayoutId: copied.layoutId,
    documentSha256: copyRead.documentSha256,
    containerSha256: copyRead.containerSha256,
  },
  final: {
    layouts: finalRead.document.layouts,
    adjacentAfterDelete: deleted.layoutId,
    afterDelete,
    afterUndo,
    afterRedo,
    revision: finalRead.document.revision,
    documentSha256: finalRead.documentSha256,
    containerSha256: finalRead.containerSha256,
  },
  status: "PASS",
};
await mkdir(dirname(reportPath), { recursive: true });
await writeFile(copyPath, copyBytes);
await writeFile(finalPath, finalBytes);
await writeFile(reportPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log("F-097 create/copy-before-source/reorder/delete + independent viewport/entity ids + atomic undo/redo KDRAW1 read-back PASS.");
