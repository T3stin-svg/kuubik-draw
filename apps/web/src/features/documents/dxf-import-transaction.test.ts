import { createEmptyDocument, DEFAULT_PAGE_SETUP, DEFAULT_PAPER_DEFINITION } from "@kuubik/cad-core";
import { exportDxf } from "@kuubik/cad-dxf";
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { KDrawIndexedDb } from "../../indexed-db.js";
import { DocumentLiveOrchestrator } from "./document-live-orchestrator.js";
import { importDxfIntoLiveDocument } from "./dxf-import-transaction.js";

function importSource() {
  const document = createEmptyDocument({ documentId: "source", units: "cm" });
  document.textStyles.push({ id: "iso", name: "ISO", fontFamily: "Arial", widthFactor: 1, obliqueAngleRad: 0 });
  document.blocks.push({ id: "symbol", name: "SYMBOL", basePoint: { x: 1, y: 2 }, entities: [{ kind: "circle", handle: "C0", layerId: "0", center: { x: 1, y: 1 }, radius: 0.5 }] });
  document.entities.push(
    { kind: "line", handle: "10", layerId: "0", start: { x: 0, y: 0 }, end: { x: 100, y: 20 } },
    { kind: "mtext", handle: "20", layerId: "0", position: { x: 5, y: 10 }, text: "F-110\nDXFIN", height: 0.35, rotationRad: 0, styleId: "iso", extensionData: { "kuubik.dxf.mtext.v1": { width: 6, attachment: 1 } } },
    { kind: "blockRef", handle: "30", layerId: "0", blockId: "symbol", insertion: { x: 20, y: 30 }, scale: { x: 2, y: 1 }, rotationRad: 0.25 },
  );
  return exportDxf(document).bytes;
}

function targetDocument(documentId: string) {
  const document = createEmptyDocument({ documentId, units: "mm" });
  document.entities.push({ kind: "line", handle: "OLD", layerId: "0", start: { x: 0, y: 0 }, end: { x: 1, y: 1 } });
  document.layouts.push({
    id: "paper",
    name: "Paper",
    kind: "paper",
    paper: structuredClone(DEFAULT_PAPER_DEFINITION),
    pageSetup: structuredClone(DEFAULT_PAGE_SETUP),
    viewports: [],
    entities: [],
  });
  return document;
}

describe("F-110 live DXFIN transaction", () => {
  it("commits one atomic import, supports Undo/Redo and recovers the append-only result", async () => {
    const database = new KDrawIndexedDb(new IDBFactory(), "f110-atomic");
    const live = new DocumentLiveOrchestrator(database, "f110-crashed-session");
    await live.open({ documentId: "drawing", fallbackDocument: targetDocument("drawing") });
    const result = await importDxfIntoLiveDocument(live, {
      documentId: "drawing",
      bytes: importSource(),
      operationId: "dxfin:1",
      fileName: "core.cm.dxf",
      now: "2026-08-31T21:00:00.000Z",
    });
    expect(result.readback).toMatchObject({
      revision: 1,
      sourceUnits: "cm",
      targetUnits: "mm",
      insertionScale: 10,
      entityCount: 3,
      blockCount: 1,
      importedHandles: ["C0", "10", "20", "30"],
      roundTripHandles: ["C0", "10", "20", "30"],
      operationId: "dxfin:1",
    });
    expect(result.readback.exportedSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(result.document.entities.find((entity) => entity.handle === "10")).toMatchObject({ kind: "line", end: { x: 1_000, y: 200 } });
    expect(result.document.layouts.map((layout) => layout.id)).toEqual(["model", "paper"]);
    expect((await database.operations("drawing")).map((item) => [item.operation.commandId, item.revision])).toEqual([["DXFIN", 1]]);

    expect(await live.undo("drawing", "2026-08-31T21:00:01.000Z")).toMatchObject({ revision: 2, entities: [{ handle: "OLD" }] });
    expect(await live.redo("drawing", "2026-08-31T21:00:02.000Z")).toMatchObject({ revision: 3, entities: [{ handle: "10" }, { handle: "20" }, { handle: "30" }] });
    expect((await database.operations("drawing")).map((item) => item.operation.commandId)).toEqual(["DXFIN", "UNDO", "DXFIN"]);

    const recovered = new DocumentLiveOrchestrator(database, "f110-recovery-session");
    const opened = await recovered.open({ documentId: "drawing" });
    expect(opened.recovery).toMatchObject({ source: "operation-log", recoveredRevision: 3, uncleanSessionIds: ["f110-crashed-session"] });
    expect(opened.document.entities.map((entity) => entity.handle)).toEqual(["10", "20", "30"]);
    expect(opened.document.blocks[0]?.entities.map((entity) => entity.handle)).toEqual(["C0"]);
    database.close();
  });

  it("refuses malformed or unsupported input before live state or storage changes", async () => {
    const database = new KDrawIndexedDb(new IDBFactory(), "f110-refusal");
    const live = new DocumentLiveOrchestrator(database, "f110-refusal-session");
    await live.open({ documentId: "safe", fallbackDocument: targetDocument("safe") });
    const malformed = Uint8Array.from([...importSource(), ...new TextEncoder().encode("BROKEN")]);
    await expect(importDxfIntoLiveDocument(live, { documentId: "safe", bytes: malformed, operationId: "bad:1", fileName: "bad.dxf" })).rejects.toThrow();
    expect(live.document("safe")).toMatchObject({ revision: 0, entities: [{ handle: "OLD" }] });
    expect(await database.operations("safe")).toEqual([]);
    database.close();
  });

  it("keeps a second open document isolated from DXFIN", async () => {
    const database = new KDrawIndexedDb(new IDBFactory(), "f110-isolation");
    const live = new DocumentLiveOrchestrator(database, "f110-isolation-session");
    await live.open({ documentId: "alpha", fallbackDocument: targetDocument("alpha") });
    await live.open({ documentId: "beta", fallbackDocument: targetDocument("beta") });
    await importDxfIntoLiveDocument(live, { documentId: "alpha", bytes: importSource(), operationId: "alpha:dxfin", fileName: "alpha.dxf" });
    expect(live.document("alpha")).toMatchObject({ revision: 1, entities: [{ handle: "10" }, { handle: "20" }, { handle: "30" }] });
    expect(live.document("beta")).toMatchObject({ revision: 0, entities: [{ handle: "OLD" }] });
    expect(await database.operations("beta")).toEqual([]);
    database.close();
  });
});
