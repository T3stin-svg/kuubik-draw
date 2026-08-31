import { createEmptyDocument } from "@kuubik/cad-core";
import { openDxfDocument, type DxfOpenReadback } from "@kuubik/cad-dxf";
import { assertKDrawDocumentV1, type CadLinearUnit, type KDrawDocumentV1 } from "@kuubik/cad-schema";

export interface ModelSpaceDocumentState {
  document: KDrawDocumentV1;
  activeLayoutId: string;
  readback: {
    documentId: string;
    title: string;
    revision: number;
    units: CadLinearUnit;
    modelLayoutId: string;
    entityCount: number;
    layerCount: number;
  };
}

export interface NewModelSpaceDocumentOptions {
  documentId: string;
  title: string;
  units?: CadLinearUnit;
  now?: string;
}

function normalizedTitle(value: string): string {
  const title = value.trim();
  if (!title) throw new TypeError("A Model-space drawing title is required.");
  return title;
}

export function readBackModelSpaceDocument(document: KDrawDocumentV1): ModelSpaceDocumentState["readback"] {
  assertKDrawDocumentV1(document);
  const modelLayouts = document.layouts.filter((layout) => layout.kind === "model");
  if (modelLayouts.length !== 1) throw new TypeError(`A drafting document must contain exactly one Model layout; found ${modelLayouts.length}.`);
  return {
    documentId: document.documentId,
    title: document.metadata.title ?? document.documentId,
    revision: document.revision,
    units: document.units.linear,
    modelLayoutId: modelLayouts[0]!.id,
    entityCount: document.entities.length,
    layerCount: document.layers.length,
  };
}

export function createNewModelSpaceDocument(options: NewModelSpaceDocumentOptions): ModelSpaceDocumentState {
  const document = createEmptyDocument({
    documentId: options.documentId,
    ...(options.units ? { units: options.units } : {}),
    ...(options.now ? { now: options.now } : {}),
  });
  document.metadata.title = normalizedTitle(options.title);
  assertKDrawDocumentV1(document);
  const readback = readBackModelSpaceDocument(document);
  return { document, activeLayoutId: readback.modelLayoutId, readback };
}

export function openDxfInModelSpace(input: string | Uint8Array, options: {
  documentId: string;
  fileName: string;
  now?: string;
}): ModelSpaceDocumentState & { dxfReadback: DxfOpenReadback } {
  const opened = openDxfDocument(input, {
    documentId: options.documentId,
    fileName: options.fileName,
    ...(options.now ? { now: options.now } : {}),
  });
  const readback = readBackModelSpaceDocument(opened.document);
  return {
    document: opened.document,
    activeLayoutId: readback.modelLayoutId,
    readback,
    dxfReadback: opened.readback,
  };
}
