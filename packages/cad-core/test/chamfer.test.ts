import { describe, expect, it } from "vitest";
import type { CadLine, CadPolyline } from "@kuubik/cad-schema";
import {
  CadCommandInputError,
  CadSession,
  chamferCadEntityPair,
  chamferCadPolyline,
  chamferCadPolylineSegmentPair,
  chamferCadPolylineSegments,
  chamferCadPolylineSegmentWithEntity,
  createEmptyDocument,
  executeChamfer,
  parseChamferAngle,
  parseChamferDistance,
  parseChamferPairPicks,
  resolveCadCommand,
} from "../src/index.js";

const horizontal: CadLine = {
  kind: "line", handle: "10", layerId: "0",
  start: { x: -100, y: 0 }, end: { x: 0, y: 0 },
  appearance: { aciIndex: 1, colorMethod: "aci", color: "#ff0000", lineweightMm: 0.5 },
};
const vertical: CadLine = {
  kind: "line", handle: "20", layerId: "0",
  start: { x: 0, y: 0 }, end: { x: 0, y: 100 },
};

describe("CHAMFER clean-room geometry", () => {
  it("applies ordered first/second distances and trims the picked rays", () => {
    const result = chamferCadEntityPair(
      horizontal, { x: -50, y: 0 }, vertical, { x: 0, y: 50 },
      { method: "distance", firstDistance: 10, secondDistance: 20 }, "trim",
    );
    expect(result).toEqual({
      firstEntity: { ...horizontal, end: { x: -10, y: 0 } },
      secondEntity: { ...vertical, start: { x: 0, y: 20 } },
      line: { kind: "line", start: { x: -10, y: 0 }, end: { x: 0, y: 20 } },
      intersection: { x: 0, y: 0 },
      chamferPoints: [{ x: -10, y: 0 }, { x: 0, y: 20 }],
      effectiveDistances: [10, 20],
      reason: null,
    });
  });

  it("derives the second distance from the first selection and angle", () => {
    const result = chamferCadEntityPair(
      horizontal, { x: -50, y: 0 }, vertical, { x: 0, y: 50 },
      { method: "angle", firstDistance: 25, angleDeg: 45 }, "trim",
    );
    expect(result.effectiveDistances?.[0]).toBe(25);
    expect(result.effectiveDistances?.[1]).toBeCloseTo(25, 12);
    expect(result.line).toEqual({ kind: "line", start: { x: -25, y: 0 }, end: { x: 0, y: 25 } });
  });

  it("keeps sources unchanged in No Trim and applies a zero-distance sharp corner without a new line", () => {
    const noTrim = chamferCadEntityPair(
      horizontal, { x: -50, y: 0 }, vertical, { x: 0, y: 50 },
      { method: "distance", firstDistance: 10, secondDistance: 20 }, "no-trim",
    );
    expect(noTrim.firstEntity).toEqual(horizontal);
    expect(noTrim.secondEntity).toEqual(vertical);
    expect(noTrim.line).not.toBeNull();

    const separatedFirst = { ...horizontal, end: { x: -10, y: 0 } };
    const separatedSecond = { ...vertical, start: { x: 0, y: 10 } };
    const sharp = chamferCadEntityPair(
      separatedFirst, { x: -50, y: 0 }, separatedSecond, { x: 0, y: 50 },
      { method: "distance", firstDistance: 0, secondDistance: 0 }, "trim",
    );
    expect(sharp.line).toBeNull();
    expect(sharp.firstEntity).toMatchObject({ end: { x: 0, y: 0 } });
    expect(sharp.secondEntity).toMatchObject({ start: { x: 0, y: 0 } });
  });

  it("keeps standalone LINE targets extendable beyond their finite endpoints", () => {
    const result = chamferCadEntityPair(
      { ...horizontal, start: { x: -100, y: 0 }, end: { x: -10, y: 0 } }, { x: -50, y: 0 },
      { ...vertical, start: { x: 0, y: 10 }, end: { x: 0, y: 100 } }, { x: 0, y: 50 },
      { method: "distance", firstDistance: 200, secondDistance: 200 }, "trim",
    );
    expect(result).toMatchObject({
      reason: null,
      firstEntity: { kind: "line", start: { x: -100, y: 0 }, end: { x: -200, y: 0 } },
      secondEntity: { kind: "line", start: { x: 0, y: 200 }, end: { x: 0, y: 100 } },
      line: { start: { x: -200, y: 0 }, end: { x: 0, y: 200 } },
    });
  });

  it("matches AutoCAD RAY/XLINE trim domains and preserves No Trim construction objects", () => {
    const sourceRay = { kind: "ray" as const, handle: "10", layerId: "0", basePoint: { x: -100, y: 0 }, direction: { x: 1, y: 0 } };
    const sourceXline = { kind: "xline" as const, handle: "20", layerId: "0", basePoint: { x: 0, y: 0 }, direction: { x: 0, y: 2 } };
    const result = chamferCadEntityPair(
      sourceRay, { x: -50, y: 0 }, sourceXline, { x: 0, y: 50 },
      { method: "distance", firstDistance: 10, secondDistance: 20 }, "trim",
    );
    expect(result.firstEntity).toEqual({ kind: "line", handle: "10", layerId: "0", start: { x: -100, y: 0 }, end: { x: -10, y: 0 } });
    expect(result.secondEntity).toMatchObject({ kind: "ray", basePoint: { x: 0, y: 20 }, direction: { x: 0, y: 1 } });

    const forward = chamferCadEntityPair(
      { ...sourceRay, basePoint: { x: 0, y: 0 } }, { x: 150, y: 0 },
      { ...sourceXline, basePoint: { x: 100, y: 0 } }, { x: 100, y: 50 },
      { method: "distance", firstDistance: 10, secondDistance: 20 }, "trim",
    );
    expect(forward.firstEntity).toMatchObject({ kind: "ray", basePoint: { x: 110, y: 0 }, direction: { x: 1, y: 0 } });
    expect(forward.secondEntity).toMatchObject({ kind: "ray", basePoint: { x: 100, y: 20 }, direction: { x: 0, y: 1 } });

    const noTrim = chamferCadEntityPair(
      sourceRay, { x: -50, y: 0 }, sourceXline, { x: 0, y: 50 },
      { method: "distance", firstDistance: 10, secondDistance: 20 }, "no-trim",
    );
    expect(noTrim.firstEntity).toEqual(sourceRay);
    expect(noTrim.secondEntity).toEqual(sourceXline);
  });

  it("rejects parallel and unsupported sources without invented geometry", () => {
    expect(chamferCadEntityPair(
      horizontal, { x: -50, y: 0 }, { ...horizontal, handle: "20", start: { x: -100, y: 10 }, end: { x: 0, y: 10 } }, { x: -50, y: 10 },
      { method: "distance", firstDistance: 10, secondDistance: 10 }, "trim",
    ).reason).toBe("parallel");
    expect(chamferCadEntityPair(
      horizontal, { x: -50, y: 0 }, { kind: "circle", handle: "20", layerId: "0", center: { x: 0, y: 0 }, radius: 10 }, { x: 10, y: 0 },
      { method: "distance", firstDistance: 10, secondDistance: 10 }, "trim",
    ).reason).toBe("unsupported-target");
  });
});

