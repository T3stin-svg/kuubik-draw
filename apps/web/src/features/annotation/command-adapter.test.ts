import { CadSession, createAlignedDimension, createEmptyDocument, createHatch, hatchBoundaryPolyline } from "@kuubik/cad-core";
import type { KDrawDocumentV1 } from "@kuubik/cad-schema";
import { describe, expect, it } from "vitest";
import { createAssociativeEntityWorkflow } from "./association-workflow.js";
import { createAnnotationCommandWorkflow, prepareAnnotationCommand, type AnnotationCommandInput } from "./command-adapter.js";
import { ANNOTATION_TOOLS, annotationPromptPlan } from "./model.js";

function fixture(): KDrawDocumentV1 {
  const document = createEmptyDocument({ documentId: "annotation-adapter", now: "2026-08-31T12:00:00.000Z" });
  document.textStyles.push({ id: "TXT", name: "TXT", fontFamily: "Arial", widthFactor: 1, obliqueAngleRad: 0 });
  document.dimensionStyles.push({ id: "DIM", name: "DIM", textStyleId: "TXT", textHeight: 2.5, arrowSize: 2.5, extensionOffset: 0.5, scale: 1 });
  document.entities.push(
    { kind: "line", handle: "10", layerId: "0", start: { x: 0, y: 0 }, end: { x: 100, y: 20 } },
    hatchBoundaryPolyline("20", "0", [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]),
  );
  return document;
}

describe("F-057..F-068 typed annotation command adapter", () => {
  it("declares a concrete prompt/options plan for every panel intent", () => {
    expect(ANNOTATION_TOOLS.every((tool) => annotationPromptPlan(tool.id).fields.length > 0)).toBe(true);
    expect(annotationPromptPlan("DIMLINEAR").fields.find((field) => field.id === "axis")?.choices).toEqual(["horizontal", "vertical"]);
    expect(annotationPromptPlan("HATCH").fields.map((field) => field.id)).toContain("associative");
  });

  it.each<AnnotationCommandInput>([
    { commandId: "DIMLINEAR", args: { handle: "D1", layerId: "0", styleId: "DIM", first: { x: 0, y: 0 }, second: { x: 100, y: 20 }, dimensionLinePoint: { x: 0, y: 40 }, axis: "horizontal" }, targetHandles: ["10"] },
    { commandId: "DIMALIGNED", args: { handle: "D2", layerId: "0", styleId: "DIM", first: { x: 0, y: 0 }, second: { x: 100, y: 20 }, dimensionLinePoint: { x: 0, y: 40 } }, targetHandles: ["10"] },
    { commandId: "DIMANGULAR", args: { handle: "D3", layerId: "0", styleId: "DIM", vertex: { x: 0, y: 0 }, firstRayPoint: { x: 10, y: 0 }, secondRayPoint: { x: 0, y: 10 }, arcPoint: { x: 5, y: 5 } } },
    { commandId: "DIMRADIUS", args: { handle: "D4", layerId: "0", styleId: "DIM", center: { x: 0, y: 0 }, circumferencePoint: { x: 10, y: 0 }, textPoint: { x: 15, y: 0 } } },
    { commandId: "DIMDIAMETER", args: { handle: "D5", layerId: "0", styleId: "DIM", center: { x: 0, y: 0 }, circumferencePoint: { x: 10, y: 0 }, textPoint: { x: 15, y: 0 } } },
    { commandId: "DIMCONTINUE", args: { handles: ["D6", "D7"], layerId: "0", styleId: "DIM", points: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }], dimensionLinePoint: { x: 0, y: 20 }, axis: "horizontal", chainId: "C1" } },
    { commandId: "DIMBASELINE", args: { handles: ["D8", "D9"], layerId: "0", styleId: "DIM", points: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }], dimensionLinePoints: [{ x: 0, y: 20 }, { x: 0, y: 30 }], axis: "horizontal", chainId: "B1" } },
    { commandId: "DIMSTYLE", mode: "create", style: { id: "DIM2", name: "DIM2", textStyleId: "TXT", textHeight: 3, arrowSize: 3, extensionOffset: 0.75, scale: 10 } },
    { commandId: "TEXT", args: { handle: "T0", layerId: "0", position: { x: 0, y: 0 }, text: "Üks rida", height: 2.5, styleId: "TXT" } },
    { commandId: "MTEXT", args: { handle: "T1", layerId: "0", position: { x: 0, y: 0 }, text: "Kaks\nrida", height: 2.5, width: 60, styleId: "TXT" } },
    { commandId: "STYLE", mode: "create", style: { id: "TXT2", name: "TXT2", fontFamily: "Arial", widthFactor: 0.9, obliqueAngleRad: 0 } },
    { commandId: "LEADER", args: { handle: "L1", layerId: "0", vertices: [{ x: 0, y: 0 }, { x: 10, y: 10 }], text: "L" } },
    { commandId: "MLEADER", args: { handle: "ML1", layerId: "0", vertices: [{ x: 0, y: 0 }, { x: 10, y: 10 }], text: "ML", textPosition: { x: 12, y: 10 }, styleId: "MLS", textStyleId: "TXT", textHeight: 2.5 } },
    { commandId: "HATCH", args: { handle: "H1", layerId: "0", boundaryHandles: ["20"], pattern: "ANSI31", angleRad: Math.PI / 4, scale: 2, associative: true } },
  ])("prepares $commandId through the typed matrix", (input) => {
    const prepared = prepareAnnotationCommand(fixture(), input);
    expect(prepared.commandId).toBe(input.commandId);
    expect(prepared.changes.length).toBeGreaterThan(0);
  });

  it("commits continued dimensions as one atomic Undo/Redo step", () => {
    const session = new CadSession(fixture());
    const workflow = createAnnotationCommandWorkflow(session);
    const input: AnnotationCommandInput = { commandId: "DIMCONTINUE", args: { handles: ["D6", "D7"], layerId: "0", styleId: "DIM", points: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }], dimensionLinePoint: { x: 0, y: 20 }, axis: "horizontal", chainId: "C1" } };
    expect(workflow.preview(input).changes).toHaveLength(2);
    workflow.commit(input, "dimcontinue:1");
    expect(session.document.revision).toBe(1);
    expect(session.document.entities.filter((entity) => entity.kind === "dimension")).toHaveLength(2);
    workflow.undo();
    expect(session.document.entities.filter((entity) => entity.kind === "dimension")).toHaveLength(0);
    workflow.redo();
    expect(session.document.entities.filter((entity) => entity.kind === "dimension")).toHaveLength(2);
  });
});

