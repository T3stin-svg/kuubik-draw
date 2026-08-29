#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  CadSession,
  createEmptyDocument,
  createPaperLayout,
  createPaperViewport,
  panPaperViewportByPixels,
  serializeKDraw,
  setPaperViewportDisplayLocked,
  setPaperViewportView,
  zoomPaperViewportAtModelPoint,
} from "../../packages/cad-core/dist/index.js";

const root = process.cwd();
const artifactRoot = resolve(root, "evidence/artifacts");
await mkdir(artifactRoot, { recursive: true });
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const operation = (baseRevision, commandId, args = {}, resultHandles = []) => ({
  opId: `F-101-${commandId}-${baseRevision}`,
  baseRevision,
  commandId,
  args,
  targetHandles: [],
  resultHandles,
});

function independentRead(bytes) {
  const text = Buffer.from(bytes).toString("utf8");
  if (!text.startsWith("KDRAW1\n")) throw new Error("F-101 KDRAW1 magic mismatch.");
  const envelope = JSON.parse(text.slice("KDRAW1\n".length));
  const documentBytes = Buffer.from(envelope.files?.["document.json"] ?? "", "base64");
  const entry = envelope.manifest?.entries?.find((candidate) => candidate.path === "document.json");
  if (!entry || entry.byteLength !== documentBytes.byteLength || entry.sha256 !== sha256(documentBytes)) {
    throw new Error("F-101 independent manifest checksum mismatch.");
  }
  return {
    document: JSON.parse(documentBytes.toString("utf8")),
    containerSha256: sha256(bytes),
    documentSha256: sha256(documentBytes),
  };
}

const source = createEmptyDocument({ documentId: "F-101-readback", now: "2026-08-28T00:00:00.000Z" });
source.entities.push({ kind: "line", handle: "10", layerId: "0", start: { x: 0, y: 0 }, end: { x: 1000, y: 0 } });
const paper = createPaperLayout(source, {
  name: "F101 LOCK",
  paper: { widthMm: 420, heightMm: 297, marginsMm: { top: 10, right: 10, bottom: 10, left: 10 } },
  viewports: [],
});
const created = createPaperViewport({ ...source, layouts: paper.layouts }, paper.layoutId, {
  center: { x: 210, y: 148.5 }, width: 400, height: 277,
  viewCenter: { x: 128.5, y: 97.5 }, viewHeight: 1000, twistAngleRad: 0, locked: false,
});
const session = new CadSession({ ...source, layouts: created.layouts });
const viewportId = created.viewportId;
const initialViewport = structuredClone(session.document.layouts[1].viewports[0]);

const lockedResult = setPaperViewportDisplayLocked(session.document, paper.layoutId, viewportId, true);
session.commit(operation(0, "VIEWPORT_LOCK", { locked: true }), lockedResult.changes, "2026-08-28T00:00:01.000Z");
const lockedViewport = structuredClone(session.document.layouts[1].viewports[0]);
const beforeRefusal = session.document;
let zoomRefusal = null;
let panRefusal = null;
let directRefusal = null;
try { zoomPaperViewportAtModelPoint(session.document, paper.layoutId, viewportId, { x: 400, y: 200 }, 0.5); } catch (error) { zoomRefusal = { name: error.name, code: error.code, message: error.message }; }
try { panPaperViewportByPixels(session.document, paper.layoutId, viewportId, { x: 80, y: -50 }, { width: 1000, height: 692.5 }); } catch (error) { panRefusal = { name: error.name, code: error.code, message: error.message }; }
try { setPaperViewportView(session.document, paper.layoutId, viewportId, { viewCenter: { x: 700, y: 350 }, scaleDenominator: 25, twistAngleRad: Math.PI / 12 }); } catch (error) { directRefusal = { name: error.name, code: error.code, message: error.message }; }
const afterRefusal = session.document;

