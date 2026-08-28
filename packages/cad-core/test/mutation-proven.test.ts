import { expect, it } from "vitest";
import { CadSession, applyAtomicOperation, copyPaperLayout, createEmptyDocument, createPaperLayout, createPaperViewport, deletePaperViewport, executeCopy, executeErase, executeMirror, executeMove, executeOffset, executeRectangle, executeRotate, executeScale, formatViewportScale, offsetCadEntity, panPaperViewportByPixels, resolvePaperDefinition, setPaperViewportView, viewportModelToNormalized, viewportNormalizedToModel, viewportScaleDenominator, zoomPaperViewportAtModelPoint } from "../src/index.js";

it("kills the revision-increment mutant", () => {
  const source = createEmptyDocument({ documentId: "mutation" });
  const result = applyAtomicOperation(
    source,
    { opId: "m1", baseRevision: 0, commandId: "LINE", args: {}, targetHandles: [], resultHandles: ["1"] },
    [{ type: "put", entity: { kind: "line", handle: "1", layerId: "0", start: { x: 0, y: 0 }, end: { x: 1, y: 0 } } }],
  );
  // Changing +1 to +0, +2, or assigning source.revision makes this assertion fail.
  expect(result.document.revision).toBe(source.revision + 1);
  expect(result.document).not.toBe(source);
});

it("kills RECTANGLE open-path, missing-corner and axis-swap mutants", () => {
  const [change] = executeRectangle({
    handle: "10",
    layerId: "0",
    firstCorner: { x: 100, y: 200 },
    otherCorner: { x: 600, y: 900 },
  });
  expect(change).toEqual({
    type: "put",
    entity: {
      kind: "polyline",
      handle: "10",
      layerId: "0",
      closed: true,
      vertices: [
        { x: 100, y: 200 },
        { x: 600, y: 200 },
        { x: 600, y: 900 },
        { x: 100, y: 900 },
      ],
    },
  });
});

it("kills ERASE duplicate-delete and locked-layer bypass mutants", () => {
  const document = createEmptyDocument({ documentId: "erase-mutation" });
  document.layers.push({ id: "locked", name: "Locked", visible: true, frozen: false, locked: true, plottable: true });
  document.entities.push(
    { kind: "line", handle: "10", layerId: "0", start: { x: 0, y: 0 }, end: { x: 1, y: 0 } },
    { kind: "line", handle: "11", layerId: "locked", start: { x: 0, y: 1 }, end: { x: 1, y: 1 } },
  );
  expect(executeErase(document, { targetHandles: ["10", "10", "11"] })).toEqual({
    changes: [{ type: "delete", handle: "10" }],
    erasedHandles: ["10"],
    rejected: [{ handle: "11", reason: "locked-layer" }],
  });
});

it("kills MOVE vector-sign, duplicate-put and locked-layer bypass mutants", () => {
  const document = createEmptyDocument({ documentId: "move-mutation" });
  document.layers.push({ id: "locked", name: "Locked", visible: true, frozen: false, locked: true, plottable: true });
  document.entities.push(
    { kind: "line", handle: "10", layerId: "0", start: { x: 0, y: 0 }, end: { x: 1000, y: 0 } },
    { kind: "line", handle: "11", layerId: "locked", start: { x: 0, y: 1000 }, end: { x: 1000, y: 1000 } },
  );
  expect(executeMove(document, {
    targetHandles: ["10", "10", "11"],
    basePoint: { x: 100, y: 200 },
    destinationPoint: { x: 600, y: 950 },
  })).toEqual({
    changes: [{ type: "put", entity: { kind: "line", handle: "10", layerId: "0", start: { x: 500, y: 750 }, end: { x: 1500, y: 750 } } }],
    movedHandles: ["10"],
    rejected: [{ handle: "11", reason: "locked-layer" }],
    delta: { x: 500, y: 750 },
  });
});

