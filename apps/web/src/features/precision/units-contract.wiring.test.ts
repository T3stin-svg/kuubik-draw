import { describe, expect, it } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { createEmptyDocument } from "../../../../../packages/cad-core/src/document.js";
import { createCadUnitsContract, normalizeCadUnitsContract, planCadUnitsContract } from "../../../../../packages/cad-core/src/units.js";
import { KDrawIndexedDb } from "../../indexed-db.js";
import { PrecisionLayersShellContract } from "./shell-contract.js";
import { PrecisionUnitsCommandAdapter } from "./units-command-adapter.js";
import { PrecisionUnitsFeatureModel } from "./units-contract.js";

describe("F-053 persisted units wiring", () => {
  it("drives typed input and Dynamic Input from one reopened document contract", () => {
    const source = createEmptyDocument({ documentId: "units-wiring" });
    const units = normalizeCadUnitsContract({
      ...createCadUnitsContract(source.units),
      insertionUnit: "m",
      lengthFormat: "architectural",
      lengthPrecision: 4,
      angleFormat: "grads",
      anglePrecision: 3,
      decimalSeparator: ",",
    });
    const reopened = JSON.parse(JSON.stringify(planCadUnitsContract(source, units).document));
    const contract = new PrecisionLayersShellContract(reopened, {
      settings: { polarIncrementRad: Math.PI / 4, gridSpacingX: 1, gridSpacingY: 1, aperture: 0.25 },
      units: reopened.units,
      initialPrecision: { dynamicInput: true },
    });
    expect(contract.precisionUnitsContract).toEqual(units);

    const polar = contract.preparePointer({ basePoint: { x: 0, y: 0 }, cursorPoint: { x: 999, y: 999 }, input: "@381<50" }).resolve();
    expect(polar.preview).toEqual(polar.commit);
    expect(polar.commit.point.x).toBeCloseTo(381 / Math.sqrt(2), 12);
    expect(polar.commit.point.y).toBeCloseTo(381 / Math.sqrt(2), 12);
    expect(polar.dynamicInput.distance).toBe("1'-3\"");
    expect(polar.dynamicInput.angle).toBe("50,000g");
    expect(polar.dynamicInput.angleDeg).toBe(polar.dynamicInput.angle);
    expect(polar.dynamicInput.unitsContract).toEqual(units);

    const cartesian = contract.preparePointer({ basePoint: { x: 0, y: 0 }, cursorPoint: { x: 0, y: 0 }, input: "@1,5;2,5" }).commit();
    expect(cartesian.point).toEqual({ x: 1.5, y: 2.5 });
  });

  it("exposes pure plan/read/import-scale read-back without mutating the caller", () => {
    const document = createEmptyDocument({ documentId: "units-feature" });
    const model = new PrecisionUnitsFeatureModel();
    const units = normalizeCadUnitsContract({ ...model.read(document), insertionUnit: "m" });
    const planned = model.plan(document, units);
    expect(model.read(planned.document)).toEqual(units);
    expect(document.metadata.extensions).toBeUndefined();
    expect(model.insertionScale(undefined, units)).toMatchObject({ sourceUnit: "m", targetUnit: "mm", factor: 1000 });
  });

  it("atomically persists commit, Undo and Redo and restores history after IndexedDB reopen", async () => {
    const database = new KDrawIndexedDb(new IDBFactory(), "units-wiring-reopen");
    const source = createEmptyDocument({ documentId: "units-durable", now: "2026-09-01T08:00:00.000Z" });
    source.entities.push({ kind: "line", handle: "10", layerId: "0", start: { x: Math.PI, y: Math.E }, end: { x: -1e-99, y: 1e99 } });
    await database.saveSnapshot(source);

    const adapter = await PrecisionUnitsCommandAdapter.open(database, source.documentId, { operationId: () => "units-durable-op" });
    adapter.openDialog();
    adapter.updateDraft({ drawingUnit: "cm", insertionUnit: "m", decimalSeparator: ",", angleFormat: "radians", clockwise: true, baseAngleRad: Math.PI / 3 });
    const committed = await adapter.commit({ existingGeometryPolicy: "preserve-coordinates" }, "2026-09-01T08:01:00.000Z");
    expect(await database.loadDocument(source.documentId)).toEqual(committed.document);
    expect(committed.document.entities).toEqual(source.entities);

    const undone = await adapter.undo("2026-09-01T08:02:00.000Z");
    expect(undone).toMatchObject({ contract: createCadUnitsContract(source.units), canUndo: false, canRedo: true });
    expect(await database.loadDocument(source.documentId)).toEqual(undone!.document);

    const redone = await adapter.redo("2026-09-01T08:03:00.000Z");
    expect(redone).toMatchObject({ contract: committed.current, canUndo: true, canRedo: false });
    expect(await database.loadDocument(source.documentId)).toEqual(redone!.document);

    const reopened = await PrecisionUnitsCommandAdapter.open(database, source.documentId);
    expect(reopened.readBack()).toMatchObject({ contract: committed.current, canUndo: true, canRedo: false });
    const reopenedUndo = await reopened.undo("2026-09-01T08:04:00.000Z");
    expect(reopenedUndo).toMatchObject({ contract: createCadUnitsContract(source.units), canUndo: false, canRedo: true });
    expect(await database.loadDocument(source.documentId)).toEqual(reopenedUndo!.document);
    expect((await database.operations(source.documentId)).map(({ operation }) => operation.commandId)).toEqual(["UNITS", "UNDO", "UNITS", "UNDO"]);
    database.close();
  });
});
