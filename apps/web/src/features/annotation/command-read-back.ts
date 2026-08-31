import type { CadChange, CadSession, CommittedOperation } from "@kuubik/cad-core";
import type { CadBlockDefinition, CadDimensionStyle, CadDocumentMetadata, CadEntity, CadTextStyle } from "@kuubik/cad-schema";
import type { PreparedEngineCommand } from "../command-system/command-engine.js";

export interface AnnotationBlockCommandReadBack {
  commandId: string;
  revision: number;
  targetHandles: string[];
  resultHandles: string[];
  entities: CadEntity[];
  deletedHandles: string[];
  blocks: CadBlockDefinition[];
  textStyles: CadTextStyle[];
  dimensionStyles: CadDimensionStyle[];
  metadata: CadDocumentMetadata | null;
}

function assertExact(actual: unknown, expected: unknown, label: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${label} exact read-back failed.`);
}

function materializedChange(session: CadSession, change: CadChange, readBack: AnnotationBlockCommandReadBack): void {
  switch (change.type) {
    case "put": {
      const entity = session.document.entities.find((candidate) => candidate.handle === change.entity.handle);
      assertExact(entity, change.entity, `Entity ${change.entity.handle}`);
      readBack.entities.push(structuredClone(change.entity));
      return;
    }
    case "delete":
      if (session.document.entities.some((entity) => entity.handle === change.handle)) throw new Error(`Deleted entity ${change.handle} still exists after commit.`);
      readBack.deletedHandles.push(change.handle);
      return;
    case "put-text-style": {
      const style = session.document.textStyles.find((candidate) => candidate.id === change.textStyle.id);
      assertExact(style, change.textStyle, `Text style ${change.textStyle.id}`);
      readBack.textStyles.push(structuredClone(change.textStyle));
      return;
    }
    case "put-dimension-style": {
      const style = session.document.dimensionStyles.find((candidate) => candidate.id === change.dimensionStyle.id);
      assertExact(style, change.dimensionStyle, `Dimension style ${change.dimensionStyle.id}`);
      readBack.dimensionStyles.push(structuredClone(change.dimensionStyle));
      return;
    }
    case "set-metadata":
      assertExact({ ...session.document.metadata, updatedAt: change.metadata.updatedAt }, change.metadata, "Document metadata");
      readBack.metadata = structuredClone(session.document.metadata);
      return;
    case "replace-drawing-content":
      assertExact(session.document.units, change.units, "Drawing units");
      assertExact(session.document.currentLayerId, change.currentLayerId, "Current layer");
      assertExact(session.document.entities, change.entities, "Drawing entities");
      assertExact(session.document.layers, change.layers, "Drawing layers");
      assertExact(session.document.linetypes, change.linetypes, "Drawing linetypes");
      assertExact(session.document.textStyles, change.textStyles, "Drawing text styles");
      assertExact(session.document.dimensionStyles, change.dimensionStyles, "Drawing dimension styles");
      assertExact(session.document.blocks, change.blocks, "Drawing blocks");
      readBack.entities = structuredClone(change.entities);
      readBack.blocks = structuredClone(change.blocks);
      readBack.textStyles = structuredClone(change.textStyles);
      readBack.dimensionStyles = structuredClone(change.dimensionStyles);
      return;
    default:
      throw new Error(`Annotation/block read-back does not support change ${change.type}.`);
  }
}

export function readBackAnnotationBlockCommit(
  session: CadSession,
  prepared: PreparedEngineCommand,
  committed: CommittedOperation,
): AnnotationBlockCommandReadBack {
  if (session.document.revision !== committed.committedRevision) throw new Error("Committed revision was not read back from the active session.");
  assertExact(committed.changes, prepared.changes, "Committed change set");
  assertExact(committed.operation.targetHandles, prepared.targetHandles, "Operation target handles");
  assertExact(committed.operation.resultHandles, prepared.resultHandles, "Operation result handles");
  if (committed.operation.commandId !== prepared.commandId) throw new Error("Committed command id differs from preview.");
  const readBack: AnnotationBlockCommandReadBack = {
    commandId: committed.operation.commandId,
    revision: committed.committedRevision,
    targetHandles: [...committed.operation.targetHandles],
    resultHandles: [...committed.operation.resultHandles],
    entities: [],
    deletedHandles: [],
    blocks: [],
    textStyles: [],
    dimensionStyles: [],
    metadata: null,
  };
  for (const change of committed.changes) materializedChange(session, change, readBack);
  return structuredClone(readBack);
}