it("kills COPY chaining, source-overwrite, duplicate-source and locked-layer bypass mutants", () => {
  const document = createEmptyDocument({ documentId: "copy-mutation" });
  document.layers.push({ id: "locked", name: "Locked", visible: true, frozen: false, locked: true, plottable: true });
  document.entities.push(
    { kind: "line", handle: "10", layerId: "0", start: { x: 0, y: 0 }, end: { x: 1000, y: 0 } },
    { kind: "line", handle: "11", layerId: "locked", start: { x: 0, y: 1000 }, end: { x: 1000, y: 1000 } },
  );
  expect(executeCopy(document, {
    targetHandles: ["10", "10", "11"],
    basePoint: { x: 100, y: 200 },
    destinationPoints: [{ x: 600, y: 950 }, { x: -200, y: 300 }],
  })).toEqual({
    changes: [
      { type: "put", entity: { kind: "line", handle: "12", layerId: "0", start: { x: 500, y: 750 }, end: { x: 1500, y: 750 } } },
      { type: "put", entity: { kind: "line", handle: "13", layerId: "0", start: { x: -300, y: 100 }, end: { x: 700, y: 100 } } },
    ],
    sourceHandles: ["10"],
    copiedHandles: ["12", "13"],
    rejected: [{ handle: "11", reason: "locked-layer" }],
    deltas: [{ x: 500, y: 750 }, { x: -300, y: 100 }],
  });
  expect(document.entities[0]).toMatchObject({ handle: "10", start: { x: 0, y: 0 }, end: { x: 1000, y: 0 } });
});

it("kills the COPY block-space handle-collision mutant", () => {
  const document = createEmptyDocument({ documentId: "copy-block-handle-mutation" });
  document.entities.push({ kind: "line", handle: "10", layerId: "0", start: { x: 0, y: 0 }, end: { x: 1, y: 0 } });
  document.blocks.push({
    id: "b1",
    name: "B1",
    basePoint: { x: 0, y: 0 },
    entities: [{ kind: "line", handle: "11", layerId: "0", start: { x: 0, y: 0 }, end: { x: 2, y: 0 } }],
  });
  const result = executeCopy(document, {
    targetHandles: ["10"],
    basePoint: { x: 0, y: 0 },
    destinationPoints: [{ x: 5, y: 0 }],
  });
  expect(result.copiedHandles).toEqual(["12"]);
  expect(result.changes[0]).toMatchObject({ type: "put", entity: { handle: "12" } });
});

it("kills ROTATE sign, Reference-delta, orientation, duplicate-put and locked-layer mutants", () => {
  const document = createEmptyDocument({ documentId: "rotate-mutation" });
  document.layers.push({ id: "locked", name: "Locked", visible: true, frozen: false, locked: true, plottable: true });
  document.entities.push(
    { kind: "arc", handle: "10", layerId: "0", appearance: { color: "#f00" }, center: { x: 500, y: 200 }, radius: 30, startAngleRad: 0, endAngleRad: Math.PI / 2, counterClockwise: true },
    { kind: "text", handle: "11", layerId: "0", position: { x: 1100, y: 200 }, text: "R", height: 20, rotationRad: 0.25 },
    { kind: "line", handle: "12", layerId: "locked", start: { x: 0, y: 1000 }, end: { x: 1000, y: 1000 } },
  );
  expect(executeRotate(document, {
    targetHandles: ["10", "10", "11", "12"],
    basePoint: { x: 100, y: 200 },
    angle: { mode: "reference", referenceAngleDeg: 45, newAngleDeg: 135 },
  })).toEqual({
    changes: [
      { type: "put", entity: { kind: "arc", handle: "10", layerId: "0", appearance: { color: "#f00" }, center: { x: 100, y: 600 }, radius: 30, startAngleRad: Math.PI / 2, endAngleRad: Math.PI, counterClockwise: true } },
      { type: "put", entity: { kind: "text", handle: "11", layerId: "0", position: { x: 100, y: 1200 }, text: "R", height: 20, rotationRad: 0.25 + Math.PI / 2 } },
    ],
    rotatedHandles: ["10", "11"],
    rejected: [{ handle: "12", reason: "locked-layer" }],
    deltaAngleDeg: 90,
  });
});

