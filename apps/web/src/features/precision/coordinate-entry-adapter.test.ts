import { describe, expect, it, vi } from "vitest";
import { createEmptyDocument } from "../../../../../packages/cad-core/src/document.js";
import { CadSession } from "../../../../../packages/cad-core/src/transaction.js";
import { PrecisionCoordinateEntryAdapter } from "./coordinate-entry-adapter.js";
import { PrecisionLayersShellContract } from "./shell-contract.js";

function fixture() {
  const document = createEmptyDocument({ documentId: "coordinate-entry", now: "2026-08-31T00:00:00Z" });
  document.entities = [{ kind: "line", handle: "guide", layerId: "0", start: { x: 0, y: 0 }, end: { x: 2000, y: 0 } }];
  const session = new CadSession(document);
  const shell = new PrecisionLayersShellContract(document, {
    settings: { polarIncrementRad: Math.PI / 4, gridSpacingX: 5, gridSpacingY: 5, aperture: 0.25 },
    units: { linear: "mm", displayPrecision: 6, angularPrecision: 6 },
    inputFormat: { decimalSeparator: ",", defaultAngleUnit: "deg" },
    initialPrecision: { ortho: true, snap: true, osnap: true, otrack: true, dynamicInput: true },
  });
  const onDocumentChange = vi.fn();
  const adapter = new PrecisionCoordinateEntryAdapter(session, (input) => shell.preparePointer(input), {
    opIdPrefix: "coordinate-test", now: () => "2026-08-31T00:01:00Z", onDocumentChange,
  });
  return { adapter, onDocumentChange };
}

describe("F-041/F-042/F-044 browser-ready coordinate entry", () => {
  it("commits the exact locale/unit preview as one revision and one Undo/Redo step", () => {
    const { adapter, onDocumentChange } = fixture();
    expect(adapter.start({ basePoint: { x: 100, y: 100 }, cursorPoint: { x: 999, y: 999 } })).toMatchObject({ status: "active", revision: 0 });
    const preview = adapter.preview("@1,5m;-250,25mm");
    expect(preview).toMatchObject({ status: "preview", preview: { source: "typed-cartesian", point: { x: 1600, y: -150.25 } } });
    const result = adapter.commit((point) => ({
      commandId: "LINE_BY_COORDINATE",
      changes: [{ type: "put", entity: { kind: "line", handle: "created", layerId: "0", start: { x: 100, y: 100 }, end: point } }],
      resultHandles: ["created"],
    }));
    expect(result.preview).toEqual(result.pointCommit);
    expect(result.committed).toMatchObject({ committedRevision: 1, operation: { commandId: "LINE_BY_COORDINATE", baseRevision: 0, resultHandles: ["created"] } });
    expect(result.document.entities.at(-1)).toMatchObject({ handle: "created", end: { x: 1600, y: -150.25 } });
    adapter.undo();
    expect(adapter.document.entities.map((entity) => entity.handle)).toEqual(["guide"]);
    adapter.redo();
    expect(adapter.document.entities.map((entity) => entity.handle)).toEqual(["guide", "created"]);
    expect(onDocumentChange.mock.calls.map(([document]) => document.revision)).toEqual([1, 2, 3]);
  });

  it("supports error/retry and cancel without document or history mutation", () => {
    const { adapter, onDocumentChange } = fixture();
    adapter.start({ basePoint: { x: 5, y: 5 }, cursorPoint: { x: 5, y: 5 } });
    expect(adapter.preview("@1,5,2,5")).toMatchObject({ status: "retry", revision: 0, canUndo: false, error: expect.any(String) });
    expect(adapter.retry("@10<-90")).toMatchObject({ status: "preview", preview: { source: "typed-polar" } });
    expect(adapter.cancel()).toMatchObject({ status: "cancelled", preview: null, revision: 0, canUndo: false });
    expect(() => adapter.commit(() => ({ commandId: "NO", changes: [] }))).toThrow("valid preview");
    expect(adapter.document.revision).toBe(0);
    expect(onDocumentChange).not.toHaveBeenCalled();
  });

  it("keeps zero-length entry at the base and rejects a failing planner atomically", () => {
    const { adapter } = fixture();
    adapter.start({ basePoint: { x: 2.5, y: -7.25 }, cursorPoint: { x: 1000, y: 1000 } });
    expect(adapter.preview("0")).toMatchObject({
      status: "preview", preview: { source: "direct-distance", point: { x: 2.5, y: -7.25 } }, revision: 0,
    });
    expect(() => adapter.commit(() => { throw new Error("planner refused zero-length geometry"); })).toThrow("planner refused");
    expect(adapter.snapshot()).toMatchObject({ status: "preview", revision: 0, canUndo: false });
  });
});
