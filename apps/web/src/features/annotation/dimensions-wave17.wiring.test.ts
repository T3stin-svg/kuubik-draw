import { CadSession, createEmptyDocument, readDimensionAssociation } from "@kuubik/cad-core";
import type { KDrawDocumentV1 } from "@kuubik/cad-schema";
import { describe, expect, it } from "vitest";
import { createAssociativeEntityWorkflow } from "./association-workflow.js";
import { createAnnotationCommandWorkflow, type AnnotationCommandInput } from "./command-adapter.js";

function fixture(): KDrawDocumentV1 {
  const document = createEmptyDocument({ documentId: "F-061-wiring" });
  document.textStyles.push({ id: "TXT", name: "TXT", fontFamily: "Arial", widthFactor: 1, obliqueAngleRad: 0 });
  document.dimensionStyles.push({ id: "DIM", name: "DIM", textStyleId: "TXT", textHeight: 2.5, arrowSize: 3, extensionOffset: 1, scale: 1 });
  document.layers.push({ id: "DIMS", name: "DIMS", visible: true, frozen: false, locked: false, plottable: true });
  document.entities.push({ kind: "line", handle: "A1", layerId: "0", start: { x: 0, y: 0 }, end: { x: 100, y: 40 } });
  return document;
}

type LinearInput = Extract<AnnotationCommandInput, { commandId: "DIMLINEAR" }>;

const cases: LinearInput[] = [
  { commandId: "DIMLINEAR", args: { handle: "D1", layerId: "DIMS", styleId: "DIM", first: { x: 0, y: 0 }, second: { x: 100, y: 40 }, dimensionLinePoint: { x: 0, y: 60 }, axis: "horizontal" } },
  { commandId: "DIMLINEAR", args: { handle: "D2", layerId: "DIMS", styleId: "DIM", first: { x: 0, y: 0 }, second: { x: 100, y: 40 }, dimensionLinePoint: { x: 120, y: 0 }, axis: "vertical" } },
  { commandId: "DIMLINEAR", args: { handle: "D3", layerId: "DIMS", styleId: "DIM", first: { x: 0, y: 0 }, second: { x: 100, y: 40 }, dimensionLinePoint: { x: 0, y: 60 }, textPoint: { x: 50, y: 70 }, overrideText: "L=<> mm", axis: "rotated", rotationRad: Math.PI / 6 } },
];

describe("F-061 DIMLINEAR command wiring", () => {
  it.each(cases)("makes $args.axis preview equal commit and one atomic Undo/Redo step", (input) => {
    const session = new CadSession(fixture());
    const workflow = createAnnotationCommandWorkflow(session);
    const before = structuredClone(session.document.entities);
    const preview = workflow.preview(input);
    expect(workflow.preview(input)).toEqual(preview);
    expect(workflow.commit(input, `F-061:${input.args.axis}`).changes).toEqual(preview.changes);
    expect(session.document.revision).toBe(1);
    const after = structuredClone(session.document.entities);
    workflow.undo();
    expect(session.document.entities).toEqual(before);
    workflow.redo();
    expect(session.document.entities).toEqual(after);
  });

  it("updates associative origins atomically without changing annotation identity or presentation metadata", () => {
    const session = new CadSession(fixture());
    createAnnotationCommandWorkflow(session).commit({ commandId: "DIMLINEAR", args: { handle: "D4", layerId: "DIMS", styleId: "DIM", first: { x: 0, y: 0 }, second: { x: 100, y: 40 }, dimensionLinePoint: { x: 0, y: 60 }, textPoint: { x: 50, y: 70 }, overrideText: "<>", axis: "horizontal", anchors: [{ handle: "a1", feature: "start", fallback: { x: 0, y: 0 } }, { handle: "a1", feature: "end", fallback: { x: 100, y: 40 } }] }, targetHandles: ["A1"] }, "F-061:create");
    const geometry = createAssociativeEntityWorkflow(session);
    const moved = { kind: "line" as const, handle: "A1", layerId: "0", start: { x: 5, y: 10 }, end: { x: 125, y: 50 } };
    const preview = geometry.preview({ commandId: "MOVE", entityChanges: [{ type: "put", entity: moved }], changedHandles: ["A1"] });
    const committed = geometry.commit({ commandId: "MOVE", entityChanges: [{ type: "put", entity: moved }], changedHandles: ["A1"] }, "F-061:move");
    expect(committed.changes).toEqual(preview.changes);
    const dimension = session.document.entities.find((entity) => entity.handle === "D4");
    expect(dimension).toMatchObject({ kind: "dimension", handle: "D4", layerId: "DIMS", styleId: "DIM", overrideText: "<>", definitionPoints: [{ x: 5, y: 10 }, { x: 125, y: 50 }, { x: 0, y: 60 }, { x: 50, y: 70 }] });
    expect(dimension?.kind === "dimension" ? readDimensionAssociation(dimension) : null).toMatchObject({ linearAxis: "horizontal", textPlacement: "manual" });
    geometry.undo();
    expect(session.document.entities.find((entity) => entity.handle === "A1")).toMatchObject({ end: { x: 100, y: 40 } });
    expect(session.document.entities.find((entity) => entity.handle === "D4")).toMatchObject({ definitionPoints: [{ x: 0, y: 0 }, { x: 100, y: 40 }, { x: 0, y: 60 }, { x: 50, y: 70 }] });
  });

  it("fails closed on source deletion without adding an Undo step", () => {
    const session = new CadSession(fixture());
    createAnnotationCommandWorkflow(session).commit({ commandId: "DIMLINEAR", args: { handle: "D5", layerId: "DIMS", styleId: "DIM", first: { x: 0, y: 0 }, second: { x: 100, y: 40 }, dimensionLinePoint: { x: 0, y: 60 }, axis: "horizontal", anchors: [{ handle: "A1", feature: "start", fallback: { x: 0, y: 0 } }, { handle: "A1", feature: "end", fallback: { x: 100, y: 40 } }] } }, "F-061:create-delete");
    expect(() => createAssociativeEntityWorkflow(session).commit({ commandId: "ERASE", entityChanges: [{ type: "delete", handle: "A1" }], changedHandles: ["A1"] }, "F-061:delete")).toThrow(/Broken dimension association/u);
    expect(session.document.revision).toBe(1);
    expect(session.document.entities.some((entity) => entity.handle === "A1")).toBe(true);
  });
});