it("kills SCALE ratio, base-point, geometric-size, copy-handle and locked-layer mutants", () => {
  const document = createEmptyDocument({ documentId: "scale-mutation" });
  document.layers.push({ id: "locked", name: "Locked", visible: true, frozen: false, locked: true, plottable: true });
  document.entities.push(
    { kind: "circle", handle: "10", layerId: "0", appearance: { color: "#f00" }, center: { x: 300, y: 0 }, radius: 25 },
    { kind: "text", handle: "11", layerId: "0", position: { x: 1100, y: 0 }, text: "S", height: 20, rotationRad: 0.25 },
    { kind: "line", handle: "12", layerId: "locked", start: { x: 0, y: 1000 }, end: { x: 1000, y: 1000 } },
  );
  expect(executeScale(document, {
    targetHandles: ["10", "10", "11", "12"],
    basePoint: { x: 100, y: 200 },
    scale: { mode: "reference", referenceLength: 1000, newLength: 2000 },
    copy: true,
  })).toEqual({
    changes: [
      { type: "put", entity: { kind: "circle", handle: "13", layerId: "0", appearance: { color: "#f00" }, center: { x: 500, y: -200 }, radius: 50 } },
      { type: "put", entity: { kind: "text", handle: "14", layerId: "0", position: { x: 2100, y: -200 }, text: "S", height: 40, rotationRad: 0.25 } },
    ],
    sourceHandles: ["10", "11"],
    scaledHandles: [],
    createdHandles: ["13", "14"],
    rejected: [{ handle: "12", reason: "locked-layer" }],
    factor: 2,
    copy: true,
  });
  expect(document.entities.map((entity) => entity.handle)).toEqual(["10", "11", "12"]);
});

it("kills MIRROR projection, handedness, source mode, fresh-handle and locked-layer mutants", () => {
  const document = createEmptyDocument({ documentId: "mirror-mutation" });
  document.layers.push({ id: "locked", name: "Locked", visible: true, frozen: false, locked: true, plottable: true });
  document.entities.push(
    { kind: "polyline", handle: "10", layerId: "0", appearance: { color: "#f00" }, closed: false, vertices: [{ x: 0, y: 0, bulge: 0.5 }, { x: 100, y: 0 }] },
    { kind: "text", handle: "11", layerId: "0", position: { x: 200, y: 0 }, text: "M", height: 20, rotationRad: 0.25 },
    { kind: "line", handle: "12", layerId: "locked", start: { x: 0, y: 1000 }, end: { x: 1000, y: 1000 } },
  );
  expect(executeMirror(document, {
    targetHandles: ["10", "10", "11", "12"],
    axisStart: { x: 150, y: -100 },
    axisEnd: { x: 150, y: 100 },
    eraseSource: false,
  })).toEqual({
    changes: [
      { type: "put", entity: { kind: "polyline", handle: "13", layerId: "0", appearance: { color: "#f00" }, closed: false, vertices: [{ x: 300, y: 0, bulge: -0.5 }, { x: 200, y: 0 }] } },
      { type: "put", entity: { kind: "text", handle: "14", layerId: "0", position: { x: 100, y: 0 }, text: "M", height: 20, rotationRad: Math.PI * 2 - 0.25, extensionData: { kuubikMirrorTextAlign: "end" } } },
    ],
    sourceHandles: ["10", "11"],
    mirroredHandles: ["13", "14"],
    createdHandles: ["13", "14"],
    rejected: [{ handle: "12", reason: "locked-layer" }],
    eraseSource: false,
  });
  expect(document.entities.map((entity) => entity.handle)).toEqual(["10", "11", "12"]);
});

