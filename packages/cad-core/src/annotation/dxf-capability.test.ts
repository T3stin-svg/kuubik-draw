import { describe, expect, it } from "vitest";
import { createEmptyDocument } from "../document.js";
import { withBlockAttributes } from "../blocks/contracts.js";
import { withAnnotationExtension } from "./contracts.js";
import { AnnotationBlockDxfCapabilityError, assertAnnotationBlockDxfCapabilities, createAnnotationBlockDxfCapabilityReceipt, evaluateAnnotationBlockDxfCapabilities, readBackAnnotationBlockDxfCapabilityReceipt, requiredAnnotationBlockDxfCapabilities, type AnnotationBlockDxfCapabilityId } from "./dxf-capability.js";
import { createTable, createTableStyle } from "./table.js";

function fixture() {
  const document = createEmptyDocument({ documentId: "dxf-capabilities" });
  document.textStyles.push({ id: "TXT", name: "TXT", fontFamily: "Arial", widthFactor: 1, obliqueAngleRad: 0 });
  document.dimensionStyles.push({ id: "DIM", name: "DIM", textStyleId: "TXT", textHeight: 2.5, arrowSize: 2.5, extensionOffset: 0.5, scale: 1, overrides: { "kuubik.dimensionStyle.v1": { linearPrecision: 2 } } });
  const tableStyle = createTableStyle(document, { id: "TABLE", name: "TABLE", textStyleId: "TXT", textHeight: 2.5, cellMargin: 1, borderWidth: 0.25, horizontalAlignment: "left", verticalAlignment: "middle" });
  if (tableStyle.type !== "set-metadata") throw new Error("Expected TABLE metadata change.");
  document.metadata = tableStyle.metadata;
  document.blocks.push(withBlockAttributes({ id: "B", name: "B", basePoint: { x: 0, y: 0 }, entities: [{ kind: "line", handle: "B1", layerId: "0", start: { x: 0, y: 0 }, end: { x: 10, y: 0 } }] }, [{ tag: "MARK", prompt: "Mark", defaultValue: "B1", position: { x: 0, y: 2 }, height: 2.5 }]));
  document.entities.push(
    { kind: "line", handle: "L1", layerId: "0", start: { x: 0, y: 0 }, end: { x: 10, y: 10 } },
    withAnnotationExtension({ kind: "dimension", handle: "D1", layerId: "0", dimensionKind: "aligned", definitionPoints: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 5 }, { x: 0, y: 5 }], styleId: "DIM" }, { kind: "dimension", associative: true, anchors: [{ handle: "L1", feature: "start", fallback: { x: 0, y: 0 } }], chain: { id: "C1", index: 0, mode: "continued" } }),
    withAnnotationExtension({ kind: "leader", handle: "ML1", layerId: "0", vertices: [{ x: 0, y: 0 }, { x: 10, y: 10 }], text: "ML" }, { kind: "mleader", version: 2, styleId: "MLS", textPosition: { x: 12, y: 10 }, textHeight: 2.5, landingGap: 1, arrow: { type: "closed-filled", size: 2.5 }, landing: { enabled: true, length: 0 }, associative: true, anchor: { handle: "L1", feature: "start", fallback: { x: 0, y: 0 } } }),
    withAnnotationExtension({ kind: "hatch", handle: "H1", layerId: "0", pattern: "ANSI31", associative: true, loops: [{ isHole: false, vertices: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }] }, { isHole: true, vertices: [{ x: 5, y: 5 }, { x: 10, y: 5 }, { x: 10, y: 10 }] }] }, { kind: "hatch", pattern: { type: "line", angleRad: 0, scale: 1, origin: { x: 0, y: 0 } }, boundaryHandles: ["P1", "P2"] }),
    { kind: "blockRef", handle: "I1", layerId: "0", blockId: "B", insertion: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotationRad: 0, attributes: { MARK: "B2" } },
    createTable(document, { handle: "T1", layerId: "0", origin: { x: 0, y: 0 }, styleId: "TABLE", rows: [{ id: "R", height: 8 }], columns: [{ id: "C", width: 20 }] }),
  );
  return document;
}

