import { createEmptyDocument } from "@kuubik/cad-core";
import { createPdfUnderlayPlacement, preparePdfUnderlay } from "@kuubik/cad-print";
import type { CadOperation } from "@kuubik/cad-schema";
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { KDrawIndexedDb } from "../../indexed-db.js";
import { DocumentLiveOrchestrator } from "./document-live-orchestrator.js";

function operation(opId: string, baseRevision: number, commandId = "LINE"): CadOperation {
  return { opId, baseRevision, commandId, args: {}, targetHandles: [], resultHandles: [] };
}

function pdfBytes(): Uint8Array {
  return new TextEncoder().encode("%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n");
}

describe("F-115/F-128/F-133 live document orchestrator", () => {
  it("rejects an unknown document before recording an open recovery boundary", async () => {
    const database = new KDrawIndexedDb(new IDBFactory());
    const live = new DocumentLiveOrchestrator(database, "missing-session");
    await expect(live.open({ documentId: "missing" })).rejects.toThrow(/No persisted or fallback document/u);
    expect(await database.recoverDocument("missing")).toEqual(expect.objectContaining({
      document: null,
      uncleanSessionIds: [],
    }));
    expect(live.readBack().tabs.tabOrder).toEqual([]);
    database.close();
  });

  it("atomically wires a PDF underlay through storage, session and tab read-back", async () => {
    const database = new KDrawIndexedDb(new IDBFactory());
    const live = new DocumentLiveOrchestrator(database, "unit-session");
    await live.open({ documentId: "pdf", fallbackDocument: createEmptyDocument({ documentId: "pdf" }) });
    const prepared = await preparePdfUnderlay(pdfBytes(), { attachmentId: "pdf-1", fileName: "fixture.pdf" });
    const placement = createPdfUnderlayPlacement(prepared, { id: "underlay-1", pageNumber: 1 });

    expect(await live.attachPdf("pdf", operation("pdf-op", 0, "PDFATTACH"), prepared, placement)).toEqual({
      attachment: prepared.attachment,
      placement,
      bytes: prepared.bytes,
    });
    expect(live.readBack()).toEqual(expect.objectContaining({
      tabs: expect.objectContaining({ tabs: [expect.objectContaining({ documentId: "pdf", revision: 1, persistedRevision: 1, dirty: false })] }),
      sessions: expect.objectContaining({ documents: [expect.objectContaining({ documentId: "pdf", revision: 1 })] }),
    }));
    expect(await database.loadDocument("pdf")).toEqual(live.document("pdf"));
    expect((await database.snapshots("pdf")).map((snapshot) => snapshot.revision)).toEqual([0, 1]);
    await live.close("pdf");
    database.close();
  });

  it("keeps every document independent across a deterministic multi-tab property matrix", async () => {
    const database = new KDrawIndexedDb(new IDBFactory());
    const live = new DocumentLiveOrchestrator(database, "property-session");
    const ids = Array.from({ length: 8 }, (_, index) => `document-${index}`);
    for (const [index, documentId] of ids.entries()) {
      const document = createEmptyDocument({ documentId });
      document.entities.push({ kind: "line", handle: `seed-${index}`, layerId: "0", start: { x: 0, y: index }, end: { x: 1, y: index } });
      await live.open({
        documentId,
        fallbackDocument: document,
        selectedHandles: [`seed-${index}`],
        viewport: { world: { minX: -index - 1, minY: -1, maxX: index + 2, maxY: 2 }, widthPx: 800 + index, heightPx: 600, devicePixelRatio: 1 },
      });
      await live.commit(documentId, operation(`op-${index}`, 0), [{
        type: "put",
        entity: { kind: "circle", handle: `circle-${index}`, layerId: "0", center: { x: index, y: index }, radius: index + 1 },
      }]);
    }

    const readback = live.readBack();
    expect(readback.tabs.tabOrder).toEqual(ids);
    expect(readback.tabs.activeDocumentId).toBe(ids.at(-1));
    expect(readback.sessions.documents).toHaveLength(ids.length);
    for (const [index, documentId] of ids.entries()) {
      expect(live.document(documentId)).toMatchObject({ documentId, revision: 1 });
      expect(live.document(documentId).entities.map((entity) => entity.handle)).toEqual([`seed-${index}`, `circle-${index}`]);
      expect(readback.sessions.documents[index]).toEqual(expect.objectContaining({ selectedHandles: [`seed-${index}`] }));
      expect(await database.loadDocument(documentId)).toEqual(live.document(documentId));
    }
    database.close();
  });

  it("does not publish a failed PDF mutation into the live session or tab state", async () => {
    const database = new KDrawIndexedDb(new IDBFactory());
    const live = new DocumentLiveOrchestrator(database, "mutation-session");
    await live.open({ documentId: "mutated", fallbackDocument: createEmptyDocument({ documentId: "mutated" }) });
    const prepared = await preparePdfUnderlay(pdfBytes(), { attachmentId: "pdf-1", fileName: "fixture.pdf" });
    const placement = createPdfUnderlayPlacement(prepared, { id: "underlay-1", pageNumber: 1 });

    await expect(live.attachPdf(
      "mutated",
      operation("bad-pdf", 0, "PDFATTACH"),
      { ...prepared, bytes: Uint8Array.from([1, 2, 3]) },
      placement,
    )).rejects.toThrow(/checksum mismatch/u);
    expect(live.document("mutated")).toMatchObject({ revision: 0, attachments: [] });
    expect(live.readBack().tabs.tabs[0]).toEqual(expect.objectContaining({ revision: 0, persistedRevision: 0, dirty: false }));
    expect(await database.operations("mutated")).toEqual([]);
    expect(await database.loadAttachment("mutated", "pdf-1")).toBeNull();
    database.close();
  });
});
