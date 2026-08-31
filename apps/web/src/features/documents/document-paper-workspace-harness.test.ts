import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import golden from "./document-paper-workspace.golden.json";
import {
  recoverDocumentPaperWorkspaceHarness,
  seedDocumentPaperWorkspaceHarness,
  verifyDocumentPaperWorkspaceHarness,
} from "./document-paper-workspace-harness.js";

function state(readback: Awaited<ReturnType<typeof seedDocumentPaperWorkspaceHarness>>["alphaBeforeCrash"]) {
  return {
    revision: readback.revision,
    paperUnits: readback.paperUnits,
    activeLayoutId: readback.activeLayoutId,
    activeSpace: readback.activeSpace,
    papers: readback.papers,
  };
}

describe("F-098 browser reload wiring harness", () => {
  it("restores physical paper state and keeps Undo/Redo document-local", async () => {
    const factory = new IDBFactory();
    const databaseName = "document-paper-workspace-harness-unit";
    const seed = await seedDocumentPaperWorkspaceHarness(factory, databaseName);
    expect(state(seed.alphaBeforeCrash)).toEqual(golden.alphaBeforeCrash);
    expect(seed.betaBeforeCrash).toMatchObject(golden.betaBeforeCrash);
    expect(seed.operationCounts).toEqual({ alpha: 6, beta: 1 });

    const recovered = await recoverDocumentPaperWorkspaceHarness(factory, databaseName);
    expect(state(recovered.alphaAfterReload)).toEqual(golden.alphaBeforeCrash);
    expect(recovered.betaAfterReload).toMatchObject(golden.betaBeforeCrash);
    expect(recovered.afterUndo).toMatchObject(golden.afterUndo);
    expect(recovered.afterRedo).toMatchObject(golden.afterRedo);
    expect(recovered.alphaRecovery).toMatchObject({ recoveredRevision: 6, source: "operation-log", uncleanSessionIds: ["paper-workspace-crashed"] });
    expect(recovered.betaRecovery).toMatchObject({ recoveredRevision: 1, source: "operation-log", uncleanSessionIds: ["paper-workspace-crashed"] });
    expect(recovered.operationCounts).toEqual({ alpha: 8, beta: 1 });
    expect(recovered).toMatchObject({ migrationIdempotent: true, multiDocumentIsolated: true });

    const verified = await verifyDocumentPaperWorkspaceHarness(factory, databaseName);
    expect(verified.alpha).toMatchObject(golden.afterRedo);
    expect(verified.beta).toMatchObject(golden.betaBeforeCrash);
    expect(verified.operationCounts).toEqual({ alpha: 8, beta: 1 });
    expect(verified.migrationIdempotent).toBe(true);
  });
});
