import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { runDocumentWorkspaceHarness } from "./document-workspace-harness.js";

describe("F-128/F-129/F-130 browser-ready workspace read-back", () => {
  it("roundtrips aliases and restores isolated atomic history after a simulated crash", async () => {
    const result = await runDocumentWorkspaceHarness(new IDBFactory(), { databaseName: "workspace-harness-unit" });
    expect(result).toEqual(expect.objectContaining({
      ok: true,
      aliases: expect.objectContaining({
        canonicalText: "L, *LAYOUT\r\nZZ, *LINE\r\n",
        byteLength: 23,
        sha256: "631baca2b9608a6d029ab6ecd022720a01634fb112bdef1a4218f4c81f3b7f8a",
        bitExactRoundtrip: true,
      }),
      recovery: {
        alphaRevision: 2,
        betaRevision: 1,
        alphaNextUndo: "SCALE",
        betaNextUndo: "CIRCLE",
        uncleanSessionIds: ["workspace-crashed"],
      },
      undoRedo: {
        markerUndoRevision: 3,
        markerUndoHandles: ["A0", "A1"],
        commandUndoRevision: 4,
        commandUndoHandles: ["A0"],
        redoRevision: 5,
        redoHandles: ["A0", "A1"],
      },
      staleRevisionRejected: true,
    }));
    expect(result.aliases.sha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(result.beforeCrash.sessions.documents).toEqual([
      expect.objectContaining({ documentId: "alpha", selectedHandles: ["A0"], commandHistory: ["ZZ 0,0 10,0", "SC 1"], nextUndoCommandId: "SCALE" }),
      expect.objectContaining({ documentId: "beta", selectedHandles: ["B0"], commandHistory: ["C 5,5 2"], nextUndoCommandId: "CIRCLE" }),
    ]);
    expect(result.afterReload.sessions.documents).toEqual([
      expect.objectContaining({ documentId: "alpha", revision: 2, canUndo: true, nextUndoCommandId: "SCALE", commandHistory: [] }),
      expect.objectContaining({ documentId: "beta", revision: 1, canUndo: true, nextUndoCommandId: "CIRCLE", commandHistory: [] }),
    ]);
    expect(result.finalReadback.sessions.documents.find((entry) => entry.documentId === "beta")).toEqual(expect.objectContaining({ revision: 1 }));
  });
});
