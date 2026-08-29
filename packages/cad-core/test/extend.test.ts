import { describe, expect, it } from "vitest";
import type { CadLine, CadSpline } from "@kuubik/cad-schema";
import { CadCommandInputError, CadSession, createEmptyDocument, executeExtend, extendCadEntity, parseExtendTargetPicks, resolveCadCommand } from "../src/index.js";

const vertical = (handle: string, x: number, y1 = -100, y2 = 100): CadLine => ({
  kind: "line", handle, layerId: "0", start: { x, y: y1 }, end: { x, y: y2 },
});

describe("F-023 standalone EXTEND command", () => {
  it("registers EX/EXTEND and parses deterministic target picks", () => {
    expect(resolveCadCommand("ex")?.id).toBe("EXTEND");
    expect(resolveCadCommand(" EXTEND ")?.id).toBe("EXTEND");
    expect(parseExtendTargetPicks("10@80,0; 11@0,20")).toEqual([
      { handle: "10", pickPoint: { x: 80, y: 0 }, action: "extend" },
      { handle: "11", pickPoint: { x: 0, y: 20 }, action: "extend" },
    ]);
    expect(parseExtendTargetPicks("10@50,0", "trim")).toEqual([
      { handle: "10", pickPoint: { x: 50, y: 0 }, action: "trim" },
    ]);
    expect(() => parseExtendTargetPicks("10,80,0")).toThrow(CadCommandInputError);
  });

  it("extends ordered targets in Standard mode as one atomic operation and supports command-local Undo", () => {
    const document = createEmptyDocument({ documentId: "f023-standard" });
    document.entities.push(
      { kind: "line", handle: "10", layerId: "0", start: { x: 20, y: 0 }, end: { x: 80, y: 0 }, appearance: { color: "#f00" }, extensionData: { rowId: "F-023" } },
      { kind: "line", handle: "11", layerId: "0", start: { x: 20, y: 20 }, end: { x: 80, y: 20 } },
      vertical("20", 100),
    );
    const args = {
      mode: "standard" as const,
      boundaryEdgeHandles: ["20"],
      targets: [
        { handle: "10", pickPoint: { x: 80, y: 0 } },
        { handle: "11", pickPoint: { x: 80, y: 20 } },
      ],
      edgeMode: "no-extend" as const,
      projectMode: "none" as const,
    };
    const result = executeExtend(document, args);
    expect(result).toMatchObject({
      rejected: [],
      targetHandles: ["10", "11"],
      resultHandles: ["10", "11"],
      steps: [
        { action: "extend", sourceHandle: "10", intersectionPoints: [{ x: 100, y: 0 }] },
        { action: "extend", sourceHandle: "11", intersectionPoints: [{ x: 100, y: 20 }] },
      ],
      changes: [
        { type: "put", entity: { handle: "10", end: { x: 100, y: 0 }, appearance: { color: "#f00" }, extensionData: { rowId: "F-023" } } },
        { type: "put", entity: { handle: "11", end: { x: 100, y: 20 } } },
      ],
    });
    const locallyUndone = executeExtend(document, { ...args, targets: args.targets.slice(0, -1) });
    expect(locallyUndone.steps).toHaveLength(1);
    expect(document.entities.find((entity) => entity.handle === "10")).toMatchObject({ end: { x: 80, y: 0 } });

    const session = new CadSession(document);
    session.commit({ opId: "F-023", baseRevision: 0, commandId: "EXTEND", args, targetHandles: result.targetHandles, resultHandles: result.resultHandles }, result.changes);
    expect(session.document.entities.find((entity) => entity.handle === "10")).toMatchObject({ end: { x: 100, y: 0 } });
    const committedEntities = structuredClone(session.document.entities);
    expect(session.undo()).not.toBeNull();
    expect(session.document.entities).toEqual(document.entities);
    expect(session.redo()).not.toBeNull();
    expect(session.document.revision).toBe(3);
    expect(session.document.entities).toEqual(committedEntities);
  });

  it("uses all visible objects in Quick mode, never erases an unextendable target, and maps Shift-select to TRIM", () => {
    const document = createEmptyDocument({ documentId: "f023-quick" });
    document.entities.push(
      { kind: "line", handle: "10", layerId: "0", start: { x: 20, y: 0 }, end: { x: 80, y: 0 } },
      vertical("20", 100),
    );
    expect(executeExtend(document, {
      mode: "quick", boundaryEdgeHandles: [], targets: [{ handle: "10", pickPoint: { x: 80, y: 0 } }], edgeMode: "no-extend", projectMode: "view",
    })).toMatchObject({ changes: [{ type: "put", entity: { handle: "10", end: { x: 100, y: 0 } } }], rejected: [] });

    const isolated = createEmptyDocument({ documentId: "f023-isolated" });
    isolated.entities.push({ kind: "line", handle: "10", layerId: "0", start: { x: 0, y: 0 }, end: { x: 10, y: 0 } });
    expect(executeExtend(isolated, {
      mode: "quick", boundaryEdgeHandles: [], targets: [{ handle: "10", pickPoint: { x: 10, y: 0 } }], edgeMode: "no-extend", projectMode: "none",
    })).toMatchObject({ changes: [], rejected: [{ handle: "10", reason: "no-intersection" }] });

    const trimming = createEmptyDocument({ documentId: "f023-shift-trim" });
    trimming.entities.push(
      { kind: "line", handle: "10", layerId: "0", start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
      vertical("20", 50),
    );
    expect(executeExtend(trimming, {
      mode: "standard", boundaryEdgeHandles: ["20"], targets: [{ handle: "10", pickPoint: { x: 75, y: 0 }, action: "trim" }], edgeMode: "no-extend", projectMode: "ucs",
    })).toMatchObject({ steps: [{ action: "trim" }], changes: [{ type: "put", entity: { handle: "10", end: { x: 50, y: 0 } } }] });
  });

  it("honors Edge Extend and rejects locked, hidden and closed targets without mutation", () => {
    const document = createEmptyDocument({ documentId: "f023-options" });
    document.layers.push(
      { id: "locked", name: "LOCKED", visible: true, frozen: false, locked: true, plottable: true },
      { id: "hidden", name: "HIDDEN", visible: false, frozen: false, locked: false, plottable: true },
    );
    document.entities.push(
      { kind: "line", handle: "10", layerId: "0", start: { x: 20, y: 0 }, end: { x: 80, y: 0 } },
      { kind: "line", handle: "11", layerId: "locked", start: { x: 20, y: 20 }, end: { x: 80, y: 20 } },
      { kind: "line", handle: "12", layerId: "hidden", start: { x: 20, y: 40 }, end: { x: 80, y: 40 } },
      { kind: "circle", handle: "13", layerId: "0", center: { x: 40, y: 60 }, radius: 10 },
      vertical("20", 100, 10, 30),
    );
    const common = { mode: "standard" as const, boundaryEdgeHandles: ["20"], targets: [{ handle: "10", pickPoint: { x: 80, y: 0 } }], projectMode: "none" as const };
    expect(executeExtend(document, { ...common, edgeMode: "no-extend" })).toMatchObject({ changes: [], rejected: [{ reason: "no-intersection" }] });
    expect(executeExtend(document, { ...common, edgeMode: "extend" })).toMatchObject({ changes: [{ type: "put", entity: { handle: "10", end: { x: 100, y: 0 } } }] });
    const before = structuredClone(document);
    expect(executeExtend(document, {
      mode: "standard", boundaryEdgeHandles: ["20"], edgeMode: "extend", projectMode: "none",
      targets: [
        { handle: "missing", pickPoint: { x: 0, y: 0 } },
        { handle: "11", pickPoint: { x: 80, y: 20 } },
        { handle: "12", pickPoint: { x: 80, y: 40 } },
        { handle: "13", pickPoint: { x: 50, y: 60 } },
      ],
    })).toMatchObject({ changes: [], rejected: [
      { reason: "missing" }, { reason: "locked-layer" }, { reason: "hidden-layer" }, { reason: "unsupported-target" },
    ] });
    expect(document).toEqual(before);
  });

  it("extends both endpoints of an open cubic spline with AutoCAD 2024 C2 endpoint spans", () => {
    const spline: CadSpline = {
      kind: "spline", handle: "10", layerId: "splines", degree: 3,
      controlPoints: [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 1 }, { x: 3, y: 0 }],
      knots: [0, 0, 0, 0, 1, 1, 1, 1], weights: [1, 1, 2, 2], closed: false, periodic: false,
      appearance: { color: "#0af" }, extensionData: { source: "F-023" },
    };
    const end = extendCadEntity(spline, { x: 3, y: 0 }, [vertical("20", 6, -10, 10)]);
    expect(end).toMatchObject({ endpoint: "end", intersectionPoint: { x: 6.000000000002, y: -3.567997608689 }, reason: null });
    expect(end.entity).toEqual({
      ...spline,
      controlPoints: [
        ...spline.controlPoints,
        { x: 3.621334927543, y: -0.621334927543 },
        { x: 4.628726947271, y: -1.821755493363 },
        { x: 6.000000000002, y: -3.567997608689 },
      ],
      knots: [0, 0, 0, 0, 1, 1, 1, 1.621334927543, 1.621334927543, 1.621334927543, 1.621334927543],
      weights: [1, 1, 2, 2, 2, 2, 2],
    });

    const start = extendCadEntity(spline, { x: 0, y: 0 }, [vertical("21", -0.2, -10, 10)]);
    expect(start).toMatchObject({ endpoint: "start", intersectionPoint: { x: -0.2, y: -0.237531375897 }, reason: null });
    expect(start.entity).toEqual({
      ...spline,
      controlPoints: [
        { x: -0.2, y: -0.237531375897 },
        { x: -0.145816216257, y: -0.158354250598 },
        { x: -0.079177125299, y: -0.079177125299 },
        ...spline.controlPoints,
      ],
      knots: [-0.079177125299, -0.079177125299, -0.079177125299, -0.079177125299, 0, 0, 0, 1, 1, 1, 1],
      weights: [1, 1, 1, ...spline.weights!],
    });
    expect(spline.controlPoints).toHaveLength(4);
  });

  it("matches the AutoCAD 2024 rational SPLINE distance and curvature probe matrix", () => {
    const createSpline = (controlPoints: CadSpline["controlPoints"], weights: number[]): CadSpline => ({
      kind: "spline", handle: "10", layerId: "0", degree: 3, controlPoints,
      knots: [0, 0, 0, 0, 1, 1, 1, 1], weights, closed: false, periodic: false,
    });
    const base = createSpline([{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 1 }, { x: 3, y: 0 }], [1, 1, 2, 2]);
    const distanceProbes = [
      [3.5, 1.145570855245, -0.531643717135],
      [4, 1.264134293208, -1.103798560189],
      [5, 1.458981943091, -2.311527085363],
      [6, 1.621334927543, -3.567997608689],
      [8, 1.892322516653, -6.161516225018],
      [10, 2.120713210194, -8.818930184704],
    ] as const;
    for (const [boundaryX, finalKnot, endY] of distanceProbes) {
      const result = extendCadEntity(base, { x: 3, y: 0 }, [vertical("20", boundaryX)]);
      expect(result.reason).toBeNull();
      expect(result.intersectionPoint?.x).toBeCloseTo(boundaryX, 9);
      expect(result.intersectionPoint?.y).toBeCloseTo(endY, 9);
      expect((result.entity as CadSpline).knots.at(-1)).toBeCloseTo(finalKnot, 9);
    }

    const shapeProbes = [
      {
        spline: createSpline(base.controlPoints, [1, 1, 1, 1]),
        controls: [{ x: 4, y: -1 }, { x: 5, y: -3 }, { x: 6, y: -5.833333333333 }], knot: 2,
      },
      {
        spline: createSpline(base.controlPoints, [1, 2, 3, 4]),
        controls: [
          { x: 4.111739571363, y: -1.111739571363 },
          { x: 5.086149712222, y: -3.184785156253 },
          { x: 5.999999999999, y: -5.681749712719 },
        ], knot: 2.482319428484,
      },
      {
        spline: createSpline([{ x: 0, y: 0 }, { x: 1, y: 2 }, { x: 2, y: -1 }, { x: 3, y: 0 }], [1, 1, 2, 2]),
        controls: [
          { x: 3.619904037091, y: 0.619904037091 },
          { x: 4.624089089384, y: 2.392651119787 },
          { x: 6, y: 5.280575777453 },
        ], knot: 1.619904037091,
      },
    ];
    for (const probe of shapeProbes) {
      const result = extendCadEntity(probe.spline, { x: 3, y: 0 }, [vertical("20", 6)]);
      const output = result.entity as CadSpline;
      expect(result.reason).toBeNull();
      output.controlPoints.slice(-3).forEach((point, index) => {
        expect(point.x).toBeCloseTo(probe.controls[index]!.x, 9);
        expect(point.y).toBeCloseTo(probe.controls[index]!.y, 9);
      });
      expect(output.knots.at(-1)).toBeCloseTo(probe.knot, 9);
    }
  });

  it("rejects closed, periodic, unclamped and zero-tangent splines without mutation", () => {
    const base: CadSpline = {
      kind: "spline", handle: "10", layerId: "0", degree: 3,
      controlPoints: [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 1 }, { x: 3, y: 0 }],
      knots: [0, 0, 0, 0, 1, 1, 1, 1], closed: false, periodic: false,
    };
    const boundary = [vertical("20", 5)];
    expect(extendCadEntity({ ...base, closed: true }, { x: 3, y: 0 }, boundary).reason).toBe("unsupported-target");
    expect(extendCadEntity({ ...base, periodic: true }, { x: 3, y: 0 }, boundary).reason).toBe("unsupported-target");
    expect(extendCadEntity({ ...base, knots: [0, 0, 0, 0.5, 1, 1, 1, 1.5] }, { x: 3, y: 0 }, boundary).reason).toBe("unsupported-target");
    expect(extendCadEntity({ ...base, knots: [-1, 0, 0, 0, 0, 1, 1, 1] }, { x: 3, y: 0 }, boundary).reason).toBe("unsupported-target");
    expect(extendCadEntity({ ...base, knots: [0, 0, 0, 1, 1, 1, 1, 2] }, { x: 3, y: 0 }, boundary).reason).toBe("unsupported-target");
    expect(extendCadEntity({ ...base, controlPoints: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 0 }] }, { x: 3, y: 0 }, boundary).reason).toBe("unsupported-target");
    expect(extendCadEntity({ ...base, degree: 2 }, { x: 3, y: 0 }, boundary).reason).toBe("unsupported-target");
  });
});
