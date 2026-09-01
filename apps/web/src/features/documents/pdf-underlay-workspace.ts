import {
  effectivePdfUnderlayOpacity,
  readPdfUnderlays,
  resolvePdfUnderlayLayerState,
  type PdfUnderlayPlacement,
  type PdfUnderlayPlacementPatch,
} from "@kuubik/cad-core";
import {
  createPdfUnderlayPlacement,
  preparePdfUnderlay,
  type PreparedPdfUnderlay,
} from "@kuubik/cad-print";
import type { CadOperation } from "@kuubik/cad-schema";
import { DocumentLiveOrchestrator } from "./document-live-orchestrator.js";

export interface PdfUnderlayAttachInput {
  attachmentId: string;
  placementId: string;
  bytes: Uint8Array;
  fileName: string;
  pageNumber: number;
  position?: { x: number; y: number };
  scale?: number;
  rotationRad?: number;
  opacity?: number;
  fadePercent?: number;
  visible?: boolean;
  layerId?: string;
  clipBoundary?: Array<{ x: number; y: number }>;
  referencePath?: string;
  referenceMode?: "embedded" | "linked-copy";
}

export interface PdfUnderlayReloadInput {
  attachmentId: string;
  bytes: Uint8Array;
  fileName: string;
  referencePath?: string;
  pageNumber?: number;
  scale?: number;
}

export interface PdfUnderlayWorkspaceReadback {
  documentId: string;
  revision: number;
  canUndo: boolean;
  canRedo: boolean;
  placements: Array<{
    placement: PdfUnderlayPlacement;
    sha256: string;
    byteLength: number;
    pageCount: number;
    effectiveOpacity: number;
    layer: ReturnType<typeof resolvePdfUnderlayLayerState>;
  }>;
}

export class PdfUnderlayWorkspace {
  constructor(
    readonly live: DocumentLiveOrchestrator,
    readonly documentId: string,
    readonly operationNamespace: string,
  ) {
    if (!documentId.trim() || !operationNamespace.trim()) throw new TypeError("PDF workspace document and operation namespace are required.");
    live.document(documentId);
  }

  async inspect(bytes: Uint8Array, attachmentId: string, fileName: string): Promise<PreparedPdfUnderlay> {
    return preparePdfUnderlay(bytes, { attachmentId, fileName });
  }

  async attach(input: PdfUnderlayAttachInput, now?: string): Promise<PdfUnderlayWorkspaceReadback> {
    const prepared = await this.inspect(input.bytes, input.attachmentId, input.fileName);
    const placement = createPdfUnderlayPlacement(prepared, {
      id: input.placementId,
      pageNumber: input.pageNumber,
      ...(input.position === undefined ? {} : { position: input.position }),
      ...(input.scale === undefined ? {} : { scale: input.scale }),
      ...(input.rotationRad === undefined ? {} : { rotationRad: input.rotationRad }),
      ...(input.opacity === undefined ? {} : { opacity: input.opacity }),
      ...(input.fadePercent === undefined ? {} : { fadePercent: input.fadePercent }),
      ...(input.visible === undefined ? {} : { visible: input.visible }),
      ...(input.layerId === undefined ? {} : { layerId: input.layerId }),
      ...(input.clipBoundary === undefined ? {} : { clipBoundary: input.clipBoundary }),
      ...(input.referencePath === undefined ? {} : { referencePath: input.referencePath }),
      ...(input.referenceMode === undefined ? {} : { referenceMode: input.referenceMode }),
    });
    await this.live.attachPdf(this.documentId, this.operation("PDFATTACH", {
      placementId: placement.id,
      attachmentId: placement.attachmentId,
      pageNumber: placement.pageNumber,
    }), prepared, placement, now);
    return this.readBack();
  }

  async update(placementId: string, patch: PdfUnderlayPlacementPatch, now?: string): Promise<PdfUnderlayWorkspaceReadback> {
    await this.live.updatePdf(this.documentId, this.operation("PDFUNDERLAY_UPDATE", { placementId, patch }), placementId, patch, now);
    return this.readBack();
  }

