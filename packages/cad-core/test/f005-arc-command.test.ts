import type { CadPoint2 } from "@kuubik/cad-schema";
import { describe, expect, it } from "vitest";
import {
  prepareCompleteArcCommand,
  solveStartEndRadiusArc,
  type CompleteArcCommandInput,
} from "../src/arc-command.js";
import { createEmptyDocument } from "../src/document.js";
import { CadSession } from "../src/transaction.js";

const TAU = Math.PI * 2;

function expectPoint(actual: CadPoint2, expected: CadPoint2): void {
  expect(actual.x).toBeCloseTo(expected.x, 10);
  expect(actual.y).toBeCloseTo(expected.y, 10);
}

describe("F-005 complete ARC command matrix", () => {
  it("constructs three-point minor and major arcs through the exact picked point", () => {
    const minor = prepareCompleteArcCommand({
      command: "ARC", handle: "A1", layerId: "A-GEOM",
      construction: { mode: "3p", start: { x: 10, y: 0 }, point: { x: 0, y: 10 }, end: { x: -10, y: 0 } },
    });
    expectPoint(minor.selected.center, { x: 0, y: 0 });
    expect(minor.selected.radius).toBeCloseTo(10, 10);
    expect(minor.selected.sweepRad).toBeCloseTo(Math.PI, 10);
    expectPoint(minor.selected.midpoint, { x: 0, y: 10 });

    const major = prepareCompleteArcCommand({
      command: "ARC", handle: "A2", layerId: "A-GEOM",
      construction: { mode: "3p", start: { x: 10, y: 0 }, point: { x: 0, y: -10 }, end: { x: 0, y: 10 } },
    });
    expect(major.selected.major).toBe(true);
    expect(major.selected.sweepRad).toBeCloseTo(Math.PI * 3 / 2, 10);
  });

  it.each([
    ["start-center-end", { mode: "start-center-end", start: { x: 10, y: 0 }, center: { x: 0, y: 0 }, end: { x: 0, y: 50 } }],
    ["center-start-end", { mode: "center-start-end", center: { x: 0, y: 0 }, start: { x: 10, y: 0 }, end: { x: 0, y: 50 } }],
  ] as const)("matches %s and projects the end direction to the start radius", (_label, construction) => {
    const normal = prepareCompleteArcCommand({ command: "ARC", handle: "B1", layerId: "0", construction });
    expect(normal.selected.sweepRad).toBeCloseTo(Math.PI / 2, 10);
    expectPoint(normal.selected.endPoint, { x: 0, y: 10 });
    const clockwise = prepareCompleteArcCommand({
      command: "ARC", handle: "B2", layerId: "0", construction: { ...construction, clockwiseCtrl: true },
    });
    expect(clockwise.entity.counterClockwise).toBe(false);
    expect(clockwise.selected.sweepRad).toBeCloseTo(Math.PI * 3 / 2, 10);
  });

  it.each(["start-center-angle", "center-start-angle"] as const)("supports %s angle and Ctrl direction", (mode) => {
    const normal = prepareCompleteArcCommand({
      command: "ARC", handle: "C1", layerId: "0",
      construction: { mode, center: { x: 0, y: 0 }, start: { x: 10, y: 0 }, includedAngleRad: Math.PI * 3 / 2 },
    });
    expect(normal.selected.major).toBe(true);
    expect(normal.entity.counterClockwise).toBe(true);
    expectPoint(normal.selected.endPoint, { x: 0, y: -10 });
    const clockwise = prepareCompleteArcCommand({
      command: "ARC", handle: "C2", layerId: "0",
      construction: { mode, center: { x: 0, y: 0 }, start: { x: 10, y: 0 }, includedAngleRad: Math.PI / 2, clockwiseCtrl: true },
    });
    expect(clockwise.entity.counterClockwise).toBe(false);
    expectPoint(clockwise.selected.endPoint, { x: 0, y: -10 });
  });

  it.each(["start-center-length", "center-start-length"] as const)("supports %s chord length, major and Ctrl", (mode) => {
    const minor = prepareCompleteArcCommand({
      command: "ARC", handle: "D1", layerId: "0",
      construction: { mode, center: { x: 0, y: 0 }, start: { x: 10, y: 0 }, chordLength: 10 },
    });
    expect(minor.selected.sweepRad).toBeCloseTo(Math.PI / 3, 10);
    const majorClockwise = prepareCompleteArcCommand({
      command: "ARC", handle: "D2", layerId: "0",
      construction: { mode, center: { x: 0, y: 0 }, start: { x: 10, y: 0 }, chordLength: 10, major: true, clockwiseCtrl: true },
    });
    expect(majorClockwise.selected.sweepRad).toBeCloseTo(Math.PI * 5 / 3, 10);
    expect(majorClockwise.entity.counterClockwise).toBe(false);
    const signedMajor = prepareCompleteArcCommand({
      command: "ARC", handle: "D3", layerId: "0",
      construction: { mode, center: { x: 0, y: 0 }, start: { x: 10, y: 0 }, chordLength: -10 },
    });
    expect(signedMajor.selected.sweepRad).toBeCloseTo(Math.PI * 5 / 3, 10);
    expect(signedMajor.entity.counterClockwise).toBe(true);
  });

  it("constructs Start-End-Angle minor, major and clockwise arcs", () => {
    for (const [angle, clockwise] of [[Math.PI / 2, false], [Math.PI * 3 / 2, false], [Math.PI / 2, true]] as const) {
      const prepared = prepareCompleteArcCommand({
        command: "ARC", handle: `E${angle}:${clockwise}`, layerId: "0",
        construction: { mode: "start-end-angle", start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, includedAngleRad: angle, clockwiseCtrl: clockwise },
      });
      expect(prepared.selected.sweepRad).toBeCloseTo(angle, 10);
      expect(prepared.entity.counterClockwise).toBe(!clockwise);
      expectPoint(prepared.selected.startPoint, { x: 0, y: 0 });
      expectPoint(prepared.selected.endPoint, { x: 10, y: 0 });
    }
  });

  it("constructs Start-End-Direction and Ctrl reverses the initial tangent", () => {
    const normal = prepareCompleteArcCommand({
      command: "ARC", handle: "F1", layerId: "0",
      construction: { mode: "start-end-direction", start: { x: 0, y: 0 }, end: { x: 10, y: 10 }, tangentDirectionRad: 0 },
    });
    expectPoint(normal.selected.center, { x: 0, y: 10 });
    expect(normal.entity.counterClockwise).toBe(true);
    expect(normal.selected.sweepRad).toBeCloseTo(Math.PI / 2, 10);
    const ctrl = prepareCompleteArcCommand({
      command: "ARC", handle: "F2", layerId: "0",
      construction: { mode: "start-end-direction", start: { x: 0, y: 0 }, end: { x: 10, y: 10 }, tangentDirectionRad: 0, clockwiseCtrl: true },
    });
    expect(ctrl.entity.counterClockwise).toBe(false);
    expect(ctrl.selected.sweepRad).toBeCloseTo(Math.PI * 3 / 2, 10);
  });

  it("enumerates Start-End-Radius centers/directions and resolves direction, major and pick side", () => {
    const construction = { mode: "start-end-radius" as const, start: { x: -5, y: 0 }, end: { x: 5, y: 0 }, radius: 10 };
    const candidates = solveStartEndRadiusArc(construction);
    expect(candidates).toHaveLength(4);
    expect(new Set(candidates.map((candidate) => candidate.major))).toEqual(new Set([false, true]));
    expect(new Set(candidates.map((candidate) => candidate.counterClockwise))).toEqual(new Set([false, true]));
    const selected = prepareCompleteArcCommand({
      command: "ARC", handle: "G1", layerId: "0",
      construction: { ...construction, clockwiseCtrl: false, major: false },
    });
    expect(selected.selected.center.y).toBeGreaterThan(0);
    expect(selected.entity.counterClockwise).toBe(true);
    expect(selected.selected.major).toBe(false);
    const picked = prepareCompleteArcCommand({
      command: "ARC", handle: "G2", layerId: "0",
      construction: { ...construction, clockwiseCtrl: false, selection: { mode: "near-center", point: { x: 0, y: -9 } } },
    });
    expect(picked.selected.center.y).toBeLessThan(0);
    const throughPoint = prepareCompleteArcCommand({
      command: "ARC", handle: "G3", layerId: "0",
      construction: { ...construction, clockwiseCtrl: false, selection: { mode: "through-point", point: { x: 0, y: -1.339745962156 } } },
    });
    expect(throughPoint.selected.center.y).toBeGreaterThan(0);
    expect(throughPoint.selected.major).toBe(false);
    const signedMajor = prepareCompleteArcCommand({
      command: "ARC", handle: "G4", layerId: "0",
      construction: { ...construction, radius: -10 },
    });
    expect(signedMajor.entity.counterClockwise).toBe(true);
    expect(signedMajor.selected.major).toBe(true);
  });

  it("keeps preview equal to commit and commits one atomic Undo/Redo operation with exact properties", () => {
    const input: CompleteArcCommandInput = {
      command: "ARC", handle: "A5", layerId: "ARC_TEST",
      construction: { mode: "start-end-radius", start: { x: -5, y: 0 }, end: { x: 5, y: 0 }, radius: 10, clockwiseCtrl: true, major: true },
      appearance: { color: "#123456", colorMethod: "trueColor", aciIndex: 7, lineweightMm: 0.35, thickness: -2 },
      extensionData: { rowId: "F-005" },
    };
    const preview = prepareCompleteArcCommand(input);
    const commit = prepareCompleteArcCommand(input);
    expect(commit).toEqual(preview);
    expect(commit.entity).toMatchObject({ kind: "arc", handle: "A5", layerId: "ARC_TEST", appearance: input.appearance, extensionData: input.extensionData });
    expect(commit.changes).toEqual([{ type: "put", entity: commit.entity }]);
    const document = createEmptyDocument({ documentId: "F-005-atomic" });
    document.layers.push({ id: "ARC_TEST", name: "ARC_TEST", visible: true, frozen: false, locked: false, plottable: true });
    const session = new CadSession(document);
    session.commit({ opId: "F-005:1", baseRevision: 0, commandId: "ARC", args: input, targetHandles: [], resultHandles: commit.resultHandles }, commit.changes, "2026-08-31T20:00:00.000Z");
    expect(session.document.entities).toEqual(commit.entities);
    session.undo("2026-08-31T20:00:01.000Z");
    expect(session.document.entities).toEqual([]);
    session.redo("2026-08-31T20:00:02.000Z");
    expect(session.document.entities).toEqual(commit.entities);
    expect(session.document.revision).toBe(3);
  });

  it("keeps 64 deterministic angle properties exact", () => {
    for (let index = 1; index <= 64; index += 1) {
      const angle = 0.05 + index * (TAU - 0.1) / 65;
      const clockwise = index % 2 === 0;
      const prepared = prepareCompleteArcCommand({
        command: "ARC", handle: `P${index}`, layerId: "0",
        construction: { mode: "start-end-angle", start: { x: -index, y: index / 3 }, end: { x: index * 1.5, y: -index / 5 }, includedAngleRad: angle, clockwiseCtrl: clockwise },
      });
      expect(prepared.selected.sweepRad).toBeCloseTo(angle, 8);
      expect(prepared.entity.counterClockwise).toBe(!clockwise);
      expectPoint(prepared.selected.startPoint, { x: -index, y: index / 3 });
      expectPoint(prepared.selected.endPoint, { x: index * 1.5, y: -index / 5 });
      expect(prepared.selected.radius).toBeGreaterThan(0);
    }
  });
});
