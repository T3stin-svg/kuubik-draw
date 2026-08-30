import { describe, expect, it } from "vitest";
import type { CadEntity, KDrawDocumentV1 } from "@kuubik/cad-schema";
import { resolveCadCommand } from "../src/commands.js";
import {
  DEFAULT_MATCH_PROPERTIES_SETTINGS,
  executeMatchProperties,
  executeMatchPropertiesAcrossDocuments,
  executeMatchViewportProperties,
  matchCadEntityProperties,
  matchCadViewportProperties,
  resolveMatchPropertiesSettings,
} from "../src/match-properties.js";
import { applyAtomicOperation } from "../src/transaction.js";

function documentWith(...entities: CadEntity[]): KDrawDocumentV1 {
  return {
    schemaVersion: 1,
    documentId: "f030",
    revision: 0,
    units: { linear: "mm", displayPrecision: 2, angularPrecision: 2 },
    currentLayerId: "source",
    entities,
    layers: [
      { id: "source", name: "Source", visible: true, frozen: false, locked: false, plottable: true },
      { id: "target", name: "Target", visible: true, frozen: false, locked: false, plottable: true },
      { id: "locked", name: "Locked", visible: true, frozen: false, locked: true, plottable: true },
    ],
    linetypes: [{ id: "hidden", name: "HIDDEN", pattern: [5, -2] }],
    textStyles: [{ id: "source-text", name: "Source", fontFamily: "Arial", widthFactor: 1, obliqueAngleRad: 0 }],
    dimensionStyles: [{ id: "source-dim", name: "Source", textHeight: 2.5, arrowSize: 2.5, extensionOffset: 0.625, scale: 1 }],
    blocks: [], layouts: [], attachments: [], metadata: { name: "F-030" },
  };
}

const source: CadEntity = {
  kind: "line", handle: "10", layerId: "source", start: { x: 0, y: 0 }, end: { x: 100, y: 0 },
  appearance: { color: "#ff0000", colorMethod: "aci", aciIndex: 1, linetypeId: "hidden", linetypeScale: 2, lineweightMm: 0.5, transparency: 40, thickness: -3, plotStyleId: "Engineering", materialId: "Steel" },
};