  async reload(placementId: string, input: PdfUnderlayReloadInput, now?: string): Promise<PdfUnderlayWorkspaceReadback> {
    const current = readPdfUnderlays(this.live.document(this.documentId)).find((placement) => placement.id === placementId);
    if (!current) throw new RangeError(`PDF underlay placement ${placementId} does not exist.`);
    const prepared = await this.inspect(input.bytes, input.attachmentId, input.fileName);
    const pageNumber = input.pageNumber ?? current.pageNumber;
    const page = prepared.inspection.pages.find((candidate) => candidate.pageNumber === pageNumber);
    if (!page) throw new RangeError(`PDF reload page ${pageNumber} is outside 1..${prepared.inspection.pages.length}.`);
    const replacement = input.scale === undefined
      ? {
        ...structuredClone(current),
        attachmentId: prepared.attachment.id,
        pageNumber,
        referencePath: input.referencePath ?? input.fileName,
      }
      : createPdfUnderlayPlacement(prepared, {
        id: current.id,
        pageNumber,
        position: current.position,
        scale: input.scale,
        rotationRad: current.rotationRad,
        opacity: current.opacity,
        visible: current.visible,
        referencePath: input.referencePath ?? input.fileName,
        ...(current.fadePercent === undefined ? {} : { fadePercent: current.fadePercent }),
        ...(current.layerId === undefined ? {} : { layerId: current.layerId }),
        ...(current.clipBoundary === undefined ? {} : { clipBoundary: current.clipBoundary }),
        ...(current.referenceMode === undefined ? {} : { referenceMode: current.referenceMode }),
      });
    await this.live.reloadPdf(this.documentId, this.operation("PDFRELOAD", {
      placementId,
      attachmentId: prepared.attachment.id,
      pageNumber,
    }), prepared, replacement, now);
    return this.readBack();
  }

  async detach(placementId: string, now?: string): Promise<PdfUnderlayWorkspaceReadback> {
    await this.live.detachPdf(this.documentId, this.operation("PDFDETACH", { placementId }), placementId, now);
    return this.readBack();
  }

  async undo(now?: string): Promise<PdfUnderlayWorkspaceReadback> {
    await this.live.undo(this.documentId, now);
    return this.readBack();
  }

  async redo(now?: string): Promise<PdfUnderlayWorkspaceReadback> {
    await this.live.redo(this.documentId, now);
    return this.readBack();
  }

  async readBack(): Promise<PdfUnderlayWorkspaceReadback> {
    const document = this.live.document(this.documentId);
    const session = this.live.readBack().sessions.documents.find((candidate) => candidate.documentId === this.documentId);
    if (!session) throw new RangeError(`Document session ${this.documentId} is not open.`);
    const placements = await Promise.all(readPdfUnderlays(document).map(async (placement) => {
      const stored = await this.live.readPdf(this.documentId, placement.id);
      const prepared = await this.inspect(stored.bytes, `readback-${placement.attachmentId}`, stored.attachment.fileName);
      return {
        placement,
        sha256: stored.attachment.sha256,
        byteLength: stored.bytes.byteLength,
        pageCount: prepared.inspection.pages.length,
        effectiveOpacity: effectivePdfUnderlayOpacity(placement),
        layer: resolvePdfUnderlayLayerState(document, placement),
      };
    }));
    return {
      documentId: this.documentId,
      revision: document.revision,
      canUndo: session.canUndo,
      canRedo: session.canRedo,
      placements,
    };
  }

  private operation(commandId: string, args: unknown): CadOperation {
    const baseRevision = this.live.document(this.documentId).revision;
    return {
      opId: `${this.operationNamespace}:${this.documentId}:${baseRevision + 1}:${commandId}`,
      baseRevision,
      commandId,
      args,
      targetHandles: [],
      resultHandles: [],
    };
  }
}
