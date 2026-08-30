import { createEmptyDocument } from "@kuubik/cad-core";
import { describe, expect, it } from "vitest";
import { prepareAlign, prepareBreak, prepareChamfer, prepareCopy, prepareExtend, prepareFillet, prepareLengthen, prepareMatchProperties, prepareMirror, prepareMove, prepareOffset, prepareRotate, prepareScale, prepareStretch, prepareTrim, putEntities } from "./modify-command.js";

function modifyDocument() {
  const document = createEmptyDocument({ documentId: "web-workflows", now: "2026-08-29T00:00:00.000Z" });
  document.entities.push(
    { kind: "line", handle: "10", layerId: "0", start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
    { kind: "line", handle: "20", layerId: "0", start: { x: 50, y: -50 }, end: { x: 50, y: 50 } },
  );
  return document;
}

describe("web modify command workflows", () => {
  it("normalizes ALIGN once for exact preview and atomic commit arguments", () => {
    const document = modifyDocument();
    const input = {
      targetHandles: ["10"],
      firstSourceInput: "0,0",
      firstDestinationInput: "200,300",
      secondSourceInput: "100,0",
      secondDestinationInput: "200,500",
      scaleToFit: true,
    };
    const preview = prepareAlign(document, input);
    const commit = prepareAlign(document, input);
    expect(preview).toEqual(commit);
    expect(preview.commandId).toBe("ALIGN");
    expect(preview.operationArgs).toMatchObject({ pointPairCount: 2, scaleToFit: true, scaleFactor: 2 });
    expect(putEntities(preview.result.changes)[0]).toMatchObject({
      kind: "line", start: { x: 200, y: 300 }, end: { x: 200, y: 500 },
    });
    expect(document.entities[0]).toMatchObject({ start: { x: 0, y: 0 }, end: { x: 100, y: 0 } });
  });

  it("normalizes LENGTHEN once for exact preview and atomic commit arguments", () => {
    const document = modifyDocument();
    const input = {
      mode: "delta" as const,
      measurement: "length" as const,
      valueInput: "25",
      targetsInput: "10@100,0; 10@125,0",
    };
    const preview = prepareLengthen(document, input);
    const commit = prepareLengthen(document, input);
    expect(preview).toEqual(commit);
    expect(preview.commandId).toBe("LENGTHEN");
    expect(preview.operationArgs).toMatchObject({
      mode: "delta", measurement: "length", value: 25, multiple: true,
      targets: [
        { handle: "10", pickPoint: { x: 100, y: 0 } },
        { handle: "10", pickPoint: { x: 125, y: 0 } },
      ],
    });
    expect(putEntities(preview.result.changes)).toEqual([{ kind: "line", handle: "10", layerId: "0", start: { x: 0, y: 0 }, end: { x: 150, y: 0 } }]);
  });

  it("normalizes MOVE through MIRROR once for both preview and commit", () => {
    const document = modifyDocument();
    const preparations = [
      () => prepareMove(document, { targetHandles: ["10"], baseInput: "0,0", destinationInput: "@10,20" }),
      () => prepareCopy(document, { targetHandles: ["10"], baseInput: "0,0", destinationsInput: "10,20; 20,30" }),
      () => prepareRotate(document, { targetHandles: ["10"], baseInput: "0,0", mode: "reference", angleInput: "0", referenceInput: "0", newAngleInput: "90" }),
      () => prepareScale(document, { targetHandles: ["10"], baseInput: "0,0", mode: "reference", factorInput: "1", referenceInput: "100", newLengthInput: "50", copy: true }),
      () => prepareMirror(document, { targetHandles: ["10"], firstPointInput: "0,0", secondPointInput: "0,100", eraseSource: false }),
    ];
    for (const prepare of preparations) {
      const preview = prepare();
      const commit = prepare();
      expect(preview).toEqual(commit);
      expect(putEntities(preview.result.changes)).toHaveLength(preview.result.changes.filter((change) => change.type === "put").length);
    }
  });

  it("normalizes OFFSET and TRIM options into deterministic operation arguments", () => {
    const document = modifyDocument();
    const offset = prepareOffset(document, {
      targetHandles: ["10"],
      mode: "distance",
      distanceInput: "10",
      placementInput: "0,20",
      multiple: false,
      eraseSource: false,
      layerMode: "source",
    });
    expect(offset.operationArgs).toMatchObject({ mode: "distance", distance: 10, multiple: false, eraseSource: false, layerMode: "source" });
    expect(prepareOffset(document, {
      targetHandles: ["10"], mode: "distance", distanceInput: "10", placementInput: "0,20", multiple: false, eraseSource: false, layerMode: "source",
    })).toEqual(offset);

    const trim = prepareTrim(document, {
      mode: "standard",
      cuttingHandlesInput: "20",
      targetsInput: "10@75,0",
      targetAction: "trim",
      edgeMode: "no-extend",
      projectMode: "none",
    });
    expect(trim.commandId).toBe("TRIM");
    expect(trim.operationArgs).toMatchObject({ mode: "standard", cuttingEdgeHandles: ["20"], edgeMode: "no-extend", projectMode: "none" });
    expect(prepareTrim(document, {
      mode: "standard", cuttingHandlesInput: "20", targetsInput: "10@75,0", targetAction: "trim", edgeMode: "no-extend", projectMode: "none",
    })).toEqual(trim);

    const extendDocument = modifyDocument();
    extendDocument.entities[0] = { kind: "line", handle: "10", layerId: "0", start: { x: 0, y: 0 }, end: { x: 40, y: 0 } };
    const extend = prepareExtend(extendDocument, {
      mode: "standard", boundaryHandlesInput: "20", targetsInput: "10@40,0", targetAction: "extend", edgeMode: "no-extend", projectMode: "none",
    });
    expect(extend.commandId).toBe("EXTEND");
    expect(extend.operationArgs).toMatchObject({ mode: "standard", boundaryEdgeHandles: ["20"], edgeMode: "no-extend", projectMode: "none" });
    expect(prepareExtend(extendDocument, {
      mode: "standard", boundaryHandlesInput: "20", targetsInput: "10@40,0", targetAction: "extend", edgeMode: "no-extend", projectMode: "none",
    })).toEqual(extend);
  });

  it("normalizes FILLET pair, Multiple, Polyline and No Trim inputs once for preview and commit", () => {
    const document = modifyDocument();
    const pairs = prepareFillet(document, {
      mode: "pairs", radiusInput: "10", trimMode: "no-trim",
      pairsInput: "10@25,0>20@50,25", polylineHandlesInput: "",
    });
    expect(pairs.commandId).toBe("FILLET");
    expect(pairs.operationArgs).toMatchObject({ mode: "pairs", radius: 10, trimMode: "no-trim", multiple: false });
    expect(pairs.result).toMatchObject({ rejected: [], createdHandles: ["21"], steps: [{ mode: "pair", effectiveRadius: 10 }] });
    expect(prepareFillet(document, {
      mode: "pairs", radiusInput: "10", trimMode: "no-trim",
      pairsInput: "10@25,0>20@50,25", polylineHandlesInput: "",
    })).toEqual(pairs);

    document.entities.push({
      kind: "polyline", handle: "30", layerId: "0", closed: true,
      vertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }],
    });
    const polyline = prepareFillet(document, {
      mode: "polyline", radiusInput: "5", trimMode: "no-trim", filletPolylineArc: 0,
      pairsInput: "", polylineHandlesInput: "30",
    });
    expect(polyline).toMatchObject({
      commandId: "FILLET",
      operationArgs: { mode: "polyline", radius: 5, trimMode: "no-trim", filletPolylineArc: 0, polylineHandles: ["30"] },
      result: { rejected: [], resultHandles: ["31", "32", "33", "34"], createdHandles: ["31", "32", "33", "34"], steps: [{ mode: "polyline" }] },
    });

    const segmentPair = prepareFillet(document, {
      mode: "pairs", radiusInput: "5", trimMode: "trim",
      pairsInput: "30#0@80,0>30#1@100,20", polylineHandlesInput: "",
    });
    expect(segmentPair).toMatchObject({
      operationArgs: { mode: "pairs", pairs: [{ firstHandle: "30", firstSegment: 0, secondHandle: "30", secondSegment: 1 }] },
      result: { rejected: [], sourceHandles: ["30"], resultHandles: ["30"], createdHandles: [] },
    });
  });

  it("normalizes CHAMFER Distance/Angle, Multiple, Polyline and Shift-corner once for preview and commit", () => {
    const document = modifyDocument();
    const pairs = prepareChamfer(document, {
      mode: "pairs", method: "distance", firstDistanceInput: "10", secondDistanceInput: "20", angleInput: "45", trimMode: "no-trim",
      pairsInput: "10@25,0>20@50,25; 10@25,0>20@50,25~0", polylineHandlesInput: "",
    });
    expect(pairs).toMatchObject({
      commandId: "CHAMFER",
      operationArgs: {
        mode: "pairs", specification: { method: "distance", firstDistance: 10, secondDistance: 20 }, trimMode: "no-trim", multiple: true,
        pairs: [{ firstHandle: "10" }, { sharpCorner: true }],
      },
      result: { rejected: [], createdHandles: ["21"], steps: [{ method: "distance" }, { method: "distance", effectiveDistances: [0, 0] }] },
    });
    expect(prepareChamfer(document, {
      mode: "pairs", method: "distance", firstDistanceInput: "10", secondDistanceInput: "20", angleInput: "45", trimMode: "no-trim",
      pairsInput: "10@25,0>20@50,25; 10@25,0>20@50,25~0", polylineHandlesInput: "",
    })).toEqual(pairs);

    document.entities.push({
      kind: "polyline", handle: "30", layerId: "0", closed: true,
      vertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }],
    });
    const polyline = prepareChamfer(document, {
      mode: "polyline", method: "angle", firstDistanceInput: "5", secondDistanceInput: "999", angleInput: "45", trimMode: "trim",
      pairsInput: "", polylineHandlesInput: "30",
    });
    expect(polyline).toMatchObject({
      commandId: "CHAMFER",
      operationArgs: { mode: "polyline", specification: { method: "angle", firstDistance: 5, angleDeg: 45 }, trimMode: "trim", polylineHandles: ["30"] },
      result: { rejected: [], sourceHandles: ["30"], resultHandles: ["30"], createdHandles: [], steps: [{ mode: "polyline" }] },
    });
  });

  it("normalizes BREAK two-point and at-point targets once for preview and commit", () => {
    const document = modifyDocument();
    const prepared = prepareBreak(document, {
      targetsInput: "10@25,0>75,0; 20@50,0>@",
    });
    expect(prepared).toMatchObject({
      commandId: "BREAK",
      operationArgs: {
        multiple: true,
        targets: [
          { handle: "10", firstPoint: { x: 25, y: 0 }, secondPoint: { x: 75, y: 0 }, mode: "two-point" },
          { handle: "20", firstPoint: { x: 50, y: 0 }, mode: "at-point" },
        ],
      },
      result: {
        sourceHandles: ["10", "20"],
        createdHandles: ["21", "22"],
        rejected: [],
        steps: [{ mode: "two-point" }, { mode: "at-point" }],
      },
    });
    expect(prepareBreak(document, { targetsInput: "10@25,0>75,0; 20@50,0>@" })).toEqual(prepared);
  });

  it("normalizes STRETCH crossing windows, polygons, individual selection and relative displacement once", () => {
    const document = modifyDocument();
    const prepared = prepareStretch(document, {
      crossingInput: "40,-10; 110,20 | 45,-60; 60,-60; 60,-40; 45,-40",
      individualHandles: ["20"],
      baseInput: "0,0",
      destinationInput: "@25,5",
    });
    expect(prepared).toMatchObject({
      commandId: "STRETCH",
      operationArgs: {
        regions: [{ kind: "crossing-window" }, { kind: "crossing-polygon" }],
        basePoint: { x: 0, y: 0 }, destinationPoint: { x: 25, y: 5 }, delta: { x: 25, y: 5 },
      },
      result: {
        sourceHandles: ["10", "20"], stretchedHandles: ["10"], movedHandles: ["20"], rejected: [],
      },
    });
    expect(prepareStretch(document, {
      crossingInput: "40,-10; 110,20 | 45,-60; 60,-60; 60,-40; 45,-40",
      individualHandles: ["20"], baseInput: "0,0", destinationInput: "@25,5",
    })).toEqual(prepared);
  });

  it("uses one MATCHPROP preparation for preview and atomic commit", () => {
    const document = modifyDocument();
    document.entities[0]!.appearance = { color: "#ff0000", linetypeScale: 2, thickness: 3 };
    document.entities[1]!.appearance = { color: "#00ff00" };
    const input = {
      sourceHandle: "10",
      targetHandles: ["20"],
      settings: { layer: false, thickness: false },
    };
    const preview = prepareMatchProperties(document, input);
    const commit = prepareMatchProperties(document, input);
    expect(preview).toEqual(commit);
    expect(preview).toMatchObject({
      commandId: "MATCHPROP",
      operationArgs: { sourceHandle: "10", targetHandles: ["20"], settings: { layer: false, thickness: false } },
      result: { sourceHandle: "10", targetHandles: ["20"], matchedHandles: ["20"], rejected: [] },
    });
    expect(putEntities(preview.result.changes)).toMatchObject([{ handle: "20", appearance: { color: "#ff0000", linetypeScale: 2 } }]);
  });
});