describe("F-030 MATCHPROP core", () => {
  it("wires MA and MATCHPROP through the canonical command registry", () => {
    expect(resolveCadCommand("ma")?.id).toBe("MATCHPROP");
    expect(resolveCadCommand(" MATCHPROP ")?.id).toBe("MATCHPROP");
  });

  it("copies all AutoCAD basic properties while preserving identity, geometry and extension data", () => {
    const target: CadEntity = { kind: "line", handle: "20", layerId: "target", start: { x: 5, y: 5 }, end: { x: 25, y: 5 }, appearance: { color: "#00ff00", linetypeScale: 0.5 }, extensionData: { keep: true } };
    const result = executeMatchProperties(documentWith(source, target), { sourceHandle: "10", targetHandles: ["20"] });
    expect(result.matchedHandles).toEqual(["20"]);
    expect(result.changes).toEqual([{ type: "put", entity: { ...target, layerId: "source", appearance: source.appearance } }]);
  });

  it("uses persistent-style settings to copy only selected properties and resolves ByLayer by deleting target overrides", () => {
    const byLayerSource: CadEntity = { kind: "circle", handle: "10", layerId: "source", center: { x: 0, y: 0 }, radius: 5 };
    const target: CadEntity = { kind: "circle", handle: "20", layerId: "target", center: { x: 10, y: 0 }, radius: 8, appearance: { color: "#00ff00", linetypeId: "hidden", lineweightMm: 0.7 } };
    const settings = resolveMatchPropertiesSettings({ layer: false, linetype: false, linetypeScale: false, lineweight: false, transparency: false, thickness: false, plotStyle: false, material: false, dimension: false, polyline: false, text: false, viewport: false, multileader: false, hatch: false, table: false, centerObject: false });
    const matched = matchCadEntityProperties(byLayerSource, target, settings);
    expect(matched).toEqual({ ...target, appearance: { linetypeId: "hidden", lineweightMm: 0.7 } });
    expect(DEFAULT_MATCH_PROPERTIES_SETTINGS.color).toBe(true);
  });

  it("does not apply unavailable linetype or thickness properties to MTEXT and HATCH", () => {
    const mtext: CadEntity = { kind: "mtext", handle: "20", layerId: "target", position: { x: 0, y: 0 }, text: "Target", height: 2.5, rotationRad: 0, appearance: { linetypeId: "hidden", linetypeScale: 0.25, thickness: 7 } };
    const hatch: CadEntity = { kind: "hatch", handle: "30", layerId: "target", pattern: "ANSI31", associative: false, loops: [], appearance: { linetypeId: "hidden", linetypeScale: 0.25 } };
    expect(matchCadEntityProperties(source, mtext, { ...DEFAULT_MATCH_PROPERTIES_SETTINGS })).toMatchObject({ appearance: { linetypeId: "hidden", linetypeScale: 0.25, thickness: 7 } });
    expect(matchCadEntityProperties(source, hatch, { ...DEFAULT_MATCH_PROPERTIES_SETTINGS })).toMatchObject({ appearance: { linetypeId: "hidden", linetypeScale: 0.25 } });
  });

  it("copies only uniform polyline width and leaves variable-width sources non-destructive", () => {
    const uniform: CadEntity = { kind: "polyline", handle: "10", layerId: "source", closed: false, vertices: [{ x: 0, y: 0, startWidth: 3, endWidth: 3 }, { x: 10, y: 0, startWidth: 3, endWidth: 3 }] };
    const variable: CadEntity = { ...uniform, vertices: [{ x: 0, y: 0, startWidth: 2, endWidth: 4 }, { x: 10, y: 0, startWidth: 4, endWidth: 2 }] };
    const target: CadEntity = { kind: "polyline", handle: "20", layerId: "target", closed: true, vertices: [{ x: 20, y: 0, bulge: 0.5 }, { x: 30, y: 0 }] };
    const settings = { ...DEFAULT_MATCH_PROPERTIES_SETTINGS, layer: false };
    expect(matchCadEntityProperties(uniform, target, settings)).toMatchObject({ vertices: [{ x: 20, y: 0, bulge: 0.5, startWidth: 3, endWidth: 3 }, { x: 30, y: 0, startWidth: 3, endWidth: 3 }] });
    expect(matchCadEntityProperties(variable, target, settings)).toEqual(target);
  });

  it("copies represented text, dimension and hatch special properties without copying content or geometry", () => {
    const settings = { ...DEFAULT_MATCH_PROPERTIES_SETTINGS, layer: false };
    const sourceText: CadEntity = { kind: "mtext", handle: "10", layerId: "source", position: { x: 0, y: 0 }, text: "Source", height: 5, rotationRad: 1, styleId: "source-text" };
    const targetText: CadEntity = { kind: "text", handle: "20", layerId: "target", position: { x: 10, y: 10 }, text: "Keep", height: 2, rotationRad: 0 };
    expect(matchCadEntityProperties(sourceText, targetText, settings)).toMatchObject({ position: { x: 10, y: 10 }, text: "Keep", height: 5, rotationRad: 1, styleId: "source-text" });
    const sourceDimension: CadEntity = { kind: "dimension", handle: "30", layerId: "source", dimensionKind: "linear", definitionPoints: [{ x: 0, y: 0 }], styleId: "source-dim", overrideText: "SOURCE" };
    const targetDimension: CadEntity = { kind: "dimension", handle: "40", layerId: "target", dimensionKind: "aligned", definitionPoints: [{ x: 1, y: 2 }], styleId: "other", overrideText: "KEEP" };
    expect(matchCadEntityProperties(sourceDimension, targetDimension, settings)).toMatchObject({ definitionPoints: [{ x: 1, y: 2 }], styleId: "source-dim", overrideText: "KEEP" });
    const sourceHatch: CadEntity = { kind: "hatch", handle: "50", layerId: "source", pattern: "SOLID", associative: true, loops: [] };
    const targetHatch: CadEntity = { kind: "hatch", handle: "60", layerId: "target", pattern: "ANSI31", associative: false, loops: [{ vertices: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }], isHole: false }] };
    expect(matchCadEntityProperties(sourceHatch, targetHatch, settings)).toMatchObject({ pattern: "SOLID", associative: false, loops: targetHatch.loops });
  });

  it("rejects missing, locked, source-as-target and no-change destinations without partial mutations", () => {
    const locked: CadEntity = { kind: "line", handle: "20", layerId: "locked", start: { x: 0, y: 1 }, end: { x: 100, y: 1 } };
    const same: CadEntity = { ...source, handle: "30" };
    const result = executeMatchProperties(documentWith(source, locked, same), { sourceHandle: "10", targetHandles: ["missing", "10", "20", "30"] });
    expect(result.changes).toEqual([]);
    expect(result.rejected).toEqual([
      { handle: "missing", reason: "missing" },
      { handle: "10", reason: "source-target" },
      { handle: "20", reason: "locked-layer" },
      { handle: "30", reason: "no-compatible-change" },
    ]);
  });

  it("treats property-order-only differences as a semantic no-op", () => {
    const orderedSource: CadEntity = {
      kind: "line", handle: "10", layerId: "source", start: { x: 0, y: 0 }, end: { x: 10, y: 0 },
      appearance: { color: "#ff0000", linetypeId: "hidden", linetypeScale: 2 },
    };
    const reorderedTarget: CadEntity = {
      kind: "line", handle: "20", layerId: "source", start: { x: 0, y: 0 }, end: { x: 10, y: 0 },
      appearance: { linetypeScale: 2, linetypeId: "hidden", color: "#ff0000" },
    };
    expect(executeMatchProperties(documentWith(orderedSource, reorderedTarget), { sourceHandle: "10", targetHandles: ["20"] })).toMatchObject({
      changes: [], matchedHandles: [], rejected: [{ handle: "20", reason: "no-compatible-change" }],
    });
  });

  it("fails closed on unknown or non-boolean settings", () => {
    expect(() => resolveMatchPropertiesSettings({ unknown: true } as never)).toThrow(/Unknown MATCHPROP setting/u);
    expect(() => resolveMatchPropertiesSettings({ color: "yes" } as never)).toThrow(/must be boolean/u);
  });

  it("copies the represented viewport-special set while preserving target paper geometry, view and exclusions", () => {
    const sourceViewport = {
      id: "source-vp", center: { x: 10, y: 10 }, width: 200, height: 100,
      viewCenter: { x: 1_000, y: 2_000 }, viewHeight: 5_000, twistAngleRad: 0.5, locked: true,
      on: false, shadePlot: "wireframe" as const, snapEnabled: true, gridEnabled: true,
      ucsIconVisible: false, ucsIconAtOrigin: false,
      clipBoundary: [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 100, y: 100 }],
      layerOverrides: { source: { frozen: true, color: "#ff0000" } },
    };
    const targetViewport = {
      id: "target-vp", center: { x: 300, y: 200 }, width: 80, height: 40,
      viewCenter: { x: -500, y: 700 }, viewHeight: 400, twistAngleRad: -0.25, locked: false,
      on: true, shadePlot: "hidden" as const, snapEnabled: false, gridEnabled: false,
      ucsIconVisible: true, ucsIconAtOrigin: true,
      clipBoundary: [{ x: 260, y: 180 }, { x: 340, y: 180 }, { x: 340, y: 220 }, { x: 260, y: 220 }],
      layerOverrides: { target: { frozen: false, color: "#00ff00" } },
    };
    expect(matchCadViewportProperties(sourceViewport, targetViewport)).toEqual({
      ...targetViewport,
      viewHeight: 2_000,
      locked: true,
      on: false,
      shadePlot: "wireframe",
      snapEnabled: true,
      gridEnabled: true,
      ucsIconVisible: false,
      ucsIconAtOrigin: false,
    });

    const document = documentWith(source);
    document.layouts = [{ id: "model", name: "Model", kind: "model", viewports: [] }, {
      id: "paper", name: "Layout 1", kind: "paper", viewports: [sourceViewport, targetViewport],
    }];
    const result = executeMatchViewportProperties(document, { layoutId: "paper", viewportId: "source-vp" }, [
      { layoutId: "paper", viewportId: "source-vp" },
      { layoutId: "missing", viewportId: "none" },
      { layoutId: "paper", viewportId: "target-vp" },
    ]);
    expect(result.matched).toEqual([{ layoutId: "paper", viewportId: "target-vp" }]);
    expect(result.rejected).toEqual([
      { target: { layoutId: "paper", viewportId: "source-vp" }, reason: "source-target" },
      { target: { layoutId: "missing", viewportId: "none" }, reason: "missing" },
    ]);
    expect(result.changes).toHaveLength(1);
  });

  it("imports cross-drawing layer, linetype, text style and dimension style in the same atomic operation", () => {
    const sourceDocument = documentWith({
      kind: "dimension", handle: "10", layerId: "source", dimensionKind: "linear",
      definitionPoints: [{ x: 0, y: 0 }, { x: 100, y: 0 }], styleId: "source-dim",
      appearance: { linetypeId: "hidden", color: "#ff0000" },
    });
    sourceDocument.layouts = [{ id: "model", name: "Model", kind: "model", viewports: [] }];
    sourceDocument.layers[0] = { ...sourceDocument.layers[0]!, appearance: { linetypeId: "hidden", color: "#ff0000" } };
    sourceDocument.dimensionStyles[0] = { ...sourceDocument.dimensionStyles[0]!, textStyleId: "source-text" };

    const targetDocument = documentWith({
      kind: "dimension", handle: "10", layerId: "target", dimensionKind: "aligned",
      definitionPoints: [{ x: 10, y: 10 }, { x: 20, y: 20 }], styleId: "target-dim",
      appearance: { color: "#00ff00" },
    });
    targetDocument.documentId = "f030-target";
    targetDocument.layouts = [{ id: "model", name: "Model", kind: "model", viewports: [] }];
    targetDocument.linetypes = [{ id: "hidden", name: "HIDDEN", pattern: [1, -1] }];
    targetDocument.textStyles = [
      { id: "source-text", name: "Source", fontFamily: "Courier New", widthFactor: 0.8, obliqueAngleRad: 0 },
      { id: "target-text", name: "Target", fontFamily: "Arial", widthFactor: 1, obliqueAngleRad: 0 },
    ];
    targetDocument.dimensionStyles = [
      { id: "source-dim", name: "Source", textStyleId: "target-text", textHeight: 1, arrowSize: 1, extensionOffset: 0, scale: 1 },
      { id: "target-dim", name: "Target", textStyleId: "target-text", textHeight: 1, arrowSize: 1, extensionOffset: 0, scale: 1 },
    ];
    targetDocument.layers[0] = { ...targetDocument.layers[0]!, appearance: { color: "#0000ff" } };

    const prepared = executeMatchPropertiesAcrossDocuments(sourceDocument, targetDocument, {
      sourceHandle: "10",
      targetHandles: ["10"],
    });
    expect(prepared.rejected).toEqual([]);
    expect(prepared.matchedHandles).toEqual(["10"]);
    expect(prepared.resourceImports).toEqual([
      expect.objectContaining({ kind: "linetype", sourceId: "hidden", targetId: "hidden$matchprop1", action: "import" }),
      expect.objectContaining({ kind: "text-style", sourceId: "source-text", targetId: "source-text$matchprop1", action: "import" }),
      expect.objectContaining({ kind: "dimension-style", sourceId: "source-dim", targetId: "source-dim$matchprop1", action: "import" }),
      expect.objectContaining({ kind: "layer", sourceId: "source", targetId: "source$matchprop1", action: "import" }),
    ]);

    const committed = applyAtomicOperation(targetDocument, {
      opId: "f030-cross", baseRevision: 0, commandId: "MATCHPROP",
      args: { sourceDocumentId: sourceDocument.documentId }, targetHandles: ["10"], resultHandles: ["10"],
    }, prepared.changes, "2026-08-30T12:00:00.000Z");
    expect(committed.document.entities[0]).toMatchObject({
      handle: "10", layerId: "source$matchprop1", styleId: "source-dim$matchprop1",
      appearance: { linetypeId: "hidden$matchprop1", color: "#ff0000" },
    });
    expect(committed.document.dimensionStyles.find((style) => style.id === "source-dim$matchprop1")).toMatchObject({
      textStyleId: "source-text$matchprop1",
    });
    expect(committed.document.layers.find((layer) => layer.id === "source$matchprop1")).toMatchObject({
      appearance: { linetypeId: "hidden$matchprop1", color: "#ff0000" },
    });

    const undone = applyAtomicOperation(committed.document, {
      opId: "f030-cross-undo", baseRevision: 1, commandId: "UNDO",
      args: {}, targetHandles: ["10"], resultHandles: ["10"],
    }, committed.committed.inverseChanges, "2026-08-30T12:01:00.000Z").document;
    expect(undone.entities).toEqual(targetDocument.entities);
    expect(undone.layers).toEqual(targetDocument.layers);
    expect(undone.linetypes).toEqual(targetDocument.linetypes);
    expect(undone.textStyles).toEqual(targetDocument.textStyles);
    expect(undone.dimensionStyles).toEqual(targetDocument.dimensionStyles);
  });
});