describe("CHAMFER command registry and atomic transaction", () => {
  it("resolves CHA/CHAMFER and parses Distance, Angle and Shift-pair input", () => {
    expect(resolveCadCommand("cha")?.id).toBe("CHAMFER");
    expect(resolveCadCommand(" CHAMFER ")?.id).toBe("CHAMFER");
    expect(parseChamferDistance(" 0 ")).toBe(0);
    expect(parseChamferDistance("12.5")).toBe(12.5);
    expect(parseChamferAngle("45")).toBe(45);
    expect(parseChamferPairPicks("10#0@-50,0>20#1@0,50~0")).toEqual([{
      firstHandle: "10", firstSegment: 0, firstPickPoint: { x: -50, y: 0 },
      secondHandle: "20", secondSegment: 1, secondPickPoint: { x: 0, y: 50 }, sharpCorner: true,
    }]);
    expect(() => parseChamferDistance("-1")).toThrow(CadCommandInputError);
    expect(() => parseChamferAngle("180")).toThrow(/less than 180/);
    expect(() => parseChamferPairPicks("10@0,0>20@1,1~2")).toThrow(/~0/);
  });

  it("executes Multiple in order, allocates deterministic lines and refuses bad targets without partial writes", () => {
    const document = createEmptyDocument({ documentId: "chamfer-command", now: "2026-08-30T00:00:00.000Z" });
    document.layers.push({ id: "locked", name: "LOCKED", visible: true, frozen: false, locked: true, plottable: true });
    document.entities.push(
      horizontal,
      vertical,
      { kind: "line", handle: "30", layerId: "locked", start: { x: 200, y: 0 }, end: { x: 300, y: 0 } },
    );
    const result = executeChamfer(document, {
      mode: "pairs", specification: { method: "distance", firstDistance: 10, secondDistance: 20 }, trimMode: "trim",
      pairs: [
        { firstHandle: "10", firstPickPoint: { x: -50, y: 0 }, secondHandle: "20", secondPickPoint: { x: 0, y: 50 } },
        { firstHandle: "30", firstPickPoint: { x: 250, y: 0 }, secondHandle: "20", secondPickPoint: { x: 0, y: 50 } },
        { firstHandle: "missing", firstPickPoint: { x: 0, y: 0 }, secondHandle: "20", secondPickPoint: { x: 0, y: 50 } },
      ],
    });
    expect(result).toMatchObject({
      sourceHandles: ["10", "20"], resultHandles: ["10", "20", "31"], createdHandles: ["31"], multiple: true,
      rejected: [{ sourceIndex: 1, handles: ["30", "20"], reason: "locked-layer" }, { sourceIndex: 2, handles: ["missing", "20"], reason: "missing" }],
    });
    expect(result.changes).toEqual([
      { type: "put", entity: { ...horizontal, end: { x: -10, y: 0 } } },
      { type: "put", entity: { ...vertical, start: { x: 0, y: 20 } } },
      { type: "put", entity: { kind: "line", handle: "31", layerId: "0", start: { x: -10, y: 0 }, end: { x: 0, y: 20 } } },
    ]);
    expect(document.entities).toHaveLength(3);
  });

  it("commits a full Polyline operation as one global Undo/Redo step", () => {
    const document = createEmptyDocument({ documentId: "chamfer-polyline", now: "2026-08-30T00:00:00.000Z" });
    const rectangle: CadPolyline = { kind: "polyline", handle: "10", layerId: "0", closed: true, vertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }] };
    document.entities.push(rectangle);
    const result = executeChamfer(document, {
      mode: "polyline", specification: { method: "distance", firstDistance: 10, secondDistance: 10 }, trimMode: "trim", polylineHandles: ["10"],
    });
    expect(result).toMatchObject({ sourceHandles: ["10"], resultHandles: ["10"], createdHandles: [], rejected: [], steps: [{ skippedVertices: [] }] });
    const session = new CadSession(document);
    session.commit({ opId: "F-025-polyline", baseRevision: 0, commandId: "CHAMFER", args: {}, targetHandles: result.sourceHandles, resultHandles: result.resultHandles }, result.changes);
    expect(session.document.entities[0]).toMatchObject({ kind: "polyline", handle: "10", vertices: expect.arrayContaining([{ x: 10, y: 0 }]) });
    session.undo();
    expect(session.document.entities).toEqual([rectangle]);
    session.redo();
    expect(session.document.entities[0]).toMatchObject({ vertices: expect.arrayContaining([{ x: 10, y: 0 }]) });

    const noTrim = executeChamfer(document, {
      mode: "polyline", specification: { method: "distance", firstDistance: 10, secondDistance: 10 }, trimMode: "no-trim", polylineHandles: ["10"],
    });
    expect(noTrim).toMatchObject({ sourceHandles: ["10"], createdHandles: ["11", "12", "13", "14"], resultHandles: ["11", "12", "13", "14"] });
    expect(noTrim.changes).toHaveLength(4);
  });

  it("commits AutoCAD-compatible RAY/XLINE conversions and No Trim preservation atomically", () => {
    const document = createEmptyDocument({ documentId: "chamfer-construction-lines" });
    document.entities.push(
      {
        kind: "ray", handle: "10", layerId: "0", basePoint: { x: -100, y: 0 }, direction: { x: 4, y: 0 },
        appearance: { aciIndex: 1, colorMethod: "aci", color: "#ff0000", lineweightMm: 0.5 },
      },
      {
        kind: "xline", handle: "20", layerId: "0", basePoint: { x: 0, y: 0 }, direction: { x: 0, y: 3 },
        appearance: { aciIndex: 1, colorMethod: "aci", color: "#ff0000", lineweightMm: 0.5 },
      },
    );
    const trim = executeChamfer(document, {
      mode: "pairs", specification: { method: "distance", firstDistance: 10, secondDistance: 20 }, trimMode: "trim",
      pairs: [{ firstHandle: "10", firstPickPoint: { x: -50, y: 0 }, secondHandle: "20", secondPickPoint: { x: 0, y: 50 } }],
    });
    expect(trim).toMatchObject({
      sourceHandles: ["10", "20"], resultHandles: ["10", "20", "21"], createdHandles: ["21"], rejected: [],
      steps: [{ sourceHandles: ["10", "20"], resultHandles: ["10", "20", "21"], effectiveDistances: [10, 20] }],
    });
    expect(trim.changes).toEqual([
      { type: "put", entity: expect.objectContaining({ kind: "line", handle: "10", start: { x: -100, y: 0 }, end: { x: -10, y: 0 } }) },
      { type: "put", entity: expect.objectContaining({ kind: "ray", handle: "20", basePoint: { x: 0, y: 20 }, direction: { x: 0, y: 1 } }) },
      {
        type: "put",
        entity: expect.objectContaining({
          kind: "line", handle: "21", layerId: "0", start: { x: -10, y: 0 }, end: { x: 0, y: 20 },
          appearance: { lineweightMm: 0.5 },
        }),
      },
    ]);

    const session = new CadSession(document);
    session.commit({ opId: "F-025-ray-xline", baseRevision: 0, commandId: "CHAMFER", args: {}, targetHandles: trim.sourceHandles, resultHandles: trim.resultHandles }, trim.changes);
    expect(session.document.entities.map((entity) => `${entity.handle}:${entity.kind}`)).toEqual(["10:line", "20:ray", "21:line"]);
    session.undo();
    expect(session.document.entities).toEqual(document.entities);
    session.redo();
    expect(session.document.entities.map((entity) => `${entity.handle}:${entity.kind}`)).toEqual(["10:line", "20:ray", "21:line"]);

    const noTrim = executeChamfer(document, {
      mode: "pairs", specification: { method: "distance", firstDistance: 10, secondDistance: 20 }, trimMode: "no-trim",
      pairs: [{ firstHandle: "10", firstPickPoint: { x: -50, y: 0 }, secondHandle: "20", secondPickPoint: { x: 0, y: 50 } }],
    });
    expect(noTrim).toMatchObject({ sourceHandles: ["10", "20"], resultHandles: ["21"], createdHandles: ["21"], rejected: [] });
    expect(noTrim.changes).toEqual([
      {
        type: "put",
        entity: expect.objectContaining({ kind: "line", handle: "21", start: { x: -10, y: 0 }, end: { x: 0, y: 20 } }),
      },
    ]);
    expect(document.entities.map((entity) => entity.kind)).toEqual(["ray", "xline"]);
  });

  it("uses current layer with ByLayer colour/linetype and second-selection lineweight/transparency", () => {
    const document = createEmptyDocument({ documentId: "chamfer-properties" });
    document.layers.push(
      { id: "first", name: "FIRST", visible: true, frozen: false, locked: false, plottable: true },
      { id: "second", name: "SECOND", visible: true, frozen: false, locked: false, plottable: true },
      { id: "current", name: "CURRENT", visible: true, frozen: false, locked: false, plottable: true },
    );
    document.currentLayerId = "current";
    document.entities.push(
      { ...horizontal, layerId: "first", appearance: { color: "#ff0000", colorMethod: "aci", aciIndex: 1, linetypeId: "first-type", lineweightMm: 0.5, transparency: 50 } },
      { ...vertical, layerId: "second", appearance: { color: "#00ff00", colorMethod: "aci", aciIndex: 3, linetypeId: "second-type", lineweightMm: 0.35, transparency: 25 } },
    );
    const result = executeChamfer(document, {
      mode: "pairs", specification: { method: "distance", firstDistance: 10, secondDistance: 20 }, trimMode: "no-trim",
      pairs: [{ firstHandle: "10", firstPickPoint: { x: -50, y: 0 }, secondHandle: "20", secondPickPoint: { x: 0, y: 50 } }],
    });
    expect(result.changes).toEqual([{ type: "put", entity: {
      kind: "line", handle: "21", layerId: "current", appearance: { lineweightMm: 0.35, transparency: 25 },
      start: { x: -10, y: 0 }, end: { x: 0, y: 20 },
    } }]);
  });

  it("reports an already-intersecting Shift sharp corner as a successful zero-mutation step", () => {
    const document = createEmptyDocument({ documentId: "chamfer-shift-no-op" });
    document.entities.push(horizontal, vertical);
    const result = executeChamfer(document, {
      mode: "pairs", specification: { method: "distance", firstDistance: 10, secondDistance: 20 }, trimMode: "trim",
      pairs: [{ firstHandle: "10", firstPickPoint: { x: -50, y: 0 }, secondHandle: "20", secondPickPoint: { x: 0, y: 50 }, sharpCorner: true }],
    });
    expect(result).toMatchObject({ changes: [], sourceHandles: ["10", "20"], createdHandles: [], rejected: [], steps: [{ resultHandles: ["10", "20"], chamferPoints: [{ x: 0, y: 0 }, { x: 0, y: 0 }] }] });
    expect(document.entities).toEqual([horizontal, vertical]);
  });

  it("commits zero-distance Polyline and same-polyline pair workflows as successful no-ops", () => {
    const rectangle: CadPolyline = {
      kind: "polyline", handle: "30", layerId: "0", closed: true,
      vertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }],
    };
    const document = createEmptyDocument({ documentId: "chamfer-polyline-zero-no-op" });
    document.entities.push(rectangle);
    const polyline = executeChamfer(document, {
      mode: "polyline", specification: { method: "distance", firstDistance: 0, secondDistance: 0 }, trimMode: "trim", polylineHandles: ["30"],
    });
    const pair = executeChamfer(document, {
      mode: "pairs", specification: { method: "distance", firstDistance: 0, secondDistance: 0 }, trimMode: "trim",
      pairs: [{ firstHandle: "30", firstSegment: 3, firstPickPoint: { x: 0, y: 20 }, secondHandle: "30", secondSegment: 0, secondPickPoint: { x: 20, y: 0 } }],
    });
    expect(polyline).toMatchObject({ changes: [], sourceHandles: ["30"], resultHandles: ["30"], createdHandles: [], rejected: [] });
    expect(pair).toMatchObject({ changes: [], sourceHandles: ["30"], resultHandles: ["30"], createdHandles: [], rejected: [] });
    expect(polyline.steps).toHaveLength(1);
    expect(pair.steps).toHaveLength(1);
    expect(document.entities).toEqual([rectangle]);
  });
});

