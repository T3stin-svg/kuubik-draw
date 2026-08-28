#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { CadSession, createEmptyDocument, createPaperLayout, createPaperViewport, deletePaperViewport, serializeKDraw } from "../../packages/cad-core/dist/index.js";

const root = process.cwd();
const artifactRoot = resolve(root, "evidence/artifacts");
await mkdir(artifactRoot, { recursive: true });
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function operation(baseRevision, commandId, args = {}) {
  return { opId: `F-099-${commandId}-${baseRevision}`, baseRevision, commandId, args, targetHandles: [], resultHandles: [] };
}

function independentRead(bytes) {
  const text = Buffer.from(bytes).toString("utf8");
  if (!text.startsWith("KDRAW1\n")) throw new Error("F-099 KDRAW1 magic mismatch.");
  const envelope = JSON.parse(text.slice("KDRAW1\n".length));
  const documentBytes = Buffer.from(envelope.files?.["document.json"] ?? "", "base64");
  const entry = envelope.manifest?.entries?.find((candidate) => candidate.path === "document.json");
  if (!entry || entry.byteLength !== documentBytes.byteLength || entry.sha256 !== sha256(documentBytes)) {
    throw new Error("F-099 independent manifest checksum mismatch.");
  }
  return {
    document: JSON.parse(documentBytes.toString("utf8")),
    containerSha256: sha256(bytes),
    documentSha256: sha256(documentBytes),
  };
}

const source = createEmptyDocument({ documentId: "F-099-readback", now: "2026-08-28T00:00:00.000Z" });
source.entities.push(
  { kind: "circle", handle: "10", layerId: "0", center: { x: 0, y: 0 }, radius: 220 },
  { kind: "circle", handle: "11", layerId: "0", center: { x: 2000, y: 0 }, radius: 220 },
);
const paper = createPaperLayout(source, {
  name: "F099 VIEWPORTS",
  paper: { widthMm: 420, heightMm: 297, marginsMm: { top: 10, right: 10, bottom: 10, left: 10 } },
  viewports: [],
});
const session = new CadSession({ ...source, layouts: paper.layouts });
const first = createPaperViewport(session.document, paper.layoutId, {
  center: { x: 108.75, y: 148.5 }, width: 197.5, height: 277,
  viewCenter: { x: 0, y: 0 }, viewHeight: 1200, twistAngleRad: 0, locked: false,
});
session.commit(operation(0, "VIEWPORT_CREATE", { kind: "rectangle", viewportId: first.viewportId }), first.changes, "2026-08-28T00:00:01.000Z");
const clipBoundary = [
  { x: 212.5, y: 70.94 }, { x: 255.95, y: 10 }, { x: 366.55, y: 10 },
  { x: 410, y: 115.26 }, { x: 386.3, y: 287 }, { x: 236.2, y: 287 },
];
const second = createPaperViewport(session.document, paper.layoutId, {
  center: { x: 311.25, y: 148.5 }, width: 197.5, height: 277,
  viewCenter: { x: 2000, y: 0 }, viewHeight: 1200, twistAngleRad: 0, locked: false,
  clipBoundary,
});
session.commit(operation(1, "VIEWPORT_CREATE", { kind: "polygon", viewportId: second.viewportId }), second.changes, "2026-08-28T00:00:02.000Z");
const multipleBytes = Buffer.from(await serializeKDraw(session.document, [], "2026-08-28T00:00:02.000Z"));
const multipleRead = independentRead(multipleBytes);
const multipleLayout = multipleRead.document.layouts.find((layout) => layout.id === paper.layoutId);

const deleted = deletePaperViewport(session.document, paper.layoutId, second.viewportId);
session.commit(operation(2, "VIEWPORT_DELETE", { viewportId: second.viewportId }), deleted.changes, "2026-08-28T00:00:03.000Z");
const afterDelete = structuredClone(session.document.layouts[1].viewports);
session.undo("2026-08-28T00:00:04.000Z");
const afterUndo = structuredClone(session.document.layouts[1].viewports);
session.redo("2026-08-28T00:00:05.000Z");
const afterRedo = structuredClone(session.document.layouts[1].viewports);
const finalBytes = Buffer.from(await serializeKDraw(session.document, [], "2026-08-28T00:00:05.000Z"));
const finalRead = independentRead(finalBytes);

const result = {
  schemaVersion: 1,
  rowId: "F-099",
  source: "production viewport transaction kernel and serializer; independent KDRAW1 magic/base64/length/SHA/document reader",
  multiple: {
    revision: multipleRead.document.revision,
    layout: multipleLayout,
    containerSha256: multipleRead.containerSha256,
    documentSha256: multipleRead.documentSha256,
  },
  atomicDelete: { selectedAfterDelete: deleted.viewportId, afterDelete, afterUndo, afterRedo },
  final: {
    revision: finalRead.document.revision,
    layout: finalRead.document.layouts.find((layout) => layout.id === paper.layoutId),
    containerSha256: finalRead.containerSha256,
    documentSha256: finalRead.documentSha256,
  },
  status: "PASS",
};

if (
  multipleRead.document.revision !== 2 || multipleLayout?.viewports?.length !== 2 ||
  multipleLayout.viewports[0]?.id !== "viewport-1" || multipleLayout.viewports[1]?.id !== "viewport-2" ||
  multipleLayout.viewports[0]?.viewCenter?.x !== 0 || multipleLayout.viewports[1]?.viewCenter?.x !== 2000 ||
  JSON.stringify(multipleLayout.viewports[1]?.clipBoundary) !== JSON.stringify(clipBoundary) ||
  deleted.viewportId !== "viewport-1" || afterDelete.length !== 1 || afterUndo.length !== 2 || afterRedo.length !== 1 ||
  afterUndo[1]?.id !== "viewport-2" || JSON.stringify(afterUndo[1]?.clipBoundary) !== JSON.stringify(clipBoundary) ||
  finalRead.document.revision !== 5 || finalRead.document.layouts[1]?.viewports?.length !== 1 ||
  finalRead.document.layouts[1]?.viewports?.[0]?.id !== "viewport-1"
) throw new Error(`F-099 independent read-back mismatch: ${JSON.stringify(result)}`);

await writeFile(resolve(artifactRoot, "F-099-multiple-viewports.kdraw"), multipleBytes);
await writeFile(resolve(artifactRoot, "F-099-after-delete.kdraw"), finalBytes);
await writeFile(resolve(artifactRoot, "F-099-independent-readback.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log("F-099 two independent viewports + polygon clip + delete/undo/redo KDRAW1 read-back PASS.");
