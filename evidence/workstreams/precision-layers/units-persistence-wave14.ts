import { createHash } from "node:crypto";
import { IDBFactory } from "fake-indexeddb";
import { createEmptyDocument } from "../../../packages/cad-core/src/document.js";
import { createCadUnitsContract } from "../../../packages/cad-core/src/units.js";
import { KDrawIndexedDb } from "../../../apps/web/src/indexed-db.js";
import { PrecisionUnitsCommandAdapter } from "../../../apps/web/src/features/precision/units-command-adapter.js";

const sha256 = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const database = new KDrawIndexedDb(new IDBFactory(), "units-persistence-wave14");
const source = createEmptyDocument({ documentId: "units-wave14-evidence", now: "2026-09-01T18:00:00.000Z" });
source.entities = [
  { kind: "line", handle: "A", layerId: "0", start: { x: Math.PI, y: -Math.E }, end: { x: 1e-120, y: 987654321.1234567 } },
  { kind: "circle", handle: "B", layerId: "0", center: { x: -0.0000000000001, y: Number.MAX_SAFE_INTEGER / 19 }, radius: Math.SQRT2 },
];
await database.saveSnapshot(source);

const adapter = await PrecisionUnitsCommandAdapter.open(database, source.documentId, { operationId: () => "units-wave14-op" });
adapter.openDialog();
adapter.updateDraft({
  drawingUnit: "m",
  insertionUnit: "cm",
  lengthFormat: "scientific",
  lengthPrecision: 12,
  angleFormat: "radians",
  anglePrecision: 12,
  decimalSeparator: ",",
  clockwise: true,
  baseAngleRad: Math.PI / 3,
});
const committed = await adapter.commit({ existingGeometryPolicy: "preserve-coordinates" }, "2026-09-01T18:01:00.000Z");
const storedCommit = await database.loadDocument(source.documentId);
const undone = await adapter.undo("2026-09-01T18:02:00.000Z");
const redone = await adapter.redo("2026-09-01T18:03:00.000Z");
const reopened = await PrecisionUnitsCommandAdapter.open(database, source.documentId);
const reopenedReadback = reopened.readBack();
const reopenedUndo = await reopened.undo("2026-09-01T18:04:00.000Z");
const operations = await database.operations(source.documentId);
const recovery = await database.recoverDocument(source.documentId);

process.stdout.write(`${JSON.stringify({
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  node: process.version,
  command: "npx vite-node evidence/workstreams/precision-layers/units-persistence-wave14.ts",
  baselineCommit: "a6d2cf917c55bf415257dc9ca1ba59684a53467c",
  featureRows: ["F-053"],
  contract: committed.current,
  atomicHistory: {
    revisions: {
      source: source.revision,
      committed: committed.document.revision,
      undone: undone?.document.revision,
      redone: redone?.document.revision,
      reopenedUndo: reopenedUndo?.document.revision,
    },
    operationIds: operations.map(({ opId }) => opId),
    commandIds: operations.map(({ operation }) => operation.commandId),
    reopenedCanUndo: reopenedReadback.canUndo,
    reopenedCanRedo: reopenedReadback.canRedo,
    recoveredSource: recovery.source,
    recoveredRevision: recovery.recoveredRevision,
    recoveryReceipt: recovery.receipt.code,
  },
  durableReadback: {
    commitExact: JSON.stringify(storedCommit) === JSON.stringify(committed.document),
    recoveryExact: JSON.stringify(recovery.document) === JSON.stringify(reopenedUndo?.document),
    contractAfterUndo: reopenedUndo?.contract,
    expectedUndoContract: createCadUnitsContract(source.units),
  },
  geometry: {
    sourceSha256: sha256(source.entities),
    committedSha256: sha256(committed.document.entities),
    reopenedUndoSha256: sha256(reopenedUndo?.document.entities),
    coordinatesPreserved: committed.coordinatesPreserved,
    coordinateScale: committed.coordinateScale,
  },
  liveEvidence: {
    autocad2024: "NOT_RUN",
    chromiumIntegratedUi: "NOT_RUN",
    parityScoresChanged: false,
  },
}, null, 2)}\n`);
database.close();
