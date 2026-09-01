import { describe, expect, it } from "vitest";
import type { CadAttachmentRef, CadOperation } from "@kuubik/cad-schema";
import {
  addPdfUnderlay,
  CadSession,
  createEmptyDocument,
  planAddPdfUnderlay,
  planRemovePdfUnderlay,
  planReloadPdfUnderlay,
  planUpdatePdfUnderlay,
  readPdfUnderlays,
  resolvePdfUnderlayLayerState,
  type PdfUnderlayPlacement,
} from "../src/index.js";

const attachment: CadAttachmentRef = {
  id: "pdf-1",
  mediaType: "application/pdf",
  sha256: "a".repeat(64),
  fileName: "reference.pdf",
  role: "underlay",
};

const placement: PdfUnderlayPlacement = {
  id: "underlay-1",
  attachmentId: attachment.id,
  pageNumber: 1,
  position: { x: 10, y: 20 },
  widthMm: 210,
  heightMm: 297,
  rotationRad: 0,
  opacity: 0.75,
  visible: true,
};

function operation(opId: string, baseRevision: number, commandId: string): CadOperation {
  return { opId, baseRevision, commandId, args: {}, targetHandles: [], resultHandles: [] };
}

describe("F-115 atomic PDF attachment transaction", () => {
  it("commits attachment reference and placement as one Undo/Redo step", () => {
    const session = new CadSession(createEmptyDocument({ documentId: "pdf-atomic" }));
    session.commit(
      operation("pdf-attach", 0, "PDFATTACH"),
      planAddPdfUnderlay(session.document, { attachment, placement }),
      "2026-08-31T12:00:00Z",
    );
    expect(session.document.attachments).toEqual([attachment]);
    expect(readPdfUnderlays(session.document)).toEqual([placement]);
    expect(session.document.revision).toBe(1);

    session.undo("2026-08-31T12:01:00Z");
    expect(session.document.attachments).toEqual([]);
    expect(readPdfUnderlays(session.document)).toEqual([]);
    expect(session.document.revision).toBe(2);

    session.redo("2026-08-31T12:02:00Z");
    expect(session.document.attachments).toEqual([attachment]);
    expect(readPdfUnderlays(session.document)).toEqual([placement]);
    expect(session.document.revision).toBe(3);
  });

  it("detaches the final placement atomically but retains a shared attachment", () => {
    const document = createEmptyDocument({ documentId: "pdf-detach" });
    const second = { ...placement, id: "underlay-2", position: { x: 400, y: 20 } };
    const first = new CadSession(document);
    first.commit(operation("attach-first", 0, "PDFATTACH"), planAddPdfUnderlay(document, { attachment, placement }));
    const shared = structuredClone(first.document);
    shared.metadata.extensions!["kuubik.pdfUnderlays.v1"] = [placement, second];
    const session = new CadSession(shared);

    session.commit(operation("detach-first", 1, "PDFDETACH"), planRemovePdfUnderlay(session.document, placement.id));
    expect(session.document.attachments).toEqual([attachment]);
    expect(readPdfUnderlays(session.document)).toEqual([second]);

    session.commit(operation("detach-last", 2, "PDFDETACH"), planRemovePdfUnderlay(session.document, second.id));
    expect(session.document.attachments).toEqual([]);
    expect(readPdfUnderlays(session.document)).toEqual([]);
    session.undo();
    expect(session.document.attachments).toEqual([attachment]);
    expect(readPdfUnderlays(session.document)).toEqual([second]);
  });

  it("rejects malformed attachment digests before mutating the source", () => {
    const source = createEmptyDocument({ documentId: "pdf-invalid" });
    const session = new CadSession(source);
    expect(() => session.commit(
      operation("bad-attach", 0, "PDFATTACH"),
      planAddPdfUnderlay(source, { attachment: { ...attachment, sha256: "BAD" }, placement }),
    )).toThrow(/lowercase SHA-256/u);
    expect(session.document).toEqual(source);
  });

  it("persists clip, fade, reference path and transform updates as one Undo/Redo step", () => {
    const source = createEmptyDocument({ documentId: "pdf-properties" });
    source.layers.push({ id: "pdf", name: "PDF", visible: true, frozen: false, locked: false, plottable: true });
    const attached = new CadSession(source);
    const enhanced = { ...placement, layerId: "pdf", fadePercent: 25, referencePath: "references/level-01.pdf", referenceMode: "linked-copy" as const };
    attached.commit(operation("attach", 0, "PDFATTACH"), planAddPdfUnderlay(source, { attachment, placement: enhanced }));
    attached.commit(operation("update", 1, "PDFUNDERLAY_UPDATE"), planUpdatePdfUnderlay(attached.document, enhanced.id, {
      position: { x: 125, y: -20 }, rotationRad: Math.PI / 3, opacity: 0.8, fadePercent: 40,
      clipBoundary: [{ x: 0.1, y: 0.2 }, { x: 0.9, y: 0.2 }, { x: 0.9, y: 0.8 }, { x: 0.1, y: 0.8 }],
    }));
    expect(readPdfUnderlays(attached.document)[0]).toMatchObject({ position: { x: 125, y: -20 }, opacity: 0.8, fadePercent: 40 });
    attached.undo();
    expect(readPdfUnderlays(attached.document)[0]).toEqual(enhanced);
    attached.redo();
    expect(readPdfUnderlays(attached.document)[0]!.clipBoundary).toHaveLength(4);
  });

  it("enforces off, frozen and locked underlay layer participation", () => {
    const source = createEmptyDocument({ documentId: "pdf-layer-policy" });
    source.layers.push({ id: "pdf", name: "PDF", visible: true, frozen: false, locked: true, plottable: true });
    const withPdf = addPdfUnderlay(source, { attachment, placement: { ...placement, layerId: "pdf" } });
    expect(resolvePdfUnderlayLayerState(withPdf, readPdfUnderlays(withPdf)[0]!)).toEqual({
      layerId: "pdf", rendered: true, selectable: true, editable: false, reason: "layer-locked",
    });
    expect(() => planUpdatePdfUnderlay(withPdf, placement.id, { opacity: 0.2 })).toThrow(/layer-locked/u);
    const off = structuredClone(withPdf); off.layers.find((layer) => layer.id === "pdf")!.visible = false;
    expect(resolvePdfUnderlayLayerState(off, readPdfUnderlays(off)[0]!)).toMatchObject({ rendered: false, selectable: false, editable: false, reason: "layer-off" });
    const frozen = structuredClone(withPdf); const layer = frozen.layers.find((candidate) => candidate.id === "pdf")!; layer.locked = false; layer.frozen = true;
    expect(resolvePdfUnderlayLayerState(frozen, readPdfUnderlays(frozen)[0]!)).toMatchObject({ rendered: false, selectable: false, editable: false, reason: "layer-frozen" });
  });

  it("reloads through a new immutable attachment and restores the old reference on Undo", () => {
    const source = createEmptyDocument({ documentId: "pdf-reload" });
    const session = new CadSession(source);
    session.commit(operation("attach", 0, "PDFATTACH"), planAddPdfUnderlay(source, { attachment, placement }));
    const replacement = { ...attachment, id: "pdf-2", sha256: "b".repeat(64), fileName: "reference-v2.pdf" };
    const replacementPlacement = { ...placement, attachmentId: replacement.id, pageNumber: 2, referencePath: "reference-v2.pdf", referenceMode: "linked-copy" as const };
    session.commit(operation("reload", 1, "PDFRELOAD"), planReloadPdfUnderlay(session.document, placement.id, { attachment: replacement, placement: replacementPlacement }));
    expect(session.document.attachments).toEqual([replacement]);
    expect(readPdfUnderlays(session.document)).toEqual([replacementPlacement]);
    session.undo();
    expect(session.document.attachments).toEqual([attachment]);
    expect(readPdfUnderlays(session.document)).toEqual([placement]);
  });
});
