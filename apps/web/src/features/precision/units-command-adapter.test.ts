import { createCadUnitsContract, createEmptyDocument } from "@kuubik/cad-core";
import type { CadOperation, KDrawDocumentV1 } from "@kuubik/cad-schema";
import { describe, expect, it } from "vitest";
import {
  PrecisionUnitsCommandAdapter,
  type PrecisionUnitsPersistencePort,
} from "./units-command-adapter.js";

class MemoryUnitsPersistence implements PrecisionUnitsPersistencePort {
  document: KDrawDocumentV1;
  readonly records: CadOperation[] = [];

  constructor(document: KDrawDocumentV1) { this.document = structuredClone(document); }
  async recoverDocument(): Promise<Awaited<ReturnType<PrecisionUnitsPersistencePort["recoverDocument"]>>> {
    return { document: structuredClone(this.document), ignoredOperationIds: [], corruptSnapshotKeys: [], corruptCompactionKeys: [], sessionHistory: null };
  }
  async operations(): Promise<Array<{ opId: string }>> { return this.records.map(({ opId }) => ({ opId })); }
  async loadDocument(): Promise<KDrawDocumentV1> { return structuredClone(this.document); }
  async commitRevision(document: KDrawDocumentV1, operation: CadOperation): Promise<void> {
    this.document = structuredClone(document);
    this.records.push(structuredClone(operation));
  }
}

describe("F-053 browser UNITS command adapter", () => {
  it("keeps preview immutable and commits one golden document-unit contract", async () => {
    const source = createEmptyDocument({ documentId: "units-golden", now: "2026-09-01T08:00:00.000Z" });
    source.entities.push({ kind: "line", handle: "10", layerId: "0", start: { x: 0.1234567890123, y: -2.5 }, end: { x: 987654321.125, y: 4.75 } });
    const persistence = new MemoryUnitsPersistence(source);
    const adapter = await PrecisionUnitsCommandAdapter.open(persistence, source.documentId, { operationId: () => "units-golden-op" });

    expect(adapter.openDialog()).toMatchObject({ status: "editing", draft: createCadUnitsContract(source.units) });
    expect(adapter.updateDraft({
      drawingUnit: "m",
      insertionUnit: "cm",
      lengthFormat: "scientific",
      lengthPrecision: 7,
      angleFormat: "grads",
      anglePrecision: 5,
      decimalSeparator: ",",
      clockwise: true,
      baseAngleRad: Math.PI / 2,
    })).toMatchObject({ status: "editing", error: null });

    const preview = adapter.preview({ existingGeometryPolicy: "preserve-coordinates" });
    expect(adapter.document).toEqual(source);
    expect(preview.document.entities).toEqual(source.entities);
    expect(preview.coordinateScale).toBe(1);

    const committed = await adapter.commit({ existingGeometryPolicy: "preserve-coordinates" }, "2026-09-01T08:01:00.000Z");
    expect(committed).toMatchObject({ persisted: true, coordinatesPreserved: true, coordinateScale: 1 });
    expect(committed.operation).toEqual({
      opId: "units-golden-op",
      baseRevision: 0,
      commandId: "UNITS",
      args: { contract: committed.current, existingGeometryPolicy: "preserve-coordinates" },
      targetHandles: [],
      resultHandles: [],
    });
    expect(committed.document).toEqual(persistence.document);
    expect(committed.document.entities).toEqual(source.entities);
    expect(committed.document.revision).toBe(1);
    expect(committed.document.metadata.updatedAt).toBe("2026-09-01T08:01:00.000Z");
    expect(adapter.readBack()).toMatchObject({ contract: committed.current, canUndo: true, canRedo: false, blocked: false, dialog: { status: "closed" } });
  });

  it("fails closed for invalid drafts and requires explicit geometry preservation", async () => {
    const source = createEmptyDocument({ documentId: "units-invalid" });
    source.entities.push({ kind: "circle", handle: "10", layerId: "0", center: { x: 1, y: 2 }, radius: 3 });
    const persistence = new MemoryUnitsPersistence(source);
    const adapter = await PrecisionUnitsCommandAdapter.open(persistence, source.documentId);
    adapter.openDialog();

    expect(adapter.updateDraft({ lengthPrecision: 16 })).toMatchObject({ status: "invalid", error: expect.stringMatching(/0 to 15/u) });
    expect(() => adapter.preview()).toThrow(/draft is invalid/u);
    expect(persistence.records).toEqual([]);
    expect(adapter.document).toEqual(source);

    adapter.updateDraft({ lengthPrecision: 3, drawingUnit: "cm" });
    expect(() => adapter.preview()).toThrow(/preserve-coordinates/u);
    await expect(adapter.commit()).rejects.toThrow(/preserve-coordinates/u);
    expect(persistence.records).toEqual([]);
    expect(adapter.document).toEqual(source);
  });

  it("cancels without a revision and rejects commands while the dialog is closed", async () => {
    const source = createEmptyDocument({ documentId: "units-cancel" });
    const persistence = new MemoryUnitsPersistence(source);
    const adapter = await PrecisionUnitsCommandAdapter.open(persistence, source.documentId);
    adapter.openDialog();
    adapter.updateDraft({ insertionUnit: "ft" });
    expect(adapter.cancelDialog()).toEqual({ status: "closed", draft: null, error: null });
    expect(() => adapter.preview()).toThrow(/not open/u);
    await expect(adapter.commit()).rejects.toThrow(/not open/u);
    expect(adapter.document).toEqual(source);
  });
});
