import { assertKDrawDocumentV1, type CadLinearUnit, type KDrawDocumentV1 } from "@kuubik/cad-schema";

export interface NewDocumentOptions {
  documentId: string;
  now?: string;
  units?: CadLinearUnit;
}

export function createEmptyDocument(options: NewDocumentOptions): KDrawDocumentV1 {
  const now = options.now ?? new Date().toISOString();
  const document: KDrawDocumentV1 = {
    schemaVersion: 1,
    documentId: options.documentId,
    revision: 0,
    units: { linear: options.units ?? "mm", displayPrecision: 4, angularPrecision: 6 },
    currentLayerId: "0",
    entities: [],
    layers: [
      { id: "0", name: "0", visible: true, frozen: false, locked: false, plottable: true },
    ],
    linetypes: [],
    textStyles: [],
    dimensionStyles: [],
    blocks: [],
    layouts: [{ id: "model", name: "Model", kind: "model", viewports: [], entities: [] }],
    attachments: [],
    metadata: { createdAt: now, updatedAt: now },
  };
  assertKDrawDocumentV1(document);
  return document;
}
