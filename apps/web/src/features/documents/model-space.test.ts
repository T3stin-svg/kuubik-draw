import { createEmptyDocument } from "@kuubik/cad-core";
import { exportDxf } from "@kuubik/cad-dxf";
import { describe, expect, it } from "vitest";
import { createNewModelSpaceDocument, openDxfInModelSpace, readBackModelSpaceDocument } from "./model-space.js";

describe("F-096 Model-space document workflow", () => {
  it("creates a named drafting document with Model active", () => {
    const state = createNewModelSpaceDocument({
      documentId: "drawing-1",
      title: "Detail A",
      units: "mm",
      now: "2026-08-31T00:00:00Z",
    });
    expect(state.activeLayoutId).toBe("model");
    expect(state.readback).toEqual({
      documentId: "drawing-1",
      title: "Detail A",
      revision: 0,
      units: "mm",
      modelLayoutId: "model",
      entityCount: 0,
      layerCount: 1,
    });
  });

  it("opens a DXF directly into the same Model-space contract", () => {
    const source = createEmptyDocument({ documentId: "source" });
    source.entities = [{ kind: "line", handle: "10", layerId: "0", start: { x: 0, y: 0 }, end: { x: 20, y: 10 } }];
    const state = openDxfInModelSpace(exportDxf(source).bytes, {
      documentId: "opened",
      fileName: "detail.dxf",
      now: "2026-08-31T00:00:00Z",
    });
    expect(state.activeLayoutId).toBe("model");
    expect(state.readback.entityCount).toBe(1);
    expect(state.dxfReadback.importedHandles).toEqual(["10"]);
  });

  it("rejects an ambiguous document without exactly one Model layout", () => {
    const document = createEmptyDocument({ documentId: "ambiguous" });
    document.layouts.push({ id: "model-2", name: "Model 2", kind: "model", viewports: [], entities: [] });
    expect(() => readBackModelSpaceDocument(document)).toThrow(/exactly one model layout/iu);
  });
});