it("kills OFFSET side, progressive-Multiple, Erase, Layer, properties and locked-layer mutants", () => {
  const document = createEmptyDocument({ documentId: "offset-mutation" });
  document.layers.push(
    { id: "current", name: "Current", visible: true, frozen: false, locked: false, plottable: true },
    { id: "locked", name: "Locked", visible: true, frozen: false, locked: true, plottable: true },
  );
  document.currentLayerId = "current";
  document.entities.push(
    { kind: "line", handle: "10", layerId: "0", appearance: { color: "#f00", lineweightMm: 0.5 }, extensionData: { keep: true }, start: { x: 0, y: 0 }, end: { x: 1000, y: 0 } },
    { kind: "line", handle: "11", layerId: "locked", start: { x: 0, y: 1000 }, end: { x: 1000, y: 1000 } },
  );
  expect(executeOffset(document, {
    targetHandles: ["10", "10", "11"],
    mode: "distance",
    distance: 100,
    placementPoints: [{ x: 500, y: 100 }, { x: 500, y: 250 }],
    multiple: true,
    eraseSource: true,
    layerMode: "current",
  })).toEqual({
    changes: [
      { type: "delete", handle: "10" },
      { type: "put", entity: { kind: "line", handle: "13", layerId: "current", appearance: { color: "#f00", lineweightMm: 0.5 }, extensionData: { keep: true }, start: { x: 0, y: 200 }, end: { x: 1000, y: 200 } } },
    ],
    sourceHandles: ["10"],
    createdHandles: ["13"],
    rejected: [{ handle: "11", placementIndex: null, reason: "locked-layer" }],
    steps: [
      { originalSourceHandle: "10", sourceHandle: "10", resultHandle: "12", placementIndex: 0, signedDistance: 100 },
      { originalSourceHandle: "10", sourceHandle: "12", resultHandle: "13", placementIndex: 1, signedDistance: 100 },
    ],
    mode: "distance",
    multiple: true,
    eraseSource: true,
    layerMode: "current",
  });
  expect(document.entities.map((entity) => entity.handle)).toEqual(["10", "11"]);
});

it("kills OFFSET overflow and ellipse-cusp acceptance mutants", () => {
  const hugeLine = offsetCadEntity(
    { kind: "line", handle: "10", layerId: "0", start: { x: 1e308, y: 0 }, end: { x: 1e308, y: 1e308 } },
    "distance",
    Number.MAX_VALUE,
    { x: Number.MAX_VALUE, y: 1 },
  );
  expect(hugeLine).toMatchObject({ entity: null, reason: "invalid-offset" });

  const hugeCircle = offsetCadEntity(
    { kind: "circle", handle: "11", layerId: "0", center: { x: 1e308, y: 0 }, radius: 100 },
    "distance",
    Number.MAX_VALUE,
    { x: 1.1e308, y: 0 },
  );
  expect(hugeCircle).toMatchObject({ entity: null, reason: "invalid-offset" });

  const collapsedEllipse = offsetCadEntity(
    {
      kind: "ellipse",
      handle: "12",
      layerId: "0",
      center: { x: 0, y: 0 },
      majorAxis: { x: 200, y: 0 },
      ratio: 0.5,
      startParameter: 0,
      endParameter: Math.PI * 2,
    },
    "distance",
    60,
    { x: 0, y: 0 },
  );
  expect(collapsedEllipse).toMatchObject({
    signedDistance: 60,
    entity: { kind: "spline", closed: false },
    entities: [{ kind: "spline", closed: false }, { kind: "spline", closed: false }],
  });
  expect(collapsedEllipse.entities).toHaveLength(2);
});

it("kills F-097 shallow-copy, reused-handle and wrong-insertion mutants", () => {
  const document = createEmptyDocument({ documentId: "F-097-mutation" });
  const source = createPaperLayout(document, {
    name: "PLAN",
    viewports: [{
      id: "source-vp", center: { x: 10, y: 10 }, width: 20, height: 20,
      viewCenter: { x: 100, y: 200 }, viewHeight: 500, twistAngleRad: 0.25, locked: true,
    }],
    entities: [{ kind: "circle", handle: "20", layerId: "0", center: { x: 5, y: 5 }, radius: 25 }],
  });
  const withSource = { ...document, layouts: source.layouts };
  const copied = copyPaperLayout(withSource, source.layoutId);
  expect(copied.layouts.map((layout) => layout.name)).toEqual(["Model", "PLAN (2)", "PLAN"]);
  const sourceLayout = copied.layouts[2]!;
  const copyLayout = copied.layouts[1]!;
  expect(copyLayout).not.toBe(sourceLayout);
  expect(copyLayout.viewports[0]).not.toBe(sourceLayout.viewports[0]);
  expect(copyLayout.viewports[0]!.id).not.toBe(sourceLayout.viewports[0]!.id);
  expect(copyLayout.entities![0]).not.toBe(sourceLayout.entities![0]);
  expect(copyLayout.entities![0]!.handle).not.toBe(sourceLayout.entities![0]!.handle);
});