describe("annotation/block DXF fail-closed capability contract", () => {
  it("derives deterministic exact requirements from real document semantics", () => {
    const requirements = requiredAnnotationBlockDxfCapabilities(fixture());
    expect(requirements.map((item) => item.capability)).toEqual([
      "block-attributes", "block-definition", "dimension-aligned", "dimension-association", "dimension-chain", "dimension-style", "dimension-style-profile",
      "hatch-association", "hatch-islands", "hatch-line-pattern", "insert-transform", "leader-association", "mleader", "table", "text-style",
    ]);
    expect(requirements.find((item) => item.capability === "mleader")).toMatchObject({ rowIds: ["F-060"], minimumVersion: "AC1021", handles: ["ML1"] });
    expect(requirements.find((item) => item.capability === "leader-association")).toMatchObject({ rowIds: ["F-059", "F-060"], handles: ["ML1"] });
  });

  it("rejects missing, lossy and unsupported claims without mutating the document", () => {
    const document = fixture();
    const before = structuredClone(document);
    const evaluation = evaluateAnnotationBlockDxfCapabilities(document, { adapterId: "session-4", dxfVersion: "AC1018", capabilities: { "dimension-aligned": "exact", mleader: "lossy" } });
    expect(evaluation.rejected.find((item) => item.capability === "mleader")?.declared).toBe("lossy");
    expect(() => assertAnnotationBlockDxfCapabilities(document, { adapterId: "session-4", dxfVersion: "AC1018", capabilities: { "dimension-aligned": "exact", mleader: "unsupported" } })).toThrow(AnnotationBlockDxfCapabilityError);
    expect(document).toEqual(before);
  });

  it("rejects an exact capability when the selected DXF version predates it", () => {
    const document = fixture();
    const capabilities = Object.fromEntries(requiredAnnotationBlockDxfCapabilities(document).map((item) => [item.capability, "exact"])) as Record<AnnotationBlockDxfCapabilityId, "exact">;
    const evaluation = evaluateAnnotationBlockDxfCapabilities(document, { adapterId: "session-4", dxfVersion: "AC1018", capabilities });
    expect(evaluation.rejected).toContainEqual(expect.objectContaining({ capability: "mleader", declared: "exact", reason: "version", minimumVersion: "AC1021" }));
    expect(() => assertAnnotationBlockDxfCapabilities(document, { adapterId: "session-4", dxfVersion: "AC1018", capabilities })).toThrow(/mleader=requires-AC1021/);
  });

  it("passes only when every derived capability is declared exact", () => {
    const document = fixture();
    const capabilities = Object.fromEntries(requiredAnnotationBlockDxfCapabilities(document).map((item) => [item.capability, "exact"])) as Record<AnnotationBlockDxfCapabilityId, "exact">;
    expect(assertAnnotationBlockDxfCapabilities(document, { adapterId: "verified-adapter", dxfVersion: "AC1021", capabilities })).toHaveLength(Object.keys(capabilities).length);
  });

  it("round-trips an annotation/block capability receipt and rejects document or receipt mutants", () => {
    const document = fixture();
    const capabilities = Object.fromEntries(requiredAnnotationBlockDxfCapabilities(document).map((item) => [item.capability, "exact"])) as Record<AnnotationBlockDxfCapabilityId, "exact">;
    const receipt = createAnnotationBlockDxfCapabilityReceipt(document, { adapterId: "contract-read-back", dxfVersion: "AC1021", capabilities });
    const serialized = JSON.stringify(receipt);
    expect(readBackAnnotationBlockDxfCapabilityReceipt(document, JSON.parse(serialized))).toEqual(receipt);

    const changedDocument = structuredClone(document);
    changedDocument.entities.find((entity) => entity.handle === "ML1")!.handle = "ML2";
    expect(() => readBackAnnotationBlockDxfCapabilityReceipt(changedDocument, JSON.parse(serialized))).toThrow(/does not match/u);
    const changedReceipt = JSON.parse(serialized) as typeof receipt;
    changedReceipt.declaration.dxfVersion = "AC1018";
    expect(() => readBackAnnotationBlockDxfCapabilityReceipt(document, changedReceipt)).toThrow(/requires-AC1021/u);
  });
});
