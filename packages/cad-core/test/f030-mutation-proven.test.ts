import { describe, expect, it } from "vitest";
import {
  CadSession,
  createEmptyDocument,
  executeMatchProperties,
  executeMatchPropertiesAcrossDocuments,
  executeMatchViewportProperties,
} from "../src/index.js";

describe("F-030 mutation-proven MATCHPROP candidate", () => {
  it("kills partial-property, geometry-copy, ByLayer-retention, source-mutation and split-transaction mutants", () => {
    const document = createEmptyDocument({ documentId: "F-030-mutation", now: "2026-08-30T14:35:00.000Z" });
    document.layers.push({ id: "source", name: "SOURCE", visible: true, frozen: false, locked: false, plottable: true });
    document.entities = [
      {
        kind: "line", handle: "10", layerId: "source", start: { x: 0, y: 0 }, end: { x: 100, y: 0 },
        appearance: { color: "#ff0000", colorMethod: "aci", aciIndex: 1, linetypeId: "hidden", linetypeScale: 2, lineweightMm: 0.5, transparency: 25, thickness: -3, plotStyleId: "Engineering", materialId: "Steel" },
        extensionData: { source: true },
      },
      {
        kind: "line", handle: "20", layerId: "0", start: { x: 10, y: 20 }, end: { x: 30, y: 20 },
        appearance: { color: "#00ff00", linetypeScale: 0.25 }, extensionData: { target: true },
      },
      {
        kind: "circle", handle: "30", layerId: "0", center: { x: 50, y: 50 }, radius: 10,
        appearance: { color: "#0000ff", linetypeScale: 0.5 },
      },
    ];
    const sourceBefore = structuredClone(document.entities[0]);
    const targetBefore = structuredClone(document.entities.slice(1));
    const result = executeMatchProperties(document, { sourceHandle: "10", targetHandles: ["20", "30"] });

    expect(result).toMatchObject({ sourceHandle: "10", targetHandles: ["20", "30"], matchedHandles: ["20", "30"], rejected: [] });
    expect(result.changes).toEqual([
      { type: "put", entity: { ...targetBefore[0], layerId: "source", appearance: document.entities[0]!.appearance } },
      { type: "put", entity: { ...targetBefore[1], layerId: "source", appearance: document.entities[0]!.appearance } },
    ]);
    expect(document.entities[0]).toEqual(sourceBefore);
    expect(document.entities.slice(1)).toEqual(targetBefore);

    const session = new CadSession(document);
    session.commit({
      opId: "F-030-mutation",
      baseRevision: 0,
      commandId: "MATCHPROP",
      args: { sourceHandle: "10", targetHandles: ["20", "30"] },
      targetHandles: ["20", "30"],
      resultHandles: result.matchedHandles,
    }, result.changes);
    expect(session.document.revision).toBe(1);
    expect(session.document.entities[1]).toMatchObject({ handle: "20", start: targetBefore[0]!.start, end: targetBefore[0]!.end, extensionData: targetBefore[0]!.extensionData });
    expect(session.undo()).not.toBeNull();
    expect(session.document.entities.slice(1)).toEqual(targetBefore);
    expect(session.redo()).not.toBeNull();
    expect(session.document.entities[1]).toEqual((result.changes[0] as { type: "put"; entity: unknown }).entity);
  });

  it("kills disabled-setting and ByLayer override-retention mutants", () => {
    const document = createEmptyDocument({ documentId: "F-030-settings" });
    document.entities = [
      { kind: "circle", handle: "10", layerId: "0", center: { x: 0, y: 0 }, radius: 5 },
      { kind: "circle", handle: "20", layerId: "0", center: { x: 10, y: 0 }, radius: 8, appearance: { color: "#00ff00", linetypeId: "hidden", linetypeScale: 4 } },
    ];
    const result = executeMatchProperties(document, {
      sourceHandle: "10",
      targetHandles: ["20"],
      settings: { layer: false, linetype: false, linetypeScale: false },
    });
    expect(result.changes).toEqual([{ type: "put", entity: { ...document.entities[1], appearance: { linetypeId: "hidden", linetypeScale: 4 } } }]);
  });

  it("kills viewport scale-copy and forbidden clip/layer-override mutants", () => {
    const document = createEmptyDocument({ documentId: "F-030-viewport" });
    document.layouts.push({
      id: "paper", name: "Layout 1", kind: "paper", viewports: [
        { id: "source", center: { x: 0, y: 0 }, width: 200, height: 100, viewCenter: { x: 1, y: 2 }, viewHeight: 5_000, twistAngleRad: 1, locked: true, on: false },
        { id: "target", center: { x: 50, y: 50 }, width: 80, height: 40, viewCenter: { x: 9, y: 8 }, viewHeight: 400, twistAngleRad: 0.25, locked: false, on: true, clipBoundary: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }], layerOverrides: { "0": { frozen: true } } },
      ],
    });
    const result = executeMatchViewportProperties(document, { layoutId: "paper", viewportId: "source" }, [{ layoutId: "paper", viewportId: "target" }]);
    const viewport = (result.changes[0] as { type: "set-layouts"; layouts: typeof document.layouts }).layouts[1]!.viewports[1]!;
    expect(viewport).toMatchObject({ id: "target", viewHeight: 2_000, locked: true, on: false, viewCenter: { x: 9, y: 8 }, twistAngleRad: 0.25, layerOverrides: { "0": { frozen: true } } });
    expect(viewport.clipBoundary).toEqual([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }]);
  });

  it("kills cross-drawing resource omission, collision overwrite and split-undo mutants", () => {
    const sourceDocument = createEmptyDocument({ documentId: "F-030-source" });
    sourceDocument.layers.push({ id: "A", name: "A", visible: true, frozen: false, locked: false, plottable: true, appearance: { linetypeId: "dash" } });
    sourceDocument.linetypes.push({ id: "dash", name: "DASH", pattern: [5, -2] });
    sourceDocument.entities.push({ kind: "line", handle: "10", layerId: "A", start: { x: 0, y: 0 }, end: { x: 1, y: 0 }, appearance: { linetypeId: "dash" } });
    const targetDocument = createEmptyDocument({ documentId: "F-030-target" });
    targetDocument.layers.push({ id: "A", name: "A", visible: true, frozen: false, locked: false, plottable: true });
    targetDocument.linetypes.push({ id: "dash", name: "DASH", pattern: [1, -1] });
    targetDocument.entities.push({ kind: "line", handle: "10", layerId: "0", start: { x: 5, y: 5 }, end: { x: 6, y: 5 } });
    const prepared = executeMatchPropertiesAcrossDocuments(sourceDocument, targetDocument, { sourceHandle: "10", targetHandles: ["10"] });
    expect(prepared.resourceImports).toEqual([
      expect.objectContaining({ kind: "linetype", targetId: "dash$matchprop1", action: "import" }),
      expect.objectContaining({ kind: "layer", targetId: "A$matchprop1", action: "import" }),
    ]);
    const session = new CadSession(targetDocument);
    session.commit({ opId: "cross", baseRevision: 0, commandId: "MATCHPROP", args: {}, targetHandles: ["10"], resultHandles: ["10"] }, prepared.changes);
    expect(session.document.entities[0]).toMatchObject({ handle: "10", layerId: "A$matchprop1", appearance: { linetypeId: "dash$matchprop1" } });
    expect(session.undo()).not.toBeNull();
    expect(session.document.entities).toEqual(targetDocument.entities);
    expect(session.document.layers).toEqual(targetDocument.layers);
    expect(session.document.linetypes).toEqual(targetDocument.linetypes);
  });
});
