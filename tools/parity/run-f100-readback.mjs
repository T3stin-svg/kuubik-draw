#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  CadSession,
  createEmptyDocument,
  createPaperLayout,
  createPaperViewport,
  formatViewportScale,
  panPaperViewportByPixels,
  serializeKDraw,
  setPaperViewportView,
  viewportModelToNormalized,
  viewportNormalizedToModel,
  viewportScaleDenominator,
  zoomPaperViewportAtModelPoint,
} from "../../packages/cad-core/dist/index.js";

const root = process.cwd();
const artifactRoot = resolve(root, "evidence/artifacts");
await mkdir(artifactRoot, { recursive: true });
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function operation(baseRevision, commandId, args = {}) {
  return { opId: `F-100-${commandId}-${baseRevision}`, baseRevision, commandId, args, targetHandles: [], resultHandles: [] };
}

function independentRead(bytes) {
  const text = Buffer.from(bytes).toString("utf8");
  if (!text.startsWith("KDRAW1\n")) throw new Error("F-100 KDRAW1 magic mismatch.");
  const envelope = JSON.parse(text.slice("KDRAW1\n".length));
  const documentBytes = Buffer.from(envelope.files?.["document.json"] ?? "", "base64");
  const entry = envelope.manifest?.entries?.find((candidate) => candidate.path === "document.json");
  if (!entry || entry.byteLength !== documentBytes.byteLength || entry.sha256 !== sha256(documentBytes)) {
    throw new Error("F-100 independent manifest checksum mismatch.");
  }
  return { document: JSON.parse(documentBytes.toString("utf8")), containerSha256: sha256(bytes), documentSha256: sha256(documentBytes) };
}

const source = createEmptyDocument({ documentId: "F-100-readback", now: "2026-08-28T00:00:00.000Z" });
source.entities.push({ kind: "line", handle: "10", layerId: "0", start: { x: -2000, y: -500 }, end: { x: 4000, y: -500 } });
const paper = createPaperLayout(source, {
  name: "F100 VIEW",
  paper: { widthMm: 420, heightMm: 297, marginsMm: { top: 10, right: 10, bottom: 10, left: 10 } },
  viewports: [],
});
const created = createPaperViewport({ ...source, layouts: paper.layouts }, paper.layoutId, {
  center: { x: 210, y: 148.5 }, width: 400, height: 277,
  viewCenter: { x: 0, y: 0 }, viewHeight: 13850, twistAngleRad: 0, locked: false,
});
const session = new CadSession({ ...source, layouts: created.layouts });
const viewportId = created.viewportId;

const preset = setPaperViewportView(session.document, paper.layoutId, viewportId, {
  viewCenter: { x: 1000, y: -500 }, scaleDenominator: 20, twistAngleRad: Math.PI / 6,
});
session.commit(operation(0, "VIEWPORT_VIEW", { scaleDenominator: 20, viewCenter: { x: 1000, y: -500 }, twistAngleRad: Math.PI / 6 }), preset.changes, "2026-08-28T00:00:01.000Z");
const presetViewport = structuredClone(session.document.layouts[1].viewports[0]);
const normalizedCursor = { x: -0.28, y: 0.15 };
const anchorModel = viewportNormalizedToModel(presetViewport, normalizedCursor);
const anchorBefore = viewportModelToNormalized(presetViewport, anchorModel);

const zoomed = zoomPaperViewportAtModelPoint(session.document, paper.layoutId, viewportId, anchorModel, 1 / 1.1);
session.commit(operation(1, "VIEWPORT_ZOOM", { anchorModel, scaleFactor: 1 / 1.1 }), zoomed.changes, "2026-08-28T00:00:02.000Z");
const zoomedViewport = structuredClone(session.document.layouts[1].viewports[0]);
const anchorAfter = viewportModelToNormalized(zoomedViewport, anchorModel);

const deltaPx = { x: 80, y: -50 };
const viewportPx = { width: 1000, height: 692.5 };
const panned = panPaperViewportByPixels(session.document, paper.layoutId, viewportId, deltaPx, viewportPx);
session.commit(operation(2, "VIEWPORT_PAN", { deltaPx, viewportPx }), panned.changes, "2026-08-28T00:00:03.000Z");
const pannedViewport = structuredClone(session.document.layouts[1].viewports[0]);
session.undo("2026-08-28T00:00:04.000Z");
const afterUndo = structuredClone(session.document.layouts[1].viewports[0]);
session.redo("2026-08-28T00:00:05.000Z");
const afterRedo = structuredClone(session.document.layouts[1].viewports[0]);

const bytes = Buffer.from(await serializeKDraw(session.document, [], "2026-08-28T00:00:05.000Z"));
const read = independentRead(bytes);
const restoredViewport = read.document.layouts.find((layout) => layout.id === paper.layoutId)?.viewports?.[0];
const result = {
  schemaVersion: 1,
  rowId: "F-100",
  observedAt: new Date().toISOString(),
  source: "production viewport view transaction kernel and serializer; independent KDRAW1 magic/base64/length/SHA/document reader",
  preset: { viewport: presetViewport, scaleDenominator: viewportScaleDenominator(presetViewport), scaleLabel: formatViewportScale(presetViewport) },
  cursorZoom: { normalizedCursor, anchorModel, anchorBefore, anchorAfter, viewport: zoomedViewport, scaleDenominator: viewportScaleDenominator(zoomedViewport), scaleLabel: formatViewportScale(zoomedViewport) },
  rotatedPan: { deltaPx, viewportPx, viewport: pannedViewport },
  atomic: { afterUndo, afterRedo },
  container: { bytes: bytes.byteLength, sha256: read.containerSha256, documentSha256: read.documentSha256 },
  document: { revision: read.document.revision, viewport: restoredViewport },
  status: "PASS",
};

const close = (a, b, tolerance = 1e-9) => Math.abs(a - b) <= tolerance;
if (
  presetViewport.viewCenter.x !== 1000 || presetViewport.viewCenter.y !== -500 ||
  !close(viewportScaleDenominator(presetViewport), 20, 1e-12) || !close(presetViewport.twistAngleRad, Math.PI / 6, 1e-12) ||
  formatViewportScale(presetViewport) !== "1:20" ||
  !close(anchorBefore.x, anchorAfter.x, 1e-12) || !close(anchorBefore.y, anchorAfter.y, 1e-12) ||
  !close(viewportScaleDenominator(zoomedViewport), 18.18181818181818, 1e-12) || formatViewportScale(zoomedViewport) !== "1:18.182 (Custom)" ||
  pannedViewport.viewCenter.x === zoomedViewport.viewCenter.x || pannedViewport.viewCenter.y === zoomedViewport.viewCenter.y ||
  !close(viewportScaleDenominator(pannedViewport), viewportScaleDenominator(zoomedViewport), 1e-12) ||
  !close(pannedViewport.twistAngleRad, zoomedViewport.twistAngleRad, 1e-12) ||
  JSON.stringify(afterUndo) !== JSON.stringify(zoomedViewport) || JSON.stringify(afterRedo) !== JSON.stringify(pannedViewport) ||
  read.document.revision !== 5 || !restoredViewport || JSON.stringify(restoredViewport) !== JSON.stringify(pannedViewport)
) throw new Error(`F-100 independent read-back mismatch: ${JSON.stringify(result)}`);

await writeFile(resolve(artifactRoot, "F-100-viewport-view.kdraw"), bytes);
await writeFile(resolve(artifactRoot, "F-100-independent-readback.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log("F-100 preset/custom scale + cursor-anchor zoom + rotated pan/twist + atomic KDRAW1 read-back PASS.");
