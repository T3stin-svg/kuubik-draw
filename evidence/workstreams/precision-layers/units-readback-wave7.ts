import { createHash } from "node:crypto";
import { createEmptyDocument } from "../../../packages/cad-core/src/document.js";
import {
  createCadUnitsContract,
  formatCadAngleWithContract,
  formatCadLengthWithContract,
  normalizeCadUnitsContract,
  planCadUnitsContract,
  readCadUnitsContract,
  resolveCadImportScale,
  type CadAngleFormat,
  type CadLengthFormat,
  type CadUnitsContractV1,
} from "../../../packages/cad-core/src/units.js";
import { PrecisionLayersShellContract } from "../../../apps/web/src/features/precision/shell-contract.js";

const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");
const source = createEmptyDocument({ documentId: "units-wave7-evidence", now: "2026-08-31T17:00:00.000Z" });
source.entities = [{ kind: "line", handle: "A", layerId: "0", start: { x: 1.25, y: -2.5 }, end: { x: 3.75, y: 4.5 } }];
const geometry = (document: typeof source) => JSON.stringify({ entities: document.entities, blocks: document.blocks, layouts: document.layouts });
const contract = normalizeCadUnitsContract({
  ...createCadUnitsContract(source.units),
  drawingUnit: "m",
  insertionUnit: "cm",
  lengthFormat: "scientific",
  lengthPrecision: 6,
  angleFormat: "grads",
  anglePrecision: 5,
  decimalSeparator: ",",
  clockwise: true,
  baseAngleRad: 0.25,
});
const planned = planCadUnitsContract(source, contract, { existingGeometryPolicy: "preserve-coordinates" });
const serialized = JSON.stringify(planned.document);
const reopened = JSON.parse(serialized);
const shell = new PrecisionLayersShellContract(reopened, {
  settings: { polarIncrementRad: Math.PI / 4, gridSpacingX: 1, gridSpacingY: 1, aperture: 0.25 },
  units: reopened.units,
  initialPrecision: { dynamicInput: true },
});
const pointer = shell.preparePointer({ basePoint: { x: 0, y: 0 }, cursorPoint: { x: 9, y: 9 }, input: "@1,5;2,5" }).resolve();

const lengthFormats = Object.fromEntries((["decimal", "engineering", "architectural", "fractional", "scientific"] as CadLengthFormat[]).map((lengthFormat) => {
  const value: CadUnitsContractV1 = normalizeCadUnitsContract({
    ...createCadUnitsContract({ linear: "mm", displayPrecision: 4, angularPrecision: 4 }),
    lengthFormat,
  });
  return [lengthFormat, formatCadLengthWithContract(393.7, value)];
}));
const angleFormats = Object.fromEntries((["decimal-degrees", "dms", "grads", "radians", "surveyor"] as CadAngleFormat[]).map((angleFormat) => {
  const value: CadUnitsContractV1 = normalizeCadUnitsContract({
    ...createCadUnitsContract({ linear: "mm", displayPrecision: 4, angularPrecision: 4 }),
    angleFormat,
  });
  return [angleFormat, formatCadAngleWithContract(Math.PI / 4, value)];
}));

process.stdout.write(`${JSON.stringify({
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  node: process.version,
  command: "npx vite-node evidence/workstreams/precision-layers/units-readback-wave7.ts",
  contract: readCadUnitsContract(reopened),
  serialization: {
    documentSha256: sha256(serialized),
    geometryBeforeSha256: sha256(geometry(source)),
    geometryAfterSha256: sha256(geometry(planned.document)),
    coordinatesPreserved: planned.coordinatesPreserved,
    coordinateScale: planned.coordinateScale,
  },
  importScale: {
    metresToMillimetres: resolveCadImportScale("m", "mm"),
    unitlessExplicit: resolveCadImportScale("unitless", "mm", 25.4),
  },
  golden: { lengthFormats, angleFormats },
  typedInput: {
    parsed: pointer.request.input,
    previewCommitEqual: JSON.stringify(pointer.preview) === JSON.stringify(pointer.commit),
    committedPoint: pointer.commit.point,
    dynamicInput: { x: pointer.dynamicInput.x, y: pointer.dynamicInput.y, distance: pointer.dynamicInput.distance, angle: pointer.dynamicInput.angle },
  },
}, null, 2)}\n`);