it("kills F-098 zero-sheet and collapsed-printable-area mutants", () => {
  const document = createEmptyDocument({ documentId: "F-098-mutation" });
  const layout = createPaperLayout(document, {
    name: "F098 PAPER",
    paper: { widthMm: 420, heightMm: 297, marginsMm: { top: 10, right: 10, bottom: 10, left: 10 } },
  }).layouts[1]!;
  expect(resolvePaperDefinition(layout)).toMatchObject({ widthMm: 420, heightMm: 297 });
  expect(() => resolvePaperDefinition({ ...layout, paper: { ...layout.paper!, heightMm: 0 } })).toThrow(/positive/i);
  expect(() => resolvePaperDefinition({
    ...layout,
    paper: { widthMm: 420, heightMm: 297, marginsMm: { top: 149, right: 10, bottom: 148, left: 10 } },
  })).toThrow(/printable area/i);
});

it("kills F-099 shared-id, wrong-layout, malformed-clip and wrong-adjacent-selection mutants", () => {
  const document = createEmptyDocument({ documentId: "F-099-mutation" });
  const paper = createPaperLayout(document, { name: "F099 PAPER", viewports: [] });
  const withPaper = { ...document, layouts: paper.layouts };
  const first = createPaperViewport(withPaper, paper.layoutId, {
    center: { x: 100, y: 100 }, width: 100, height: 120,
    viewCenter: { x: 0, y: 0 }, viewHeight: 1000, twistAngleRad: 0, locked: false,
  });
  const second = createPaperViewport({ ...withPaper, layouts: first.layouts }, paper.layoutId, {
    center: { x: 220, y: 100 }, width: 100, height: 120,
    viewCenter: { x: 2000, y: 0 }, viewHeight: 500, twistAngleRad: 0, locked: true,
    clipBoundary: [{ x: 170, y: 50 }, { x: 230, y: 40 }, { x: 270, y: 100 }, { x: 230, y: 160 }, { x: 170, y: 150 }],
  });
  expect([first.viewportId, second.viewportId]).toEqual(["viewport-1", "viewport-2"]);
  expect(second.layouts[1]!.viewports).toMatchObject([
    { id: "viewport-1", viewCenter: { x: 0, y: 0 }, viewHeight: 1000 },
    { id: "viewport-2", viewCenter: { x: 2000, y: 0 }, viewHeight: 500, locked: true },
  ]);
  expect(() => createPaperViewport({ ...withPaper, layouts: second.layouts }, paper.layoutId, {
    center: { x: 220, y: 100 }, width: 100, height: 120,
    viewCenter: { x: 0, y: 0 }, viewHeight: 100, twistAngleRad: 0, locked: false,
    clipBoundary: [{ x: 170, y: 40 }, { x: 270, y: 120 }, { x: 170, y: 160 }, { x: 270, y: 40 }],
  })).toThrow(/simple/i);
  const deleted = deletePaperViewport({ ...withPaper, layouts: second.layouts }, paper.layoutId, "viewport-2");
  expect(deleted.viewportId).toBe("viewport-1");
  expect(deleted.layouts[1]!.viewports.map((viewport) => viewport.id)).toEqual(["viewport-1"]);
  expect(() => createPaperViewport(withPaper, "model", {
    center: { x: 1, y: 1 }, width: 1, height: 1, viewCenter: { x: 0, y: 0 }, viewHeight: 1, twistAngleRad: 0, locked: false,
  })).toThrow(/Model layout/i);
  expect(() => createPaperViewport(withPaper, paper.layoutId, {
    center: { x: 1.7e308, y: 0 }, width: 1.7e308, height: 1,
    viewCenter: { x: 0, y: 0 }, viewHeight: 1.7e308, twistAngleRad: 0, locked: false,
  })).toThrow(/finite/i);
});

