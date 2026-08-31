import { describe, expect, it, vi } from "vitest";
import { createEmptyDocument } from "../../../../../packages/cad-core/src/document.js";
import { CadSession } from "../../../../../packages/cad-core/src/transaction.js";
import { PrecisionCoordinateEntryAdapter } from "./coordinate-entry-adapter.js";
import { PrecisionDynamicInputAdapter } from "./dynamic-input-adapter.js";
import { PrecisionLayersShellContract } from "./shell-contract.js";

function fixture(decimalSeparator: "." | "," = ".") {
  const document = createEmptyDocument({ documentId: `dynamic-${decimalSeparator}`, now: "2026-08-31T00:00:00Z" });
  const session = new CadSession(document);
  const shell = new PrecisionLayersShellContract(document, {
    settings: { polarIncrementRad: Math.PI / 4, gridSpacingX: 1, gridSpacingY: 1, aperture: 0.25 },
    units: { linear: "mm", displayPrecision: 3, angularPrecision: 3 },
    unitsContract: {
      schemaVersion: 1, drawingUnit: "mm", insertionUnit: "mm",
      lengthFormat: "decimal", lengthPrecision: 3,
      angleFormat: "decimal-degrees", anglePrecision: 3,
      decimalSeparator, clockwise: false, baseAngleRad: 0,
    },
    inputFormat: { decimalSeparator, defaultAngleUnit: "deg" },
    initialPrecision: { dynamicInput: true },
  });
  const onDocumentChange = vi.fn();
  const coordinate = new PrecisionCoordinateEntryAdapter(session, (input) => shell.preparePointer(input), {
    opIdPrefix: "dynamic-test", now: () => "2026-08-31T00:01:00Z", onDocumentChange,
  });
  const dynamic = new PrecisionDynamicInputAdapter(coordinate, shell, { offsetCssPx: { x: 14, y: 20 } });
  return { dynamic, shell, session, onDocumentChange };
}

