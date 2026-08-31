import { createEmptyDocument } from "@kuubik/cad-core";
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { KDrawIndexedDb } from "../../indexed-db.js";
import { DocumentLiveOrchestrator } from "./document-live-orchestrator.js";
import { DocumentWorkspaceShell, PgpAliasMapping } from "./document-workspace-shell.js";

const COMMANDS = [
  { id: "LINE", aliases: ["L"] },
  { id: "CIRCLE", aliases: ["C"] },
  { id: "SCALE", aliases: ["SC"] },
  { id: "LAYOUT", aliases: ["LA"] },
  { id: "ZOOM", aliases: ["Z"] },
] as const;

function shell(factory = new IDBFactory(), sessionId = "workspace-session") {
  const database = new KDrawIndexedDb(factory);
  return { database, shell: new DocumentWorkspaceShell(new DocumentLiveOrchestrator(database, sessionId), new PgpAliasMapping(COMMANDS)) };
}

function fixture(documentId: string, handle: string) {
  const document = createEmptyDocument({ documentId });
  document.entities.push({ kind: "line" as const, handle, layerId: "0", start: { x: 0, y: 0 }, end: { x: 10, y: 0 } });
  return document;
}

describe("F-128/F-129/F-130 document workspace shell", () => {
  it("uses canonical > imported > built-in precedence and bit-exact PGP export/import", async () => {
    const aliases = new PgpAliasMapping(COMMANDS);
    const imported = await aliases.importPgp("; user aliases\nL, *LAYOUT\nZZ, *ZOOM\nZZ, *LINE ; last imported definition wins\n");
    expect(imported.conflicts).toEqual([
      { alias: "L", previousCommandId: "LINE", incomingCommandId: "LAYOUT", previousSource: "built-in", resolution: "incoming-wins", line: 2 },
      { alias: "ZZ", previousCommandId: "ZOOM", incomingCommandId: "LINE", previousSource: "imported", resolution: "incoming-wins", line: 4 },
    ]);
    expect(aliases.resolve("_.line")).toEqual({ requested: "LINE", commandId: "LINE", source: "canonical" });
    expect(aliases.resolve("l")).toEqual({ requested: "L", commandId: "LAYOUT", source: "imported" });
    expect(imported.canonicalText).toBe("L, *LAYOUT\r\nZZ, *LINE\r\n");

    const exported = aliases.exportPgp();
    const roundtrip = new PgpAliasMapping(COMMANDS);
    const reimported = await roundtrip.importPgp(exported);
    expect(roundtrip.exportPgp()).toEqual(exported);
    expect(reimported.sha256).toBe(imported.sha256);
    expect(reimported.byteLength).toBe(exported.byteLength);
  });

  it("keeps selection, viewport, command history and Undo/Redo isolated across document switches", async () => {
    const { database, shell: workspace } = shell();
    await workspace.open({ documentId: "alpha", fallbackDocument: fixture("alpha", "A0"), selectedHandles: ["A0"], viewport: { world: { minX: -10, minY: -10, maxX: 20, maxY: 20 }, widthPx: 800, heightPx: 600, devicePixelRatio: 1 } });
    await workspace.open({ documentId: "beta", fallbackDocument: fixture("beta", "B0"), selectedHandles: ["B0"], viewport: { world: { minX: 100, minY: 200, maxX: 500, maxY: 700 }, widthPx: 1200, heightPx: 900, devicePixelRatio: 2 } });

    await workspace.commit("alpha", 0, "L 0,0 10,0", [{ type: "put", entity: { kind: "line", handle: "A1", layerId: "0", start: { x: 0, y: 1 }, end: { x: 10, y: 1 } } }]);
    await workspace.markUndo("alpha", 1, "SC 1");
    await workspace.commit("beta", 0, "C 5,5 2", [{ type: "put", entity: { kind: "circle", handle: "B1", layerId: "0", center: { x: 5, y: 5 }, radius: 2 } }]);
    workspace.activate("alpha");

    const readback = workspace.readBack().live.sessions;
    expect(readback.activeDocumentId).toBe("alpha");
    expect(readback.documents[0]).toEqual(expect.objectContaining({
      documentId: "alpha", revision: 2, selectedHandles: ["A0"], commandHistory: ["L 0,0 10,0", "SC 1"], nextUndoCommandId: "SCALE",
      viewport: expect.objectContaining({ widthPx: 800, devicePixelRatio: 1 }),
    }));
    expect(readback.documents[1]).toEqual(expect.objectContaining({
      documentId: "beta", revision: 1, selectedHandles: ["B0"], commandHistory: ["C 5,5 2"], nextUndoCommandId: "CIRCLE",
      viewport: expect.objectContaining({ widthPx: 1200, devicePixelRatio: 2 }),
    }));

    await workspace.undo("alpha");
    expect(workspace.document("alpha").entities.map((entity) => entity.handle)).toEqual(["A0", "A1"]);
    expect(workspace.document("beta").entities.map((entity) => entity.handle)).toEqual(["B0", "B1"]);
    await workspace.undo("alpha");
    expect(workspace.document("alpha").entities.map((entity) => entity.handle)).toEqual(["A0"]);
    expect(workspace.document("beta")).toMatchObject({ revision: 1 });
    expect((await database.operations("alpha"))).toHaveLength(4);
    database.close();
  });

  it("restores each document's atomic history after a crash and rejects stale revisions", async () => {
    const factory = new IDBFactory();
    const crashed = shell(factory, "crashed");
    await crashed.shell.open({ documentId: "alpha", fallbackDocument: fixture("alpha", "A0") });
    await crashed.shell.open({ documentId: "beta", fallbackDocument: fixture("beta", "B0") });
    await crashed.shell.commit("alpha", 0, "L 0,0 10,0", [{ type: "put", entity: { kind: "line", handle: "A1", layerId: "0", start: { x: 0, y: 1 }, end: { x: 10, y: 1 } } }]);
    await crashed.shell.markUndo("alpha", 1, "SC 1");
    await crashed.shell.commit("beta", 0, "C 5,5 2", [{ type: "put", entity: { kind: "circle", handle: "B1", layerId: "0", center: { x: 5, y: 5 }, radius: 2 } }]);
    crashed.database.close();

    const reloaded = shell(factory, "reloaded");
    const alphaRecovery = await reloaded.shell.open({ documentId: "alpha" });
    const betaRecovery = await reloaded.shell.open({ documentId: "beta" });
    expect(alphaRecovery.recovery).toEqual(expect.objectContaining({ recoveredRevision: 2, uncleanSessionIds: ["crashed"], sessionHistory: expect.any(Object) }));
    expect(betaRecovery.recovery).toEqual(expect.objectContaining({ recoveredRevision: 1, uncleanSessionIds: ["crashed"], sessionHistory: expect.any(Object) }));
    expect(reloaded.shell.readBack().live.sessions.documents).toEqual([
      expect.objectContaining({ documentId: "alpha", canUndo: true, nextUndoCommandId: "SCALE" }),
      expect.objectContaining({ documentId: "beta", canUndo: true, nextUndoCommandId: "CIRCLE" }),
    ]);

    await reloaded.shell.undo("alpha");
    expect(reloaded.shell.document("alpha").entities.map((entity) => entity.handle)).toEqual(["A0", "A1"]);
    await reloaded.shell.undo("alpha");
    expect(reloaded.shell.document("alpha").entities.map((entity) => entity.handle)).toEqual(["A0"]);
    await reloaded.shell.redo("alpha");
    expect(reloaded.shell.document("alpha").entities.map((entity) => entity.handle)).toEqual(["A0", "A1"]);
    expect(reloaded.shell.document("beta")).toMatchObject({ revision: 1 });

    const before = reloaded.shell.document("alpha");
    await expect(reloaded.shell.commit("alpha", 0, "L 1,1 2,2", [{ type: "put", entity: { kind: "line", handle: "STALE", layerId: "0", start: { x: 1, y: 1 }, end: { x: 2, y: 2 } } }])).rejects.toThrow(/Revision conflict/u);
    expect(reloaded.shell.document("alpha")).toEqual(before);
    expect(reloaded.shell.document("beta")).toMatchObject({ revision: 1 });
    reloaded.database.close();
  });

  it("isolates a property matrix of six document contexts", async () => {
    const { database, shell: workspace } = shell();
    for (let index = 0; index < 6; index += 1) {
      const id = `property-${index}`;
      const handle = `P${index}`;
      await workspace.open({ documentId: id, fallbackDocument: fixture(id, handle), selectedHandles: [handle], viewport: { world: { minX: index, minY: index * 2, maxX: index + 10, maxY: index * 2 + 20 }, widthPx: 640 + index, heightPx: 480 + index, devicePixelRatio: 1 } });
      workspace.recordCommand(id, index % 2 === 0 ? "L" : "C");
    }
    const documents = workspace.readBack().live.sessions.documents;
    expect(documents).toHaveLength(6);
    documents.forEach((document, index) => {
      expect(document).toEqual(expect.objectContaining({ documentId: `property-${index}`, selectedHandles: [`P${index}`], commandHistory: [index % 2 === 0 ? "L" : "C"] }));
      expect(document.viewport.widthPx).toBe(640 + index);
    });
    database.close();
  });
});
