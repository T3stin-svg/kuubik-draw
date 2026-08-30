import { createEmptyDocument } from "@kuubik/cad-core";
import { describe, expect, it } from "vitest";
import { prepareCopy, prepareExtend, prepareFillet, prepareMirror, prepareMove, prepareOffset, prepareRotate, prepareScale, prepareTrim, putEntities } from "./modify-command.js";

function modifyDocument() {
  const document = createEmptyDocument({ documentId: "web-workflows", now: "2026-08-29T00:00:00.000Z" });
  document.entities.push(
    { kind: "line", handle: "10", layerId: "0", start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
    { kind: "line", handle: "20", layerId: "0", start: { x: 50, y: -50 }, end: { x: 50, y: 50 } },
  );
  return document;
}

describe("web modify command workflows", () => {
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
});
