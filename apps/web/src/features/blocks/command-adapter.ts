import {
  assertAcyclicBlocks,
  createBlockInsert,
  defineBlockFromSelection,
  editBlockAttributes,
  explodeBlockReference,
  redefineBlock,
  syncBlockAttributes,
  type BlockAttributeDefinition,
  type CadChange,
  type CadSession,
} from "@kuubik/cad-core";
import type { CadEntity, CadPoint2, KDrawDocumentV1 } from "@kuubik/cad-schema";
import { createAtomicCommandWorkflow, type AtomicCommandAdapter, type PreparedAtomicCommand } from "../draw-modify/atomic-command-workflow.js";

export type BlockCommandInput =
  | { commandId: "BLOCK"; id: string; name: string; basePoint: CadPoint2; selectedHandles: string[]; insertHandle: string; layerId?: string; attributes?: BlockAttributeDefinition[] }
  | { commandId: "INSERT"; handle: string; layerId: string; blockId: string; insertion: CadPoint2; scale?: CadPoint2; rotationRad?: number; attributes?: Record<string, string> }
  | { commandId: "EXPLODE"; insertHandle: string; nestedMode?: "preserve" | "recursive" }
  | { commandId: "BEDIT"; insertHandle: string; basePoint: CadPoint2; entities: CadEntity[]; attributes?: BlockAttributeDefinition[]; syncAttributes?: boolean }
  | { commandId: "ATTRIB"; mode?: "edit"; insertHandle: string; values: Record<string, string> }
  | { commandId: "ATTRIB"; mode: "sync"; insertHandle: string };

function prepared(commandId: string, changes: CadChange[], targetHandles: readonly string[], resultHandles: readonly string[], operationArgs: unknown): PreparedAtomicCommand {
  if (!changes.length) throw new RangeError(`${commandId} prepared no document change.`);
  return { commandId, changes, targetHandles: [...targetHandles], resultHandles: [...resultHandles], operationArgs: structuredClone(operationArgs) };
}

export function prepareBlockCommand(document: KDrawDocumentV1, input: BlockCommandInput): PreparedAtomicCommand {
  assertAcyclicBlocks(document.blocks);
  switch (input.commandId) {
    case "BLOCK": {
      const result = defineBlockFromSelection(document, {
        id: input.id, name: input.name, basePoint: input.basePoint, selectedHandles: input.selectedHandles,
        insertHandle: input.insertHandle, ...(input.layerId ? { layerId: input.layerId } : {}),
        ...(input.attributes ? { attributes: input.attributes } : {}),
      });
      return prepared(input.commandId, result.changes, input.selectedHandles, [result.insert.handle], input);
    }
    case "INSERT": {
      const entity = createBlockInsert(document, {
        handle: input.handle, layerId: input.layerId, blockId: input.blockId, insertion: input.insertion,
        ...(input.scale ? { scale: input.scale } : {}), ...(input.rotationRad === undefined ? {} : { rotationRad: input.rotationRad }),
        ...(input.attributes ? { attributes: input.attributes } : {}),
      });
      return prepared(input.commandId, [{ type: "put", entity }], [], [entity.handle], input);
    }
    case "EXPLODE": {
      const result = explodeBlockReference(document, input.insertHandle, input.nestedMode ?? "preserve");
      return prepared(input.commandId, result.changes, [input.insertHandle], result.resultHandles, input);
    }
    case "BEDIT": {
      const insert = document.entities.find((entity) => entity.handle === input.insertHandle && entity.kind === "blockRef");
      if (!insert || insert.kind !== "blockRef") throw new RangeError(`BEDIT requires an INSERT: ${input.insertHandle}.`);
      const result = redefineBlock(document, {
        blockId: insert.blockId, basePoint: input.basePoint, entities: input.entities,
        ...(input.attributes ? { attributes: input.attributes } : {}),
        ...(input.syncAttributes === undefined ? {} : { syncAttributes: input.syncAttributes }),
      });
      const affected = result.affectedInsertHandles;
      return prepared(input.commandId, result.changes, affected, affected, input);
    }
    case "ATTRIB": {
      if (input.mode === "sync") {
        const insert = document.entities.find((entity) => entity.handle === input.insertHandle && entity.kind === "blockRef");
        if (!insert || insert.kind !== "blockRef") throw new RangeError(`ATTSYNC requires an INSERT: ${input.insertHandle}.`);
        const result = syncBlockAttributes(document, insert.blockId);
        return prepared(input.commandId, result.changes, result.resultHandles, result.resultHandles, input);
      }
      const change = editBlockAttributes(document, input.insertHandle, input.values);
      return prepared(input.commandId, [change], [input.insertHandle], [input.insertHandle], input);
    }
  }
}

export function createBlockCommandAdapter(): AtomicCommandAdapter<BlockCommandInput> {
  return { prepare: prepareBlockCommand };
}

export function createBlockCommandWorkflow(session: CadSession) {
  return createAtomicCommandWorkflow(session, createBlockCommandAdapter());
}