describe("F-052 Dynamic Input golden interaction", () => {
  it("publishes pointer-adjacent X/Y and distance/angle read-back without rounding geometry", () => {
    const { dynamic } = fixture();
    const snapshot = dynamic.start(
      { basePoint: { x: 10, y: 20 }, cursorPoint: { x: 13.123456789, y: 24.987654321 } },
      { x: 400, y: 300 },
    );
    expect(snapshot).toMatchObject({
      visible: true, status: "active", entryMode: "relative-cartesian", activeField: "x",
      overlay: { leftCssPx: 414, topCssPx: 320, offsetCssPx: { x: 14, y: 20 } },
      result: { point: { x: 13.123456789, y: 24.987654321 } },
    });
    expect(snapshot.result?.delta).toEqual({ x: 13.123456789 - 10, y: 24.987654321 - 20 });
    expect(snapshot.fields.map(({ id, label, displayValue, editable }) => ({ id, label, displayValue, editable }))).toEqual([
      { id: "x", label: "ΔX", displayValue: "3.123", editable: true },
      { id: "y", label: "ΔY", displayValue: "4.988", editable: true },
      { id: "distance", label: "Distance", displayValue: expect.any(String), editable: false },
      { id: "angle", label: "Angle", displayValue: expect.any(String), editable: false },
    ]);
  });

  it("cycles editable fields with TAB/Shift+TAB and requests commit only for a valid preview", () => {
    const { dynamic } = fixture();
    dynamic.start({ basePoint: { x: 0, y: 0 }, cursorPoint: { x: 1, y: 1 } }, { x: 10, y: 20 });
    expect(dynamic.handleKey("Tab")).toMatchObject({ handled: true, action: "focus-changed", snapshot: { activeField: "y" } });
    expect(dynamic.handleKey("Tab")).toMatchObject({ snapshot: { activeField: "x" } });
    expect(dynamic.handleKey("Tab", { shiftKey: true })).toMatchObject({ snapshot: { activeField: "y" } });
    expect(dynamic.handleKey("Enter")).toMatchObject({ handled: false, action: null });
    dynamic.editField("x", "1.25");
    dynamic.editField("y", "-2.5");
    expect(dynamic.handleKey("Enter")).toMatchObject({ handled: true, action: "commit-requested", snapshot: { commitReady: true } });
    expect(dynamic.handleKey("Tab", { repeat: true })).toMatchObject({ handled: false, action: null });
  });

  it("accepts comma and dot locale fields for absolute, relative and polar entry", () => {
    const comma = fixture(",").dynamic;
    comma.start({ basePoint: { x: 10, y: 20 }, cursorPoint: { x: 0, y: 0 } }, { x: 0, y: 0 });
    comma.editField("x", "1,5");
    expect(comma.editField("y", "-2,25")).toMatchObject({
      rawInput: "@1,5;-2,25", commitReady: true,
      result: { point: { x: 11.5, y: 17.75 }, x: "11,500", y: "17,750", source: "typed-cartesian" },
    });

    const dot = fixture().dynamic;
    dot.start({ basePoint: { x: 100, y: 200 }, cursorPoint: { x: 0, y: 0 } }, { x: 0, y: 0 }, "absolute-cartesian");
    dot.editField("x", "10.5");
    expect(dot.editField("y", "20.25")).toMatchObject({ rawInput: "10.5;20.25", result: { point: { x: 10.5, y: 20.25 } } });
    expect(dot.setEntryMode("relative-polar")).toMatchObject({ activeField: "distance", commitReady: false });
    dot.editField("distance", "10");
    const polar = dot.editField("angle", "-90");
    expect(polar.rawInput).toBe("@10<-90");
    expect(polar.result?.point.x).toBeCloseTo(100, 14);
    expect(polar.result?.point.y).toBeCloseTo(190, 14);
    expect(dot.previewRaw("10<90").result?.source).toBe("typed-polar");
  });

  it("cancels on Escape and commits the immutable preview as one atomic Undo/Redo operation", () => {
    const cancelled = fixture();
    cancelled.dynamic.start({ basePoint: { x: 0, y: 0 }, cursorPoint: { x: 1, y: 1 } }, { x: 50, y: 50 });
    cancelled.dynamic.previewRaw("@10;20");
    expect(cancelled.dynamic.handleKey("Escape")).toMatchObject({ handled: true, action: "cancelled", snapshot: { visible: false, status: "cancelled", revision: 0 } });
    expect(() => cancelled.dynamic.commit(() => ({ commandId: "NO", changes: [] }))).toThrow("valid preview");

    const { dynamic, onDocumentChange } = fixture();
    dynamic.start({ basePoint: { x: 5, y: 5 }, cursorPoint: { x: 9, y: 9 } }, { x: 100, y: 100 });
    const preview = dynamic.previewRaw("@10;20").result!;
    const committed = dynamic.commit((point) => ({
      commandId: "POINT_FROM_DYNAMIC_INPUT",
      changes: [{ type: "put", entity: { kind: "line", handle: "created", layerId: "0", start: { x: 5, y: 5 }, end: point } }],
      resultHandles: ["created"],
    }));
    expect(committed.preview).toEqual(committed.pointCommit);
    expect(committed.pointCommit.point).toEqual(preview.point);
    expect(committed.committed).toMatchObject({ committedRevision: 1, operation: { commandId: "POINT_FROM_DYNAMIC_INPUT" } });
    expect(dynamic.snapshot()).toMatchObject({ visible: false, status: "committed", revision: 1 });
    dynamic.undo();
    dynamic.redo();
    expect(onDocumentChange.mock.calls.map(([document]) => document.revision)).toEqual([1, 2, 3]);
    expect(dynamic.document.entities.at(-1)).toMatchObject({ handle: "created", end: { x: 15, y: 25 } });
  });
});