describe("F-065/F-068 associative geometry integration", () => {
  it("updates dimension and hatch with the same handles in the geometry command's one commit", () => {
    const document = fixture();
    document.entities.push(createAlignedDimension(document, { handle: "D1", layerId: "0", styleId: "DIM", first: { x: 0, y: 0 }, second: { x: 100, y: 20 }, dimensionLinePoint: { x: 0, y: 40 }, anchors: [
      { handle: "10", feature: "start", fallback: { x: 0, y: 0 } },
      { handle: "10", feature: "end", fallback: { x: 100, y: 20 } },
    ] }));
    document.entities.push(createHatch(document, { handle: "H1", layerId: "0", boundaryHandles: ["20"], pattern: "SOLID", associative: true }));
    const session = new CadSession(document);
    const workflow = createAssociativeEntityWorkflow(session);
    const movedLine = { kind: "line" as const, handle: "10", layerId: "0", start: { x: 5, y: 5 }, end: { x: 125, y: 25 } };
    const movedBoundary = hatchBoundaryPolyline("20", "0", [{ x: 0, y: 0 }, { x: 120, y: 0 }, { x: 120, y: 100 }, { x: 0, y: 100 }]);
    const preview = workflow.preview({ commandId: "MOVE", entityChanges: [{ type: "put", entity: movedLine }, { type: "put", entity: movedBoundary }], changedHandles: ["10", "20"] });
    expect(preview.resultHandles).toEqual(["10", "20", "D1", "H1"]);
    workflow.commit({ commandId: "MOVE", entityChanges: [{ type: "put", entity: movedLine }, { type: "put", entity: movedBoundary }], changedHandles: ["10", "20"] }, "move:assoc:1");
    expect(session.document.revision).toBe(1);
    expect(session.document.entities.find((entity) => entity.handle === "D1")).toMatchObject({ handle: "D1", definitionPoints: [{ x: 5, y: 5 }, { x: 125, y: 25 }, { x: 0, y: 40 }, { x: 0, y: 40 }] });
    expect(session.document.entities.find((entity) => entity.handle === "H1")).toMatchObject({ handle: "H1", loops: [{ vertices: [{ x: 0, y: 0 }, { x: 120, y: 0 }, { x: 120, y: 100 }, { x: 0, y: 100 }] }] });
    workflow.undo();
    expect(session.document.entities).toEqual(document.entities);
    workflow.redo();
    expect(session.document.entities.find((entity) => entity.handle === "D1")?.handle).toBe("D1");
    expect(session.document.entities.find((entity) => entity.handle === "H1")?.handle).toBe("H1");
  });
});