session.commit(operation(1, "LINE", {}, ["11"]), [{
  type: "put",
  entity: { kind: "line", handle: "11", layerId: "0", start: { x: 100, y: 50 }, end: { x: 1100, y: 50 } },
}], "2026-08-28T00:00:02.000Z");
const afterModelEdit = session.document;
const unlockedResult = setPaperViewportDisplayLocked(session.document, paper.layoutId, viewportId, false);
session.commit(operation(2, "VIEWPORT_LOCK", { locked: false }), unlockedResult.changes, "2026-08-28T00:00:03.000Z");
const unlockedViewport = structuredClone(session.document.layouts[1].viewports[0]);
const viewResult = setPaperViewportView(session.document, paper.layoutId, viewportId, {
  viewCenter: { x: 500, y: 250 }, scaleDenominator: 5, twistAngleRad: 0,
});
session.commit(operation(3, "VIEWPORT_VIEW", { viewCenter: { x: 500, y: 250 }, scaleDenominator: 5 }), viewResult.changes, "2026-08-28T00:00:04.000Z");
const pannedResult = panPaperViewportByPixels(session.document, paper.layoutId, viewportId, { x: 80, y: -50 }, { width: 1000, height: 692.5 });
session.commit(operation(4, "VIEWPORT_PAN", { deltaPx: { x: 80, y: -50 } }), pannedResult.changes, "2026-08-28T00:00:05.000Z");
const navigatedViewport = structuredClone(session.document.layouts[1].viewports[0]);
const relockedResult = setPaperViewportDisplayLocked(session.document, paper.layoutId, viewportId, true);
session.commit(operation(5, "VIEWPORT_LOCK", { locked: true }), relockedResult.changes, "2026-08-28T00:00:06.000Z");
const relockedViewport = structuredClone(session.document.layouts[1].viewports[0]);
session.undo("2026-08-28T00:00:07.000Z");
const afterUndo = structuredClone(session.document.layouts[1].viewports[0]);
session.redo("2026-08-28T00:00:08.000Z");
const afterRedo = structuredClone(session.document.layouts[1].viewports[0]);

const bytes = Buffer.from(await serializeKDraw(session.document, [], "2026-08-28T00:00:08.000Z"));
const read = independentRead(bytes);
const restoredViewport = read.document.layouts.find((layout) => layout.id === paper.layoutId)?.viewports?.[0];
const result = {
  schemaVersion: 1,
  rowId: "F-101",
  observedAt: new Date().toISOString(),
  source: "production display-lock transaction kernel and serializer; independent KDRAW1 magic/base64/length/SHA/document reader",
  initialViewport,
  lockedViewport,
  refusals: { zoom: zoomRefusal, pan: panRefusal, direct: directRefusal, revisionBefore: beforeRefusal.revision, revisionAfter: afterRefusal.revision, cameraUnchanged: JSON.stringify(beforeRefusal.layouts[1].viewports[0]) === JSON.stringify(afterRefusal.layouts[1].viewports[0]) },
  modelEdit: { revision: afterModelEdit.revision, entity: afterModelEdit.entities.find((entity) => entity.handle === "11"), viewport: afterModelEdit.layouts[1].viewports[0] },
  unlockedViewport,
  navigatedViewport,
  relockedViewport,
  atomic: { afterUndo, afterRedo },
  container: { bytes: bytes.byteLength, sha256: read.containerSha256, documentSha256: read.documentSha256 },
  document: { revision: read.document.revision, entityCount: read.document.entities.length, viewport: restoredViewport },
  status: "PASS",
};

if (
  initialViewport.locked !== false || lockedViewport.locked !== true ||
  zoomRefusal?.code !== "VIEWPORT_LOCKED" || panRefusal?.code !== "VIEWPORT_LOCKED" || directRefusal?.code !== "VIEWPORT_LOCKED" ||
  beforeRefusal.revision !== 1 || afterRefusal.revision !== 1 || result.refusals.cameraUnchanged !== true ||
  afterModelEdit.revision !== 2 || result.modelEdit.entity?.start?.x !== 100 || result.modelEdit.entity?.start?.y !== 50 || result.modelEdit.viewport?.locked !== true ||
  unlockedViewport.locked !== false || navigatedViewport.viewCenter.x === unlockedViewport.viewCenter.x || navigatedViewport.viewCenter.y === unlockedViewport.viewCenter.y ||
  relockedViewport.locked !== true || JSON.stringify({ ...relockedViewport, locked: false }) !== JSON.stringify(navigatedViewport) ||
  afterUndo.locked !== false || JSON.stringify(afterRedo) !== JSON.stringify(relockedViewport) ||
  read.document.revision !== 8 || read.document.entities.length !== 2 || !restoredViewport || JSON.stringify(restoredViewport) !== JSON.stringify(relockedViewport)
) throw new Error(`F-101 independent read-back mismatch: ${JSON.stringify(result)}`);

await writeFile(resolve(artifactRoot, "F-101-viewport-lock.kdraw"), bytes);
await writeFile(resolve(artifactRoot, "F-101-independent-readback.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log("F-101 lock/refusal/model-edit/unlock/navigation/relock/atomic KDRAW1 read-back PASS.");
