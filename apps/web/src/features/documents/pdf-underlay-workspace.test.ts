import { createEmptyDocument } from "@kuubik/cad-core";
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import golden from "./pdf-underlay-workspace.golden.json";
import { KDrawIndexedDb } from "../../indexed-db.js";
import { DocumentLiveOrchestrator } from "./document-live-orchestrator.js";
import { PdfUnderlayWorkspace } from "./pdf-underlay-workspace.js";

function pdfBytes(secondWidth = 1190): Uint8Array {
  return new TextEncoder().encode(`%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >> endobj
4 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 ${secondWidth} 842] >> endobj
trailer << /Root 1 0 R >>
%%EOF
`);
}

function document() {
  const value = createEmptyDocument({ documentId: "f115-workspace", now: "2026-09-01T08:00:00.000Z" });
  value.layers.push({ id: "pdf", name: "PDF", visible: true, frozen: false, locked: false, plottable: true });
  return value;
}

describe("F-115 PDF underlay workspace wiring", () => {
  it("persists attach/update/reload/Undo/Redo and crash recovery with exact byte read-back", async () => {
    const factory = new IDBFactory();
    const database = new KDrawIndexedDb(factory, "f115-workspace-test");
    const live = new DocumentLiveOrchestrator(database, "f115-crashed");
    await live.open({ documentId: "f115-workspace", fallbackDocument: document(), sourceFileName: "f115.kdraw" });
    const workspace = new PdfUnderlayWorkspace(live, "f115-workspace", "f115-test");
    const attached = await workspace.attach({
      attachmentId: "pdf-v1", placementId: "underlay", bytes: pdfBytes(), fileName: "source-v1.pdf", pageNumber: 2,
      position: { x: 25, y: 40 }, scale: 0.5, rotationRad: Math.PI / 6, opacity: 0.8, fadePercent: 25,
      layerId: "pdf", referencePath: "references/source-v1.pdf", referenceMode: "linked-copy",
      clipBoundary: [{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.1 }, { x: 0.9, y: 0.9 }, { x: 0.1, y: 0.9 }],
    }, "2026-09-01T08:01:00.000Z");
    expect(attached).toMatchObject({ revision: 1, placements: [{ pageCount: 2, byteLength: 296, layer: { reason: "ok" } }] });
    expect(attached.placements[0]!.effectiveOpacity).toBeCloseTo(0.6, 12);

    const updated = await workspace.update("underlay", { opacity: 0.5, fadePercent: 40, rotationRad: Math.PI / 4 }, "2026-09-01T08:02:00.000Z");
    expect(updated).toMatchObject({ revision: 2, placements: [{ placement: { referencePath: "references/source-v1.pdf" } }] });
    expect(updated.placements[0]!.effectiveOpacity).toBeCloseTo(0.3, 12);

    const reloaded = await workspace.reload("underlay", { attachmentId: "pdf-v2", bytes: pdfBytes(1200), fileName: "source-v2.pdf", referencePath: "references/source-v2.pdf" }, "2026-09-01T08:03:00.000Z");
    expect(reloaded).toMatchObject({ revision: 3, placements: [{ pageCount: 2, placement: { attachmentId: "pdf-v2", referencePath: "references/source-v2.pdf" } }] });
    const reloadedSha = reloaded.placements[0]!.sha256;

    const undone = await workspace.undo("2026-09-01T08:04:00.000Z");
    expect(undone).toMatchObject({ revision: 4, placements: [{ placement: { attachmentId: "pdf-v1", referencePath: "references/source-v1.pdf" } }] });
    const redone = await workspace.redo("2026-09-01T08:05:00.000Z");
    expect(redone).toMatchObject({ revision: 5, placements: [{ sha256: reloadedSha, placement: { attachmentId: "pdf-v2" } }] });

    database.close();
    const recoveredDatabase = new KDrawIndexedDb(factory, "f115-workspace-test");
    const recoveredLive = new DocumentLiveOrchestrator(recoveredDatabase, "f115-recovered");
    const recovery = await recoveredLive.open({ documentId: "f115-workspace", sourceFileName: "f115.kdraw" });
    const recovered = await new PdfUnderlayWorkspace(recoveredLive, "f115-workspace", "f115-recovered").readBack();
    expect({
      revision: recovered.revision,
      recoveryCode: recovery.recovery.receipt.code,
      ignoredOperationIds: recovery.recovery.ignoredOperationIds,
      placement: recovered.placements[0]!.placement,
      sha256: recovered.placements[0]!.sha256,
      byteLength: recovered.placements[0]!.byteLength,
      pageCount: recovered.placements[0]!.pageCount,
      effectiveOpacity: recovered.placements[0]!.effectiveOpacity,
      layer: recovered.placements[0]!.layer,
    }).toEqual(golden);
    recoveredDatabase.close();
  });

  it("rejects locked/off/frozen layer edits without changing revision", async () => {
    const factory = new IDBFactory();
    const database = new KDrawIndexedDb(factory, "f115-layer-test");
    const live = new DocumentLiveOrchestrator(database, "f115-layer");
    await live.open({ documentId: "f115-workspace", fallbackDocument: document() });
    const workspace = new PdfUnderlayWorkspace(live, "f115-workspace", "f115-layer");
    await workspace.attach({ attachmentId: "pdf-v1", placementId: "underlay", bytes: pdfBytes(), fileName: "source.pdf", pageNumber: 1, layerId: "pdf" });
    const locked = structuredClone(live.document("f115-workspace").layers.find((layer) => layer.id === "pdf")!); locked.locked = true;
    await live.commit("f115-workspace", { opId: "lock", baseRevision: 1, commandId: "LAYER_LOCK", args: {}, targetHandles: [], resultHandles: [] }, [{ type: "put-layer", layer: locked }]);
    await expect(workspace.update("underlay", { opacity: 0.2 })).rejects.toThrow(/layer-locked/u);
    expect(live.document("f115-workspace").revision).toBe(2);
    database.close();
  });
});
