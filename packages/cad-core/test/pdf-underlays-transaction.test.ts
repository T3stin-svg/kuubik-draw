import { describe, expect, it } from "vitest";
import type { CadAttachmentRef, CadOperation } from "@kuubik/cad-schema";
import {
  CadSession,
  createEmptyDocument,
  planAddPdfUnderlay,
  planRemovePdfUnderlay,
  readPdfUnderlays,
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
});