describe("CHAMFER 2D polyline geometry", () => {
  const rectangle: CadPolyline = {
    kind: "polyline", handle: "30", layerId: "0", closed: true,
    appearance: { color: "#00ff00", lineweightMm: 0.35 },
    vertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }],
  };

  it("replaces one adjacent straight-segment corner inside the same polyline", () => {
    const result = chamferCadPolylineSegmentPair(
      rectangle, 0, { x: 80, y: 0 }, 1, { x: 100, y: 20 },
      { method: "distance", firstDistance: 10, secondDistance: 20 }, "trim",
    );
    expect(result.reason).toBeNull();
    expect(result.line).toBeNull();
    expect(result.joinedPolyline).toEqual({
      ...rectangle,
      vertices: [{ x: 0, y: 0 }, { x: 90, y: 0 }, { x: 100, y: 20 }, { x: 100, y: 100 }, { x: 0, y: 100 }],
    });
  });

  it("chamfers the closed seam in both selection orders without changing handle or draw order", () => {
    const seamForward = chamferCadPolylineSegmentPair(
      rectangle, 3, { x: 0, y: 20 }, 0, { x: 20, y: 0 },
      { method: "distance", firstDistance: 10, secondDistance: 20 }, "trim",
    );
    expect(seamForward.joinedPolyline).toEqual({
      ...rectangle,
      vertices: [{ x: 20, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }, { x: 0, y: 10 }],
    });

    const seamReverse = chamferCadPolylineSegmentPair(
      rectangle, 0, { x: 20, y: 0 }, 3, { x: 0, y: 20 },
      { method: "distance", firstDistance: 10, secondDistance: 20 }, "trim",
    );
    expect(seamReverse.joinedPolyline).toEqual({
      ...rectangle,
      vertices: [{ x: 10, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }, { x: 0, y: 20 }],
    });
  });

  it("keeps an already-sharp adjacent or seam pair byte-for-byte identical at zero distance", () => {
    const adjacent = chamferCadPolylineSegmentPair(
      rectangle, 0, { x: 80, y: 0 }, 1, { x: 100, y: 20 },
      { method: "distance", firstDistance: 0, secondDistance: 0 }, "trim",
    );
    const seam = chamferCadPolylineSegmentPair(
      rectangle, 3, { x: 0, y: 20 }, 0, { x: 20, y: 0 },
      { method: "distance", firstDistance: 0, secondDistance: 0 }, "trim",
    );
    expect(adjacent).toMatchObject({ reason: null, line: null, joinedPolyline: rectangle });
    expect(seam).toMatchObject({ reason: null, line: null, joinedPolyline: rectangle });
    expect(adjacent.joinedPolyline?.vertices).toHaveLength(4);
    expect(seam.joinedPolyline?.vertices).toHaveLength(4);
  });

  it("rejects oversized Trim setbacks on every selected polyline-segment path without reversing a segment", () => {
    const short: CadPolyline = {
      ...rectangle,
      handle: "40",
      vertices: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }, { x: 0, y: 5 }],
    };
    const otherShort: CadPolyline = {
      ...short,
      handle: "50",
      vertices: [{ x: 5, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 }, { x: 5, y: 5 }],
    };
    const standalone: CadLine = { kind: "line", handle: "60", layerId: "0", start: { x: 5, y: 0 }, end: { x: 5, y: 100 } };
    const specification = { method: "distance", firstDistance: 10, secondDistance: 10 } as const;

    expect(chamferCadPolylineSegmentPair(short, 0, { x: 2, y: 0 }, 1, { x: 5, y: 2 }, specification, "trim"))
      .toEqual(expect.objectContaining({ reason: "distance-too-large", firstEntity: null, secondEntity: null }));
    expect(chamferCadPolylineSegmentWithEntity(short, 0, { x: 2, y: 0 }, standalone, { x: 5, y: 20 }, specification, "trim", true))
      .toEqual(expect.objectContaining({ reason: "distance-too-large", firstEntity: null, secondEntity: null }));
    expect(chamferCadPolylineSegments(short, 0, { x: 2, y: 0 }, otherShort, 3, { x: 5, y: 2 }, specification, "trim"))
      .toEqual(expect.objectContaining({ reason: "distance-too-large", firstEntity: null, secondEntity: null }));

    const noTrim = chamferCadPolylineSegmentPair(short, 0, { x: 2, y: 0 }, 1, { x: 5, y: 2 }, specification, "no-trim");
    expect(noTrim).toMatchObject({ reason: null, firstEntity: short, secondEntity: null, line: { start: { x: -5, y: 0 }, end: { x: 5, y: 10 } } });
  });

  it("turns an oversized selected-polyline Trim into a fail-closed command rejection", () => {
    const short: CadPolyline = {
      ...rectangle,
      handle: "40",
      vertices: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }, { x: 0, y: 5 }],
    };
    const document = createEmptyDocument({ documentId: "chamfer-polyline-distance-too-large" });
    document.entities.push(short);
    const result = executeChamfer(document, {
      mode: "pairs", specification: { method: "distance", firstDistance: 10, secondDistance: 10 }, trimMode: "trim",
      pairs: [{ firstHandle: "40", firstSegment: 0, firstPickPoint: { x: 2, y: 0 }, secondHandle: "40", secondSegment: 1, secondPickPoint: { x: 5, y: 2 } }],
    });
    expect(result).toMatchObject({ changes: [], sourceHandles: [], resultHandles: [], createdHandles: [], steps: [], rejected: [{ sourceIndex: 0, handles: ["40", "40"], reason: "distance-too-large" }] });
    expect(document.entities).toEqual([short]);
  });

  it("replaces one intervening segment and closes start/end segments of an open polyline", () => {
    const withMiddle: CadPolyline = {
      ...rectangle, closed: false,
      vertices: [{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 100, y: 20 }, { x: 100, y: 100 }, { x: 150, y: 100 }],
    };
    const separated = chamferCadPolylineSegmentPair(
      withMiddle, 0, { x: 50, y: 0 }, 2, { x: 100, y: 60 },
      { method: "distance", firstDistance: 20, secondDistance: 20 }, "trim",
    );
    expect(separated.joinedPolyline?.vertices).toEqual([{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 100, y: 20 }, { x: 100, y: 100 }, { x: 150, y: 100 }]);

    const openCorner: CadPolyline = {
      ...rectangle, closed: false,
      vertices: [{ x: 0, y: 50 }, { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 50 }],
    };
    const closed = chamferCadPolylineSegmentPair(
      openCorner, 0, { x: 0, y: 20 }, 2, { x: 70, y: 30 },
      { method: "distance", firstDistance: 10, secondDistance: 10 }, "trim",
    );
    expect(closed.joinedPolyline?.closed).toBe(true);
    expect(closed.joinedPolyline?.vertices).toEqual([{ x: 0, y: 90 }, { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 7.071067811865, y: 92.928932188135 }]);
  });

  it("chamfers every eligible Polyline vertex, skips short corners and supports No Trim", () => {
    const trimmed = chamferCadPolyline(rectangle, { method: "distance", firstDistance: 10, secondDistance: 10 }, "trim");
    expect(trimmed).toMatchObject({ chamferCount: 4, skippedVertices: [], reason: null, lines: [] });
    expect(trimmed.entity?.vertices).toEqual([
      { x: 10, y: 0 }, { x: 90, y: 0 }, { x: 100, y: 10 }, { x: 100, y: 90 },
      { x: 90, y: 100 }, { x: 10, y: 100 }, { x: 0, y: 90 }, { x: 0, y: 10 },
    ]);
    const noTrim = chamferCadPolyline(rectangle, { method: "distance", firstDistance: 10, secondDistance: 10 }, "no-trim");
    expect(noTrim.entity).toEqual(rectangle);
    expect(noTrim.lines).toHaveLength(4);

    const short = chamferCadPolyline({ ...rectangle, vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 100 }, { x: 0, y: 100 }] }, { method: "distance", firstDistance: 20, secondDistance: 20 }, "trim");
    expect(short.chamferCount).toBeLessThan(4);
    expect(short.skippedVertices.length).toBeGreaterThan(0);

    const overlapRectangle = { ...rectangle, vertices: [{ x: 0, y: 0 }, { x: 25, y: 0 }, { x: 25, y: 25 }, { x: 0, y: 25 }] };
    const overlap = chamferCadPolyline(overlapRectangle, { method: "distance", firstDistance: 20, secondDistance: 20 }, "trim");
    expect(overlap).toMatchObject({ chamferCount: 2, skippedVertices: [0, 2], reason: null, lines: [] });
    expect(overlap.entity?.vertices).toEqual([
      { x: 0, y: 0 }, { x: 5, y: 0 }, { x: 25, y: 20 }, { x: 25, y: 25 }, { x: 20, y: 25 }, { x: 0, y: 5 },
    ]);
    const overlapNoTrim = chamferCadPolyline(overlapRectangle, { method: "distance", firstDistance: 20, secondDistance: 20 }, "no-trim");
    expect(overlapNoTrim).toMatchObject({ entity: overlapRectangle, chamferCount: 4, skippedVertices: [] });
    expect(overlapNoTrim.lines).toHaveLength(4);
    const shortNoTrim = chamferCadPolyline({ ...overlapRectangle, vertices: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }, { x: 0, y: 5 }] }, { method: "distance", firstDistance: 10, secondDistance: 10 }, "no-trim");
    expect(shortNoTrim).toMatchObject({ chamferCount: 4, skippedVertices: [] });
    expect(shortNoTrim.lines).toHaveLength(4);
  });

  it("treats zero-distance Polyline corners as identity without duplicate or zero-length segments", () => {
    const zero = chamferCadPolyline(rectangle, { method: "distance", firstDistance: 0, secondDistance: 0 }, "trim");
    expect(zero).toMatchObject({ entity: rectangle, chamferCount: 4, skippedVertices: [], lines: [], reason: null });
    expect(zero.entity?.vertices).toHaveLength(4);
    const vertices = zero.entity!.vertices;
    for (let index = 0; index < vertices.length; index += 1) {
      const next = vertices[(index + 1) % vertices.length]!;
      expect(Math.hypot(next.x - vertices[index]!.x, next.y - vertices[index]!.y)).toBeGreaterThan(0);
    }
  });

  it("trims a selected terminal polyline segment with a separate line while preserving the handle", () => {
    const open: CadPolyline = { ...rectangle, closed: false, vertices: [{ x: -100, y: 0 }, { x: 0, y: 0 }] };
    const result = chamferCadPolylineSegmentWithEntity(
      open, 0, { x: -50, y: 0 }, vertical, { x: 0, y: 50 },
      { method: "distance", firstDistance: 10, secondDistance: 20 }, "trim", true,
    );
    expect(result.firstEntity).toMatchObject({ kind: "polyline", handle: "30", vertices: [{ x: -100, y: 0 }, { x: -10, y: 0 }] });
    expect(result.secondEntity).toMatchObject({ kind: "line", start: { x: 0, y: 20 } });
    expect(result.line).toEqual({ kind: "line", start: { x: -10, y: 0 }, end: { x: 0, y: 20 } });
  });
});
