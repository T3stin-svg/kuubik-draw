import { createEmptyDocument } from "@kuubik/cad-core";
import type { CadOperation, KDrawDocumentV1 } from "@kuubik/cad-schema";
import { describe, expect, it } from "vitest";
import { PrecisionUnitsCommandAdapter, type PrecisionUnitsPersistencePort } from "./units-command-adapter.js";

function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 0x1_0000_0000);
}

function port(document: KDrawDocumentV1): PrecisionUnitsPersistencePort {
  let stored = structuredClone(document);
  return {
    async recoverDocument() { return { document: structuredClone(stored), ignoredOperationIds: [], corruptSnapshotKeys: [], corruptCompactionKeys: [], sessionHistory: null }; },
    async operations() { return []; },
    async loadDocument() { return structuredClone(stored); },
    async commitRevision(next: KDrawDocumentV1, _operation: CadOperation) { stored = structuredClone(next); },
  };
}

describe("F-053 UNITS adapter properties and fuzz", () => {
  it("preserves every double coordinate across 2,000 valid randomized previews", async () => {
    const rng = random(0x53c0ffee);
    const source = createEmptyDocument({ documentId: "units-properties" });
    source.entities.push({ kind: "line", handle: "10", layerId: "0", start: { x: Math.PI, y: -Math.E }, end: { x: Number.MAX_SAFE_INTEGER / 17, y: 1e-120 } });
    const adapter = await PrecisionUnitsCommandAdapter.open(port(source), source.documentId);
    const units = ["mm", "cm", "m", "in", "ft"] as const;
    const separators = [".", ","] as const;
    const angleFormats = ["decimal-degrees", "dms", "grads", "radians", "surveyor"] as const;
    for (let index = 0; index < 2_000; index += 1) {
      adapter.openDialog();
      const readback = adapter.updateDraft({
        drawingUnit: units[Math.floor(rng() * units.length)]!,
        insertionUnit: units[Math.floor(rng() * units.length)]!,
        lengthPrecision: Math.floor(rng() * 16),
        anglePrecision: Math.floor(rng() * 16),
        angleFormat: angleFormats[Math.floor(rng() * angleFormats.length)]!,
        decimalSeparator: separators[Math.floor(rng() * separators.length)]!,
        clockwise: rng() >= 0.5,
        baseAngleRad: (rng() - 0.5) * 1e6,
      });
      expect(readback.status).toBe("editing");
      const preview = adapter.preview({ existingGeometryPolicy: "preserve-coordinates" });
      expect(preview.document.entities).toEqual(source.entities);
      expect(preview.coordinateScale).toBe(1);
    }
  });

  it("rejects 1,000 non-finite, out-of-range and locale-shaped fuzz patches without mutation", async () => {
    const source = createEmptyDocument({ documentId: "units-fuzz" });
    const adapter = await PrecisionUnitsCommandAdapter.open(port(source), source.documentId);
    const invalid = [NaN, Infinity, -Infinity, -1, 16, 1.5, "3", null, {}, []] as const;
    for (let index = 0; index < 1_000; index += 1) {
      adapter.openDialog();
      const readback = adapter.updateDraft({ lengthPrecision: invalid[index % invalid.length] as never });
      expect(readback.status).toBe("invalid");
      expect(() => adapter.preview()).toThrow(/invalid/u);
      expect(adapter.document).toEqual(source);
    }
  });
});
