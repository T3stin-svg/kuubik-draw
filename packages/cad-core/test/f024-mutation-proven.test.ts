import { describe, expect, it } from "vitest";
import { CadSession, createEmptyDocument, executeFillet, filletCadEntityPair, filletCadPolyline, filletCadPolylineSegmentPair } from "../src/index.js";

const first = { kind: "line" as const, handle: "10", layerId: "0", appearance: { color: "#09f" }, extensionData: { rowId: "F-024" }, start: { x: -100, y: 0 }, end: { x: 0, y: 0 } };
const second = { kind: "line" as const, handle: "20", layerId: "0", start: { x: 0, y: 0 }, end: { x: 0, y: 100 } };

describe("F-024 mutation-proven FILLET ratchet", () => {
  it("kills pick-quadrant, tangent, radius, direction, property-loss and source-mutation mutants", () => {
    const beforeFirst = structuredClone(first); const beforeSecond = structuredClone(second);
    expect(filletCadEntityPair(first, { x: -50, y: 0 }, second, { x: 0, y: 50 }, 10)).toMatchObject({
      reason: null, center: { x: -10, y: 10 }, effectiveRadius: 10,
      tangentPoints: [{ x: -10, y: 0 }, { x: 0, y: 10 }],
      firstEntity: { end: { x: -10, y: 0 }, appearance: { color: "#09f" }, extensionData: { rowId: "F-024" } },
      secondEntity: { start: { x: 0, y: 10 } },
      arc: { radius: 10, counterClockwise: true },
    });
    expect(first).toEqual(beforeFirst); expect(second).toEqual(beforeSecond);
  });

  it("kills zero-radius, No Trim and parallel-radius mutants", () => {
    expect(filletCadEntityPair({ ...first, end: { x: -10, y: 0 } }, { x: -50, y: 0 }, { ...second, start: { x: 0, y: 10 } }, { x: 0, y: 50 }, 0)).toMatchObject({
      arc: null, firstEntity: { end: { x: 0, y: 0 } }, secondEntity: { start: { x: 0, y: 0 } }, effectiveRadius: 0,
    });
    expect(filletCadEntityPair(first, { x: -50, y: 0 }, second, { x: 0, y: 50 }, 10, "no-trim")).toMatchObject({ firstEntity: first, secondEntity: second, arc: { radius: 10 } });
    const parallel = { ...first, handle: "20", start: { x: -100, y: 20 }, end: { x: 0, y: 20 } };
    expect(filletCadEntityPair(first, { x: -40, y: 0 }, parallel, { x: -40, y: 20 }, 999)).toMatchObject({ effectiveRadius: 10, center: { x: -40, y: 10 } });
  });

  it("kills picked-ray, parallel-cap-direction and radius-larger-than-circle mutants", () => {
    expect(filletCadEntityPair(first, { x: -9, y: 0 }, second, { x: 0, y: 9 }, 10)).toMatchObject({
      firstEntity: { start: { x: -100, y: 0 }, end: { x: -10, y: 0 } },
      secondEntity: { start: { x: 0, y: 10 }, end: { x: 0, y: 100 } },
    });
    const capFirst = { ...first, start: { x: 0, y: 0 }, end: { x: 100, y: 0 } };
    const capSecond = { ...second, start: { x: 0, y: 20 }, end: { x: 100, y: 20 } };
    expect(filletCadEntityPair(capFirst, { x: 1, y: 0 }, capSecond, { x: 1, y: 20 }, 500)).toMatchObject({ arc: { counterClockwise: false } });
    expect(filletCadEntityPair(capFirst, { x: 99, y: 0 }, capSecond, { x: 99, y: 20 }, 500)).toMatchObject({ arc: { counterClockwise: true } });

    const line = { ...first, start: { x: -100, y: 0 }, end: { x: 100, y: 0 } };
    const circle = { kind: "circle" as const, handle: "30", layerId: "0", center: { x: 0, y: 20 }, radius: 5 };
    expect(filletCadEntityPair(line, { x: 15, y: 0 }, circle, { x: -5, y: 20 }, 20, "no-trim")).toMatchObject({
      center: { x: 15, y: 20 }, tangentPoints: [{ x: 15, y: 0 }, { x: -5, y: 20 }], arc: { radius: 20 },
    });
  });

  it("kills ellipse/spline rejection, numeric-offset, closed-curve trim and NURBS-property mutants", () => {
    const ellipse = { kind: "ellipse" as const, handle: "20", layerId: "0", center: { x: 100, y: 0 }, majorAxis: { x: 100, y: 0 }, ratio: 0.5, startParameter: 0, endParameter: Math.PI * 2 };
    const ellipseResult = filletCadEntityPair({ ...first, start: { x: -200, y: 0 } }, { x: -20, y: 0 }, ellipse, { x: 2, y: 10 }, 10);
    expect(ellipseResult.reason).toBeNull();
    expect(ellipseResult.firstEntity).toMatchObject({ kind: "line", end: { x: expect.closeTo(-8.55777007055, 5), y: 0 } });
    expect(ellipseResult.secondEntity).toEqual(ellipse);
    expect(ellipseResult.center).toEqual({ x: expect.closeTo(-8.55777007055, 5), y: expect.closeTo(10, 7) });

    const spline = {
      kind: "spline" as const, handle: "40", layerId: "0", degree: 3,
      controlPoints: [{ x: 300, y: 200 }, { x: 300, y: 240 }, { x: 360, y: 260 }, { x: 400, y: 300 }],
      knots: [0, 0, 0, 0, 1, 1, 1, 1], weights: [1, 2, 3, 4], closed: false, periodic: false,
    };
    const line = { kind: "line" as const, handle: "30", layerId: "0", start: { x: 100, y: 200 }, end: { x: 300, y: 200 } };
    const splineResult = filletCadEntityPair(line, { x: 280, y: 200 }, spline, { x: 302, y: 210 }, 10);
    expect(splineResult.reason).toBeNull();
    expect(splineResult.firstEntity).toMatchObject({ kind: "line", end: { x: expect.closeTo(290.843943859683, 6), y: 200 } });
    expect(splineResult.secondEntity).toMatchObject({ kind: "spline", weights: expect.any(Array) });
    expect(new Set(splineResult.secondEntity.kind === "spline" ? splineResult.secondEntity.weights : []).size).toBeGreaterThan(1);
    expect(splineResult.secondEntity?.kind === "spline" ? splineResult.secondEntity.controlPoints[0] : null).toEqual({
      x: expect.closeTo(300.695133809593, 6),
      y: expect.closeTo(208.281263088522, 6),
    });
    expect(splineResult.arc).toMatchObject({ radius: 10, center: { x: expect.closeTo(290.843943859683, 6), y: expect.closeTo(210, 6) } });
  });

  it("kills RAY/XLINE support, normalization, Trim conversion and No Trim mutation mutants", () => {
    const ray = {
      kind: "ray" as const, handle: "10", layerId: "0", basePoint: { x: 0, y: 0 }, direction: { x: 40, y: 0 },
      appearance: { aciIndex: 1, colorMethod: "aci" as const, color: "#ff0000", lineweightMm: 0.5 },
    };
    const xline = {
      kind: "xline" as const, handle: "20", layerId: "0", basePoint: { x: 100, y: 10 }, direction: { x: 0, y: 30 },
      appearance: { aciIndex: 1, colorMethod: "aci" as const, color: "#ff0000", lineweightMm: 0.5 },
    };
    expect(filletCadEntityPair(ray, { x: 80, y: 0 }, xline, { x: 100, y: 20 }, 10, "trim")).toMatchObject({
      reason: null,
      center: { x: 90, y: 10 },
      tangentPoints: [{ x: 90, y: 0 }, { x: 100, y: 10 }],
      firstEntity: { kind: "line", handle: "10", start: { x: 0, y: 0 }, end: { x: 90, y: 0 }, appearance: ray.appearance },
      secondEntity: { kind: "ray", handle: "20", basePoint: { x: 100, y: 10 }, direction: { x: 0, y: 1 }, appearance: xline.appearance },
      arc: { radius: 10 },
    });
    expect(filletCadEntityPair(ray, { x: 80, y: 0 }, xline, { x: 100, y: 20 }, 10, "no-trim")).toMatchObject({
      firstEntity: ray, secondEntity: xline, arc: { radius: 10 },
    });

    const document = createEmptyDocument({ documentId: "F-024-construction-mutation" });
    document.entities.push(ray, xline);
    const result = executeFillet(document, {
      mode: "pairs", radius: 10, trimMode: "trim",
      pairs: [{ firstHandle: "10", firstPickPoint: { x: 80, y: 0 }, secondHandle: "20", secondPickPoint: { x: 100, y: 20 } }],
    });
    expect(result).toMatchObject({ sourceHandles: ["10", "20"], resultHandles: ["10", "20", "21"], createdHandles: ["21"], rejected: [] });
    expect(result.changes).toEqual([
      { type: "put", entity: expect.objectContaining({ kind: "line", handle: "10", end: { x: 90, y: 0 } }) },
      { type: "put", entity: expect.objectContaining({ kind: "ray", handle: "20", basePoint: { x: 100, y: 10 }, direction: { x: 0, y: 1 } }) },
      { type: "put", entity: expect.objectContaining({ kind: "arc", handle: "21", appearance: { aciIndex: 1, colorMethod: "aci", color: "#ff0000" } }) },
    ]);
  });

  it("kills the Shift second-object radius override without changing the stored command radius", () => {
    const document = createEmptyDocument({ documentId: "F-024-shift" });
    document.entities.push({ ...first, end: { x: -10, y: 0 } }, { ...second, start: { x: 0, y: 10 } });
    const result = executeFillet(document, {
      mode: "pairs",
      radius: 25,
      trimMode: "trim",
      pairs: [{ firstHandle: "10", firstPickPoint: { x: -50, y: 0 }, secondHandle: "20", secondPickPoint: { x: 0, y: 50 }, radiusOverride: 0 }],
    });
    expect(result).toMatchObject({ radius: 25, createdHandles: [], steps: [{ effectiveRadius: 0, tangentPoints: [{ x: 0, y: 0 }, { x: 0, y: 0 }] }] });
    expect(result.changes).toEqual([
      { type: "put", entity: expect.objectContaining({ handle: "10", end: { x: 0, y: 0 } }) },
      { type: "put", entity: expect.objectContaining({ handle: "20", start: { x: 0, y: 0 } }) },
    ]);
  });

  it("kills hidden/frozen rejection and locked-layer bypass mutants", () => {
    const document = createEmptyDocument({ documentId: "F-024-layer-contract" });
    document.layers.push(
      { id: "locked", name: "LOCKED", visible: true, frozen: false, locked: true, plottable: true },
      { id: "off", name: "OFF", visible: false, frozen: false, locked: false, plottable: true },
      { id: "frozen", name: "FROZEN", visible: true, frozen: true, locked: false, plottable: true },
    );
    document.entities.push(
      { ...first, layerId: "locked" }, { ...second, layerId: "locked" },
      { ...first, handle: "30", layerId: "off", start: { x: 200, y: 0 }, end: { x: 300, y: 0 } },
      { ...second, handle: "40", layerId: "off", start: { x: 300, y: 0 }, end: { x: 300, y: 100 } },
      { ...first, handle: "50", layerId: "frozen", start: { x: 400, y: 0 }, end: { x: 500, y: 0 } },
      { ...second, handle: "60", layerId: "frozen", start: { x: 500, y: 0 }, end: { x: 500, y: 100 } },
    );
    const result = executeFillet(document, {
      mode: "pairs", radius: 10, trimMode: "trim", multiple: true,
      pairs: [
        { firstHandle: "10", firstPickPoint: { x: -50, y: 0 }, secondHandle: "20", secondPickPoint: { x: 0, y: 50 } },
        { firstHandle: "30", firstPickPoint: { x: 280, y: 0 }, secondHandle: "40", secondPickPoint: { x: 300, y: 20 } },
        { firstHandle: "50", firstPickPoint: { x: 480, y: 0 }, secondHandle: "60", secondPickPoint: { x: 500, y: 20 } },
      ],
    });
    expect(result.rejected).toEqual([{ sourceIndex: 0, handles: ["10", "20"], reason: "locked-layer" }]);
    expect(result.sourceHandles).toEqual(["30", "40", "50", "60"]);
    expect(result.resultHandles).toEqual(["30", "40", "61", "50", "60", "62"]);
  });

  it("kills created-arc layer, color and lineweight inheritance mutants", () => {
    const appearance = { color: "#ff0000", colorMethod: "aci" as const, aciIndex: 1, lineweightMm: 0.5 };
    const document = createEmptyDocument({ documentId: "F-024-appearance-mutation" });
    document.layers.push(
      { id: "a", name: "A", visible: true, frozen: false, locked: false, plottable: true },
      { id: "b", name: "B", visible: true, frozen: false, locked: false, plottable: true },
      { id: "current", name: "CURRENT", visible: true, frozen: false, locked: false, plottable: true },
    );
    document.currentLayerId = "current";
    document.entities.push(
      { ...first, layerId: "a", appearance },
      { ...second, layerId: "b", appearance },
      { ...first, handle: "30", layerId: "a", appearance, start: { x: 200, y: 0 }, end: { x: 400, y: 0 } },
      { kind: "ellipse", handle: "40", layerId: "a", appearance, center: { x: 500, y: 0 }, majorAxis: { x: 100, y: 0 }, ratio: 0.5, startParameter: 0, endParameter: Math.PI * 2 },
    );
    const result = executeFillet(document, { mode: "pairs", radius: 10, trimMode: "no-trim", multiple: true, pairs: [
      { firstHandle: "10", firstPickPoint: { x: -50, y: 0 }, secondHandle: "20", secondPickPoint: { x: 0, y: 50 } },
      { firstHandle: "30", firstPickPoint: { x: 380, y: 0 }, secondHandle: "40", secondPickPoint: { x: 402, y: 10 } },
    ] });
    const arcs = result.changes.filter((change) => change.type === "put" && change.entity.kind === "arc").map((change) => change.entity);
    expect(arcs).toEqual([
      expect.objectContaining({ handle: "41", layerId: "current", appearance: { lineweightMm: 0.5 } }),
      expect.objectContaining({ handle: "42", layerId: "a", appearance: { color: "#ff0000", colorMethod: "aci", aciIndex: 1 } }),
    ]);
  });

  it("kills Polyline all-corners, bulge-sign, short-segment and width-loss mutants", () => {
    const rectangle = { kind: "polyline" as const, handle: "10", layerId: "0", closed: true, vertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }, { x: 0, y: 50 }] };
    const rounded = filletCadPolyline(rectangle, 10);
    expect(rounded).toMatchObject({ reason: null, filletCount: 4, skippedVertices: [] });
    expect(rounded.entity?.vertices).toHaveLength(8);
    expect(rounded.entity?.vertices.filter((vertex) => (vertex.bulge ?? 0) > 0)).toHaveLength(4);
    const tooShort = { ...rectangle, closed: false, vertices: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }] };
    expect(filletCadPolyline(tooShort, 10)).toMatchObject({ entity: null, reason: "radius-too-large", skippedVertices: [1] });
    const widthSource = { ...rectangle, vertices: [{ x: 0, y: 0, startWidth: 2, endWidth: 4 }, ...rectangle.vertices.slice(1)] };
    const widthResult = filletCadPolyline(widthSource, 10);
    expect(widthResult.reason).toBeNull();
    expect(widthResult.entity?.vertices.some((vertex) => vertex.startWidth !== undefined || vertex.endWidth !== undefined)).toBe(true);
  });

  it("kills segment-order, intervening-arc, FILLETPOLYARC, No Trim and exact-width mutants", () => {
    const source = {
      kind: "polyline" as const, handle: "10", layerId: "0", closed: true,
      vertices: [{ x: 0, y: 0, startWidth: 2, endWidth: 4 }, { x: 100, y: 0, startWidth: 4, endWidth: 6 }, { x: 100, y: 100 }, { x: 0, y: 100 }],
    };
    const forward = filletCadPolylineSegmentPair(source, 0, { x: 80, y: 0 }, 1, { x: 100, y: 20 }, 10, "trim");
    const reverse = filletCadPolylineSegmentPair(source, 1, { x: 100, y: 20 }, 0, { x: 80, y: 0 }, 10, "trim");
    expect(reverse.firstEntity).toEqual(forward.firstEntity);
    expect(forward.firstEntity?.kind === "polyline" ? forward.firstEntity.vertices.slice(0, 3) : []).toEqual([
      { x: 0, y: 0, startWidth: 2, endWidth: 3.8 },
      { x: 90, y: 0, bulge: 0.414213562373, startWidth: 3.8, endWidth: 4.2 },
      { x: 100, y: 10, startWidth: 4.2, endWidth: 6 },
    ]);
    expect(filletCadPolylineSegmentPair(source, 0, { x: 80, y: 0 }, 1, { x: 100, y: 20 }, 10, "no-trim")).toMatchObject({ firstEntity: source, arc: { radius: 10 } });

    const withArc = {
      kind: "polyline" as const, handle: "20", layerId: "0", closed: true,
      vertices: [{ x: 0, y: 0 }, { x: 100, y: 0, bulge: Math.tan(Math.PI / 8) }, { x: 150, y: 50 }, { x: 150, y: 150 }, { x: 0, y: 150 }],
    };
    expect(filletCadPolylineSegmentPair(withArc, 0, { x: 80, y: 0 }, 2, { x: 150, y: 70 }, 0, "trim").firstEntity).toMatchObject({
      vertices: [{ x: 0, y: 0 }, { x: 150, y: 0 }, { x: 150, y: 150 }, { x: 0, y: 150 }],
    });
    expect(filletCadPolyline(withArc, 0, { filletPolylineArc: 0 })).toMatchObject({
      filletCount: 1, entity: { vertices: [{ x: 0, y: 0 }, { x: 150, y: 0 }, { x: 150, y: 150 }, { x: 0, y: 150 }] },
    });
    const mixed = { ...withArc, closed: false, vertices: [...withArc.vertices, { x: -50, y: 150 }] };
    const current = filletCadPolyline(mixed, 10, { filletPolylineArc: 1 });
    const legacy = filletCadPolyline(mixed, 10, { filletPolylineArc: 0 });
    expect(current.entity?.vertices).not.toEqual(legacy.entity?.vertices);
    expect(current.entity?.vertices.filter((vertex) => Math.abs(vertex.bulge ?? 0) > 0)).toHaveLength(3);
  });

  it("kills split-Multiple, unstable-handle and one-sided atomic Undo/Redo mutants", () => {
    const document = createEmptyDocument({ documentId: "F-024-mutation" });
    document.entities.push(first, second, { ...first, handle: "30", start: { x: 100, y: 0 }, end: { x: 200, y: 0 } }, { ...second, handle: "40", start: { x: 100, y: 0 }, end: { x: 100, y: 100 } });
    const source = structuredClone(document.entities);
    const result = executeFillet(document, { mode: "pairs", radius: 10, trimMode: "trim", pairs: [
      { firstHandle: "10", firstPickPoint: { x: -50, y: 0 }, secondHandle: "20", secondPickPoint: { x: 0, y: 50 } },
      { firstHandle: "30", firstPickPoint: { x: 150, y: 0 }, secondHandle: "40", secondPickPoint: { x: 100, y: 50 } },
    ] });
    expect(result).toMatchObject({ createdHandles: ["41", "42"], multiple: true, rejected: [] });
    const session = new CadSession(document);
    session.commit({ opId: "F-024-mutation", baseRevision: 0, commandId: "FILLET", args: {}, targetHandles: result.sourceHandles, resultHandles: result.resultHandles }, result.changes);
    const committed = structuredClone(session.document.entities);
    expect(committed.map((entity) => entity.handle)).toEqual(["10", "20", "30", "40", "41", "42"]);
    expect(session.undo()).not.toBeNull(); expect(session.document.entities).toEqual(source);
    expect(session.redo()).not.toBeNull(); expect(session.document.entities).toEqual(committed);
  });
});
