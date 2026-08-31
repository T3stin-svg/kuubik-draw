import { CadSession, createEmptyDocument, createRadialDimension } from "@kuubik/cad-core";
import type { KDrawDocumentV1 } from "@kuubik/cad-schema";
import { describe, expect, it } from "vitest";
import { createAssociativeEntityWorkflow } from "./association-workflow.js";
import { createAnnotationCommandWorkflow, type AnnotationCommandInput } from "./command-adapter.js";

function fixture(): KDrawDocumentV1 {
  const document = createEmptyDocument({ documentId: "dimension-wave10-wiring", now: "2026-08-31T20:30:00.000Z" });
  document.textStyles.push({ id: "TXT", name: "TXT", fontFamily: "Arial", widthFactor: 1, obliqueAngleRad: 0 });
  document.dimensionStyles.push({ id: "DIM", name: "DIM", textStyleId: "TXT", textHeight: 2.5, arrowSize: 3, extensionOffset: 1, scale: 1 });
  document.entities.push(
    { kind: "line", handle: "10", layerId: "0", start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
    { kind: "line", handle: "11", layerId: "0", start: { x: 0, y: 0 }, end: { x: 0, y: 100 } },
    { kind: "line", handle: "12", layerId: "0", start: { x: 0, y: 0 }, end: { x: 50, y: 0 } },
    { kind: "circle", handle: "20", layerId: "0", center: { x: 200, y: 100 }, radius: 10 },
  );
  return document;
}

function drawingContent(document: KDrawDocumentV1) {
  return structuredClone({
    entities: document.entities,
    blocks: document.blocks,
    textStyles: document.textStyles,
    dimensionStyles: document.dimensionStyles,
  });
}

const dimensionInputs: AnnotationCommandInput[] = [
  { commandId: "DIMLINEAR", args: { handle: "D1", layerId: "0", styleId: "DIM", first: { x: 0, y: 0 }, second: { x: 100, y: 0 }, dimensionLinePoint: { x: 0, y: 20 }, axis: "horizontal", anchors: [{ handle: "10", feature: "start", fallback: { x: 0, y: 0 } }, { handle: "10", feature: "end", fallback: { x: 100, y: 0 } }] }, targetHandles: ["10"] },
  { commandId: "DIMALIGNED", args: { handle: "D2", layerId: "0", styleId: "DIM", first: { x: 0, y: 0 }, second: { x: 100, y: 0 }, dimensionLinePoint: { x: 0, y: 20 }, anchors: [{ handle: "10", feature: "start", fallback: { x: 0, y: 0 } }, { handle: "10", feature: "end", fallback: { x: 100, y: 0 } }] }, targetHandles: ["10"] },
  { commandId: "DIMANGULAR", args: { handle: "D3", layerId: "0", styleId: "DIM", vertex: { x: 0, y: 0 }, firstRayPoint: { x: 100, y: 0 }, secondRayPoint: { x: 0, y: 100 }, arcPoint: { x: 20, y: 20 }, anchors: [{ handle: "10", feature: "start", fallback: { x: 0, y: 0 } }, { handle: "10", feature: "end", fallback: { x: 100, y: 0 } }, { handle: "11", feature: "end", fallback: { x: 0, y: 100 } }] }, targetHandles: ["10", "11"] },
  { commandId: "DIMRADIUS", args: { handle: "D4", layerId: "0", styleId: "DIM", center: { x: 200, y: 100 }, circumferencePoint: { x: 210, y: 100 }, textPoint: { x: 220, y: 100 }, anchors: [{ handle: "20", feature: "center", fallback: { x: 200, y: 100 } }, { handle: "20", feature: "quadrant", quadrantIndex: 0, fallback: { x: 210, y: 100 } }] }, targetHandles: ["20"] },
  { commandId: "DIMDIAMETER", args: { handle: "D5", layerId: "0", styleId: "DIM", center: { x: 200, y: 100 }, circumferencePoint: { x: 210, y: 100 }, textPoint: { x: 220, y: 100 }, anchors: [{ handle: "20", feature: "center", fallback: { x: 200, y: 100 } }, { handle: "20", feature: "quadrant", quadrantIndex: 0, fallback: { x: 210, y: 100 } }] }, targetHandles: ["20"] },
  { commandId: "DIMCONTINUE", args: { handles: ["D6", "D7"], layerId: "0", styleId: "DIM", points: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }], dimensionLinePoint: { x: 0, y: 20 }, axis: "horizontal", chainId: "CONT", anchors: [{ handle: "10", feature: "start", fallback: { x: 0, y: 0 } }, { handle: "12", feature: "end", fallback: { x: 50, y: 0 } }, { handle: "10", feature: "end", fallback: { x: 100, y: 0 } }] }, targetHandles: ["10", "12"] },
  { commandId: "DIMBASELINE", args: { handles: ["D8", "D9"], layerId: "0", styleId: "DIM", points: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }], dimensionLinePoints: [{ x: 0, y: 20 }, { x: 0, y: 30 }], axis: "horizontal", chainId: "BASE", anchors: [{ handle: "10", feature: "start", fallback: { x: 0, y: 0 } }, { handle: "12", feature: "end", fallback: { x: 50, y: 0 } }, { handle: "10", feature: "end", fallback: { x: 100, y: 0 } }] }, targetHandles: ["10", "12"] },
];

describe("F-061..F-066 web adapter wiring", () => {
  it.each(dimensionInputs)("wires $commandId through deterministic preview, atomic commit and exact Undo/Redo", (input) => {
    const session = new CadSession(fixture());
    const workflow = createAnnotationCommandWorkflow(session);
    const before = drawingContent(session.document);
    const preview = workflow.preview(input);
    expect(workflow.preview(input)).toEqual(preview);
    const committed = workflow.commit(input, `wave10:${input.commandId}`);
    expect(committed.changes).toEqual(preview.changes);
    expect(session.document.revision).toBe(1);
    expect(preview.resultHandles.every((handle) => session.document.entities.some((entity) => entity.handle === handle))).toBe(true);
    const after = drawingContent(session.document);
    workflow.undo();
    expect(drawingContent(session.document)).toEqual(before);
    workflow.redo();
    expect(drawingContent(session.document)).toEqual(after);
  });

  it("refuses an orphan-producing geometry delete before committing a revision", () => {
    const document = fixture();
    document.entities.push(createRadialDimension(document, {
      handle: "R1",
      layerId: "0",
      styleId: "DIM",
      center: { x: 200, y: 100 },
      circumferencePoint: { x: 210, y: 100 },
      textPoint: { x: 220, y: 100 },
      anchors: [{ handle: "20", feature: "center", fallback: { x: 200, y: 100 } }, { handle: "20", feature: "quadrant", quadrantIndex: 0, fallback: { x: 210, y: 100 } }],
    }));
    const session = new CadSession(document);
    const workflow = createAssociativeEntityWorkflow(session);
    expect(() => workflow.commit({ commandId: "ERASE", entityChanges: [{ type: "delete", handle: "20" }], changedHandles: ["20"] }, "wave10:orphan-delete")).toThrow(/Broken dimension association R1 -> 20/u);
    expect(session.document.revision).toBe(0);
    expect(session.document.entities.some((entity) => entity.handle === "20")).toBe(true);
  });
});
