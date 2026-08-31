import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import golden from "./document-layout-workspace.golden.json";
import {
  recoverDocumentLayoutWorkspaceHarness,
  seedDocumentLayoutWorkspaceHarness,
  verifyDocumentLayoutWorkspaceHarness,
} from "./document-layout-workspace-harness.js";

function state(readback: Awaited<ReturnType<typeof seedDocumentLayoutWorkspaceHarness>>["alphaBeforeCrash"]) {
  return {
    revision: readback.revision,
    activeLayoutId: readback.activeLayoutId,
    activeSpace: readback.activeSpace,
    tabOrder: readback.tabOrder,
    nextLayoutSequence: readback.nextLayoutSequence,
    nextViewportSequence: readback.nextViewportSequence,
    layoutNames: readback.layouts.map((layout) => layout.name),
  };
}

describe("F-096/F-097 browser reload wiring harness", () => {
  it("reads Model/Layout state back after crash and keeps Undo/Redo document-local", async () => {
    const factory = new IDBFactory();
    const databaseName = "document-layout-workspace-harness-unit";
    const seed = await seedDocumentLayoutWorkspaceHarness(factory, databaseName);
    expect(state(seed.alphaBeforeCrash)).toEqual(golden.alphaBeforeCrash);
    expect(seed.betaBeforeCrash).toMatchObject(golden.betaBeforeCrash);
    expect(seed.operationCounts).toEqual({ alpha: 9, beta: 1 });

    const recovered = await recoverDocumentLayoutWorkspaceHarness(factory, databaseName);
    expect(state(recovered.alphaAfterReload)).toEqual(golden.alphaBeforeCrash);
    expect(recovered.betaAfterReload).toMatchObject(golden.betaBeforeCrash);
    expect(recovered.afterUndo).toMatchObject(golden.afterUndo);
    expect(recovered.afterRedo).toMatchObject(golden.afterRedo);
    expect(recovered.alphaRecovery).toMatchObject({
      source: "operation-log",
      recoveredRevision: 9,
      uncleanSessionIds: ["layout-workspace-crashed"],
    });
    expect(recovered.betaRecovery).toMatchObject({
      source: "operation-log",
      recoveredRevision: 1,
      uncleanSessionIds: ["layout-workspace-crashed"],
    });
    expect(recovered.operationCounts).toEqual({ alpha: 11, beta: 1 });
    expect(recovered).toMatchObject({ migrationIdempotent: true, multiDocumentIsolated: true });

    const verified = await verifyDocumentLayoutWorkspaceHarness(factory, databaseName);
    expect(verified.alpha).toMatchObject(golden.afterRedo);
    expect(verified.beta).toMatchObject(golden.betaBeforeCrash);
    expect(verified.operationCounts).toEqual({ alpha: 11, beta: 1 });
    expect(verified.migrationIdempotent).toBe(true);
  });
});
