import { replaceDrawingContentPreservingLayouts } from "@kuubik/cad-core";
import { DxfImportError, exportDxf, importDxf, type DxfImportReport } from "@kuubik/cad-dxf";
import type { CadOperation, KDrawDocumentV1 } from "@kuubik/cad-schema";
import { DocumentLiveOrchestrator } from "./document-live-orchestrator.js";

export interface DxfImportTransactionInput {
  documentId: string;
  bytes: Uint8Array;
  operationId: string;
  fileName: string;
  now?: string;
}

export interface DxfImportTransactionReadback {
  documentId: string;
  revision: number;
  sourceUnits: KDrawDocumentV1["units"]["linear"];
  targetUnits: KDrawDocumentV1["units"]["linear"];
  insertionScale: number;
  entityCount: number;
  blockCount: number;
  importedHandles: string[];
  exportedByteLength: number;
  exportedSha256: string;
  roundTripHandles: string[];
  operationId: string;
}

export interface DxfImportTransactionResult {
  document: KDrawDocumentV1;
  report: DxfImportReport;
  readback: DxfImportTransactionReadback;
  exportedBytes: Uint8Array;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function normalizedFileName(value: string): string {
  const fileName = value.trim();
  if (!/\.dxf$/iu.test(fileName)) throw new DxfImportError("DXFIN requires a .dxf file name.");
  return fileName;
}

/**
 * Parse first, then replace Model-space content as one append-only DXFIN
 * operation. No live state is exposed until storage and parser read-back agree.
 */
export async function importDxfIntoLiveDocument(
  live: DocumentLiveOrchestrator,
  input: DxfImportTransactionInput,
): Promise<DxfImportTransactionResult> {
  const fileName = normalizedFileName(input.fileName);
  const before = live.document(input.documentId);
  const imported = importDxf(input.bytes, {
    documentId: input.documentId,
    targetUnits: before.units.linear,
    preserveUnsupported: true,
    ...(input.now ? { now: input.now } : {}),
  });
  if (imported.report.skipped.length > 0 || imported.report.preservedProxyHandles.length > 0) {
    const first = imported.report.skipped[0];
    throw new DxfImportError(
      `DXFIN refused partial mutation from ${fileName}: ${imported.report.skipped.length} unsupported record(s)${first ? `; first ${first.type}${first.handle ? ` ${first.handle}` : ""}` : ""}.`,
      imported.report,
    );
  }
  const resultHandles = [
    ...imported.document.blocks.flatMap((block) => block.entities.map((entity) => entity.handle)),
    ...imported.document.entities.map((entity) => entity.handle),
  ];
  const operation: CadOperation = {
    opId: input.operationId,
    baseRevision: before.revision,
    commandId: "DXFIN",
    args: {
      fileName,
      sourceUnits: imported.report.sourceUnits,
      targetUnits: imported.report.targetUnits,
      insertionScale: imported.report.insertionScale,
    },
    targetHandles: before.entities.map((entity) => entity.handle),
    resultHandles,
  };
  const document = await live.commit(
    input.documentId,
    operation,
    replaceDrawingContentPreservingLayouts(before, imported.document),
    input.now,
  );
  const committedHandles = [
    ...document.blocks.flatMap((block) => block.entities.map((entity) => entity.handle)),
    ...document.entities.map((entity) => entity.handle),
  ];
  const exported = exportDxf(document);
  if (exported.report.skipped.length > 0) throw new DxfImportError(`DXFIN read-back export skipped ${exported.report.skipped.length} entity record(s).`, imported.report);
  const roundTrip = importDxf(exported.bytes, { documentId: `${input.documentId}:F-110-readback`, targetUnits: document.units.linear });
  if (roundTrip.report.skipped.length > 0 || JSON.stringify(roundTrip.report.importedHandles) !== JSON.stringify(committedHandles)) {
    throw new DxfImportError("DXFIN independent parser read-back does not match the committed handle manifest.", imported.report);
  }
  const persisted = live.document(input.documentId);
  if (JSON.stringify(persisted) !== JSON.stringify(document)) throw new DxfImportError("DXFIN live document read-back does not match the persisted revision.", imported.report);
  return {
    document,
    report: structuredClone(imported.report),
    exportedBytes: Uint8Array.from(exported.bytes),
    readback: {
      documentId: document.documentId,
      revision: document.revision,
      sourceUnits: imported.report.sourceUnits,
      targetUnits: imported.report.targetUnits,
      insertionScale: imported.report.insertionScale,
      entityCount: document.entities.length,
      blockCount: document.blocks.length,
      importedHandles: [...committedHandles],
      exportedByteLength: exported.bytes.byteLength,
      exportedSha256: await sha256(exported.bytes),
      roundTripHandles: [...roundTrip.report.importedHandles],
      operationId: operation.opId,
    },
  };
}
