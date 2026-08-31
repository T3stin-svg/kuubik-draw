import { describe, expect, it, vi } from "vitest";
import { createEmptyDocument } from "../../../../../packages/cad-core/src/document.js";
import { CadSession } from "../../../../../packages/cad-core/src/transaction.js";
import type { PrecisionResult } from "../../../../../packages/cad-core/src/precision.js";
import { PrecisionCoordinateEntryAdapter } from "./coordinate-entry-adapter.js";
import type { PreparedPrecisionPointer } from "./shell-contract.js";

const pointResult = (x: number): PrecisionResult => ({ point: { x, y: 0 }, source: "typed-cartesian", stages: [] });

describe("coordinate entry mutation guards", () => {
  it("kills preview/commit divergence before a planner or revision can run", () => {
    const session = new CadSession(createEmptyDocument({ documentId: "coordinate-mismatch" }));
    const planner = vi.fn();
    const fake = {
      resolve: () => ({ preview: pointResult(1), commit: pointResult(2), dynamicInput: {}, request: {}, snapCandidateIds: [], selectedSnapCandidateId: null }),
      commit: () => pointResult(2),
    } as unknown as PreparedPrecisionPointer;
    const adapter = new PrecisionCoordinateEntryAdapter(session, () => fake);
    adapter.start({ basePoint: { x: 0, y: 0 }, cursorPoint: { x: 1, y: 0 } });
    expect(adapter.preview("1,0")).toMatchObject({ status: "retry", error: "Coordinate preview and point commit disagree.", revision: 0 });
    expect(() => adapter.commit(planner)).toThrow("valid preview");
    expect(planner).not.toHaveBeenCalled();
  });

  it("rejects illegal lifecycle transitions without mutating the session", () => {
    const session = new CadSession(createEmptyDocument({ documentId: "coordinate-lifecycle" }));
    const fake = { resolve: () => ({ preview: pointResult(1), commit: pointResult(1), dynamicInput: {}, request: {}, snapCandidateIds: [], selectedSnapCandidateId: null }), commit: () => pointResult(1) } as unknown as PreparedPrecisionPointer;
    const adapter = new PrecisionCoordinateEntryAdapter(session, () => fake);
    expect(() => adapter.preview("1,0")).toThrow("started");
    expect(() => adapter.retry("1,0")).toThrow("not waiting");
    adapter.start({ basePoint: { x: 0, y: 0 }, cursorPoint: { x: 1, y: 0 } });
    adapter.cancel();
    expect(() => adapter.preview("1,0")).toThrow("started");
    expect(session.document.revision).toBe(0);
    expect(session.canUndo).toBe(false);
  });
});
