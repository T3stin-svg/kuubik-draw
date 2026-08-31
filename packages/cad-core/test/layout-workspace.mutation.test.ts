import { describe, expect, it } from "vitest";
import { applyAtomicOperation, createEmptyDocument, migrateLayoutWorkspace, readLayoutWorkspace } from "../src/index.js";

describe("F-096/F-097 workspace mutation ratchet", () => {
  it.each([
    ["active", (state: any) => { state.activeLayoutId = "deleted"; }],
    ["space", (state: any) => { state.activeSpace = "paper"; }],
    ["tab order", (state: any) => { state.tabOrder = ["model", "model"]; }],
    ["permuted tab order", (state: any) => { state.tabOrder = ["layout-1", "model"]; }],
    ["sequence", (state: any) => { state.nextLayoutSequence = 1; }],
  ])("fails strict read and repairs a %s-only mutation", (_name, mutate) => {
    const legacy = createEmptyDocument({ documentId: `mutation-${_name}` });
    const migration = migrateLayoutWorkspace(legacy);
    const document = applyAtomicOperation(legacy, {
      opId: "migration",
      baseRevision: 0,
      commandId: "LAYOUT_WORKSPACE_MIGRATE",
      args: {},
      targetHandles: [],
      resultHandles: [],
    }, migration.changes).document;
    mutate(document.metadata.extensions!["kuubik.layoutWorkspace.v1"]);
    expect(() => readLayoutWorkspace(document)).toThrow(/workspace|active/u);
    const repaired = migrateLayoutWorkspace(document);
    expect(repaired.migrated).toBe(true);
    expect(repaired.workspace).toMatchObject({
      activeLayoutId: "model",
      activeSpace: "model",
      tabOrder: ["model", "layout-1"],
      nextLayoutSequence: 2,
      nextViewportSequence: 2,
    });
  });
});