it("kills F-100 inverse-twist, wrong-scale, drifting-anchor, unrotated-pan and non-atomic mutants", () => {
  const document = createEmptyDocument({ documentId: "F-100-mutation" });
  const paper = createPaperLayout(document, { name: "F100 PAPER", viewports: [] });
  const source = { ...document, layouts: paper.layouts };
  const created = createPaperViewport(source, paper.layoutId, {
    center: { x: 210, y: 148.5 }, width: 200, height: 100,
    viewCenter: { x: 0, y: 0 }, viewHeight: 5000, twistAngleRad: 0, locked: false,
  });
  const session = new CadSession({ ...source, layouts: created.layouts });
  const preset = setPaperViewportView(session.document, paper.layoutId, created.viewportId!, {
    viewCenter: { x: 1000, y: -500 }, scaleDenominator: 20, twistAngleRad: Math.PI / 6,
  });
  session.commit({ opId: "F100-preset", baseRevision: 0, commandId: "VIEWPORT_VIEW", args: {}, targetHandles: [], resultHandles: [] }, preset.changes);
  const before = session.document.layouts[1]!.viewports[0]!;
  expect(before.viewHeight).toBe(2000);
  expect(viewportScaleDenominator(before)).toBe(20);
  expect(formatViewportScale(before)).toBe("1:20");
  const anchor = viewportNormalizedToModel(before, { x: 0.27, y: -0.19 });
  const zoomed = zoomPaperViewportAtModelPoint(session.document, paper.layoutId, created.viewportId!, anchor, 1 / 1.1);
  session.commit({ opId: "F100-zoom", baseRevision: 1, commandId: "VIEWPORT_ZOOM", args: {}, targetHandles: [], resultHandles: [] }, zoomed.changes);
  const afterZoom = session.document.layouts[1]!.viewports[0]!;
  expect(formatViewportScale(afterZoom)).toBe("1:18.182 (Custom)");
  expect(viewportModelToNormalized(afterZoom, anchor)).toEqual({ x: expect.closeTo(0.27, 12), y: expect.closeTo(-0.19, 12) });
  const panned = panPaperViewportByPixels(session.document, paper.layoutId, created.viewportId!, { x: 100, y: 50 }, { width: 400, height: 200 });
  session.commit({ opId: "F100-pan", baseRevision: 2, commandId: "VIEWPORT_PAN", args: {}, targetHandles: [], resultHandles: [] }, panned.changes);
  const afterPan = session.document.layouts[1]!.viewports[0]!;
  const localPan = { x: -0.25 * (afterZoom.viewHeight * 2), y: 0.25 * afterZoom.viewHeight };
  expect(afterPan.viewCenter.x).toBeCloseTo(afterZoom.viewCenter.x + localPan.x * Math.cos(-Math.PI / 6) - localPan.y * Math.sin(-Math.PI / 6), 9);
  expect(afterPan.viewCenter.y).toBeCloseTo(afterZoom.viewCenter.y + localPan.x * Math.sin(-Math.PI / 6) + localPan.y * Math.cos(-Math.PI / 6), 9);
  expect(afterPan.twistAngleRad).toBeCloseTo(Math.PI / 6, 12);
  session.undo();
  expect(session.document.layouts[1]!.viewports[0]!.viewCenter).toEqual(afterZoom.viewCenter);
  session.undo();
  expect(session.document.layouts[1]!.viewports[0]!).toMatchObject({ viewCenter: { x: 1000, y: -500 }, viewHeight: 2000, twistAngleRad: Math.PI / 6 });
  session.redo();
  expect(session.document.layouts[1]!.viewports[0]!.viewCenter).toEqual(afterZoom.viewCenter);
});
