import { describe, expect, it } from "vitest";
import { createEmptyDocument } from "../../../../../packages/cad-core/src/document.js";
import { PrecisionLayersShellContract } from "./shell-contract.js";

function precisionDocument() {
  const document = createEmptyDocument({ documentId: "precision-snap-tracking" });
  document.entities = [
    { kind: "line", handle: "A", layerId: "0", start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
    { kind: "line", handle: "B", layerId: "0", start: { x: 0, y: 0 }, end: { x: 0, y: 10 } },
  ];
  return document;
}

function contract() {
  return new PrecisionLayersShellContract(precisionDocument(), {
    settings: { polarIncrementRad: Math.PI / 4, polarAdditionalAnglesRad: [Math.PI / 6], gridSpacingX: 1, gridSpacingY: 1, aperture: 0.25 },
    units: { linear: "mm", displayPrecision: 8, angularPrecision: 6 },
    initialPrecision: { osnap: true, otrack: true, polar: true, dynamicInput: true },
  });
}

describe("DOM-independent complete snap/tracking shell contract", () => {
  it("cycles stable IDs and commits the exact explicitly selected pointer candidate", () => {
    const shell = contract();
    const initial = shell.updateSnapCycle({ x: 0, y: 0 });
    const cycled = shell.cycleSnap({ x: 0, y: 0 });
    expect(cycled.count).toBeGreaterThan(1);
    expect(cycled.candidateId).not.toBe(initial.candidateId);
    const prepared = shell.preparePointer({
      basePoint: { x: -1, y: -1 }, cursorPoint: { x: 0, y: 0 }, snapCandidateId: cycled.candidateId!,
    });
    shell.executePrecisionCommand("OSNAP OFF");
    const readback = prepared.resolve();
    expect(readback.preview).toEqual(readback.commit);
    expect(readback.dynamicInput.point).toEqual(readback.commit.point);
    expect(readback.request.objectSnapCandidates).toHaveLength(1);
    expect(readback.request.objectSnapCandidates?.[0]?.key).toBe(cycled.candidateId);
    expect(readback.selectedSnapCandidateId).toBe(cycled.candidateId);
    expect(readback.snapCandidateIds).toEqual(cycled.candidateIds);
  });

  it("supports acquired far Extension, OTRACK polar extension and exact release read-back", () => {
    const shell = contract();
    const extension = shell.querySnap({ x: 50, y: 0 }, { x: 0, y: 0 }, ["A"]).find((candidate) => candidate.mode === "extension");
    expect(extension).toMatchObject({ handle: "A", point: { x: 50, y: 0 }, parameter: 5 });
    const endpoint = shell.querySnap({ x: 0, y: 0 }).find((candidate) => candidate.handle === "A" && candidate.mode === "endpoint")!;
    expect(shell.acquireTracking(endpoint, 123)).toEqual({ key: endpoint.id, point: endpoint.point, acquiredAt: 123 });
    const tracking = shell.trackingCandidates({ x: 10, y: 10.1 });
    expect(tracking.some((candidate) => candidate.mode === "polar-extension" && Math.abs((candidate.angleRad ?? 0) - Math.PI / 4) < 1e-12)).toBe(true);
    expect(shell.releaseTracking(endpoint.id)).toEqual({ changed: true, acquired: [] });
    expect(shell.trackingCandidates({ x: 10, y: 10.1 })).toEqual([]);
  });

  it("fails closed when a pointer references a stale cycle ID", () => {
    const shell = contract();
    expect(() => shell.preparePointer({ basePoint: { x: 0, y: 0 }, cursorPoint: { x: 0, y: 0 }, snapCandidateId: "missing" })).toThrow("not available");
  });
});
