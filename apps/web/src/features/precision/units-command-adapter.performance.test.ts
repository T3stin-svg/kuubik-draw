import { createEmptyDocument } from "@kuubik/cad-core";
import type { KDrawDocumentV1 } from "@kuubik/cad-schema";
import { describe, expect, it } from "vitest";
import { PrecisionUnitsCommandAdapter, type PrecisionUnitsPersistencePort } from "./units-command-adapter.js";

describe("F-053 UNITS 50,000-object performance", () => {
  it("plans a coordinate-preserving unit change within the bounded interactive budget", async () => {
    const source = createEmptyDocument({ documentId: "units-50k" });
    for (let index = 0; index < 50_000; index += 1) {
      source.entities.push({
        kind: "line",
        handle: index.toString(16).toUpperCase(),
        layerId: "0",
        start: { x: index + Math.PI, y: -index - Math.E },
        end: { x: index * 1.0000000000001, y: index / 7 },
      });
    }
    const persistence: PrecisionUnitsPersistencePort = {
      async recoverDocument() { return { document: source, ignoredOperationIds: [], corruptSnapshotKeys: [], corruptCompactionKeys: [], sessionHistory: null }; },
      async operations() { return []; },
      async loadDocument() { return source; },
      async commitRevision(_document: KDrawDocumentV1) { return undefined; },
    };
    const adapter = await PrecisionUnitsCommandAdapter.open(persistence, source.documentId);
    adapter.openDialog();
    adapter.updateDraft({ drawingUnit: "m", insertionUnit: "cm", lengthPrecision: 12, anglePrecision: 12 });
    const started = performance.now();
    const preview = adapter.preview({ existingGeometryPolicy: "preserve-coordinates" });
    const elapsedMs = performance.now() - started;

    expect(preview.document.entities).toEqual(source.entities);
    expect(preview.document.entities).toHaveLength(50_000);
    expect(preview.coordinateScale).toBe(1);
    expect(elapsedMs).toBeLessThan(2_000);
  }, 10_000);
});
