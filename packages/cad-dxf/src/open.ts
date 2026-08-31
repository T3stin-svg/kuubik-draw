import { assertKDrawDocumentV1, type KDrawDocumentV1 } from "@kuubik/cad-schema";
import {
  DxfImportError,
  importDxf,
  type DxfImportOptions,
  type DxfImportReport,
} from "./import.js";

const DXF_FILE_NAME = /\.dxf$/iu;

export interface DxfOpenOptions extends DxfImportOptions {
  fileName: string;
  rejectUnsupported?: boolean;
}

export interface DxfOpenReadback {
  documentId: string;
  title: string;
  units: KDrawDocumentV1["units"]["linear"];
  modelLayoutId: string;
  entityCount: number;
  layerCount: number;
  importedHandles: string[];
  entityKinds: Record<string, number>;
}

export interface DxfOpenResult {
  document: KDrawDocumentV1;
  report: DxfImportReport;
  readback: DxfOpenReadback;
}

function titleFromFileName(fileName: string): string {
  const leaf = fileName.trim().replaceAll("\\", "/").split("/").at(-1) ?? "";
  if (!leaf || !DXF_FILE_NAME.test(leaf)) throw new DxfImportError("DXF open requires a .dxf file name.");
  const title = leaf.replace(DXF_FILE_NAME, "").trim();
  if (!title) throw new DxfImportError("DXF file name must contain a drawing name.");
  return title;
}

export function readBackOpenedDxf(document: KDrawDocumentV1, report: DxfImportReport): DxfOpenReadback {
  assertKDrawDocumentV1(document);
  const modelLayouts = document.layouts.filter((layout) => layout.kind === "model");
  if (modelLayouts.length !== 1) throw new DxfImportError(`Opened DXF must contain exactly one Model layout; found ${modelLayouts.length}.`, report);
  const importedHandles = [...report.importedHandles];
  const actualHandles = [
    ...document.blocks.flatMap((block) => block.entities.map((entity) => entity.handle)),
    ...document.entities.map((entity) => entity.handle),
  ];
  if (new Set(importedHandles).size !== importedHandles.length || importedHandles.length !== actualHandles.length || importedHandles.some((handle, index) => handle !== actualHandles[index])) {
    throw new DxfImportError("Opened DXF entity handles do not match the parser report.", report);
  }
  const entityKinds: Record<string, number> = {};
  for (const entity of document.entities) entityKinds[entity.kind] = (entityKinds[entity.kind] ?? 0) + 1;
  return {
    documentId: document.documentId,
    title: document.metadata.title ?? document.documentId,
    units: document.units.linear,
    modelLayoutId: modelLayouts[0]!.id,
    entityCount: document.entities.length,
    layerCount: document.layers.length,
    importedHandles,
    entityKinds,
  };
}

/**
 * Opens an ASCII DXF as a new editable Model-space document.
 *
 * This is intentionally distinct from DXFIN, which atomically replaces the
 * drawing content of an already-open document while retaining its layouts.
 */
export function openDxfDocument(input: string | Uint8Array, options: DxfOpenOptions): DxfOpenResult {
  const title = titleFromFileName(options.fileName);
  const imported = importDxf(input, options);
  if ((options.rejectUnsupported ?? true) && imported.report.skipped.length > 0) {
    const first = imported.report.skipped[0]!;
    throw new DxfImportError(
      `DXF open refused a partial import: ${imported.report.skipped.length} unsupported record(s); first ${first.type}${first.handle ? ` ${first.handle}` : ""}.`,
      imported.report,
    );
  }
  const document = structuredClone(imported.document);
  document.metadata.title = title;
  document.metadata.source = `DXF file ${options.fileName.trim()} · ${imported.report.acadVersion} · ${imported.report.codePage}`;
  assertKDrawDocumentV1(document);
  return {
    document,
    report: structuredClone(imported.report),
    readback: readBackOpenedDxf(document, imported.report),
  };
}
